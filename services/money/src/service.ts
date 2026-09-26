import { randomUUID } from 'node:crypto';
import type { Credential, DeliveryStatus, FraudAssessment, Hold, Order, OrderRequest } from './contracts';
import type { DeliveryClient } from './delivery';
import { ApiError } from './errors';
import type { Events } from './events';
import type { FamilyClient } from './family';
import { loadLedger, spentThisMonth } from './fraud/assess';
import { categoryOf, effectiveAmountCents } from './fraud/layer1';
import type { PasskeyVerifier } from './passkey';
import type { PaymentsProvider } from './payments';
import type { Store } from './store/store';

export const COOLING_OFF_MS = 24 * 60 * 60 * 1000;
const id = (prefix: string) => `${prefix}${randomUUID().replace(/-/g, '').slice(0, 12)}`;

export interface ServiceDeps {
  delivery?: DeliveryClient;
  log?: (message: string) => void;
  store: Store;
  family: FamilyClient;
  payments: PaymentsProvider;
  events: Events;
  passkey: PasskeyVerifier;
  assess: (req: OrderRequest) => Promise<FraudAssessment>;
  credential: (seniorId: string) => Credential | undefined;
  now: () => Date;
}

export class MoneyService {
  constructor(private d: ServiceDeps) {}

  assess(req: OrderRequest) { return this.d.assess(req); }

  async draft(req: OrderRequest): Promise<Order> {
    const priced = req.type === 'groceries' && this.d.delivery ? await this.d.delivery.price(req) : undefined;
    req = priced?.request ?? req;
    const fraud = await this.d.assess(req);
    const now = this.d.now();
    const order: Order = {
      id: id('ord_'), seniorId: req.seniorId, request: req,
      status: (fraud.hardStop || fraud.risk === 'high') ? 'held' : 'approved',
      ...(priced ? { fulfilment: priced.fulfilment } : {}),
      fraud, createdAt: now.toISOString(),
    };
    if (order.status === 'held') {
      const hold: Hold = {
        id: id('hold_'), orderId: order.id, seniorId: req.seniorId, status: 'open',
        createdAt: now.toISOString(), coolingOffUntil: new Date(now.getTime() + COOLING_OFF_MS).toISOString(),
      };
      order.holdId = hold.id;
      await this.d.store.saveHold(hold);
      await this.d.store.saveOrder(order);
      this.d.events.emit('fraud.hold_created', { order, hold });
    } else {
      await this.d.store.saveOrder(order);
    }
    return order;
  }

  async confirm(orderId: string): Promise<Order> {
    const order = await this.d.store.getOrder(orderId);
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', `No order ${orderId}`);
    if (order.status === 'paid') return order;
    if (order.status !== 'approved') {
      throw new ApiError(409, 'ORDER_NOT_CONFIRMABLE', `Order is ${order.status}`);
    }
    if (order.fulfilment?.unmatchedItems?.length) throw new ApiError(409, 'UNMATCHED_ITEMS', 'Resolve unavailable or ambiguous items before payment');
    const now = this.d.now();
    const amount = effectiveAmountCents(order.request);
    // Re-check caps at payment time unless a family member released it by passkey.
    if (!order.holdId) {
      const cred = this.d.credential(order.seniorId);
      const circle = await this.d.family.getCircle(order.seniorId);
      const spent = spentThisMonth(await loadLedger(this.d.store, order.seniorId, now), now, circle.senior.tz);
      if (cred && (amount > cred.perPurchaseCapCents || spent + amount > cred.monthlyCapCents)) {
        throw new ApiError(422, 'OVER_CAP', 'This would go over the spending limit');
      }
    }
    const { receiptUrl } = await this.d.payments.charge(order).catch((e) => {
      throw new ApiError(502, 'PAYMENT_FAILED', (e as Error).message);
    });
    order.status = 'paid';
    order.receiptUrl = receiptUrl;
    await this.d.store.saveOrder(order);
    await this.d.store.addLedger([{
      id: `led_${order.id}`, seniorId: order.seniorId, at: now.toISOString(),
      merchantId: order.request.merchantId, category: categoryOf(order.request), amountCents: amount,
      label: order.request.payeeDescription,
    }]);
    this.d.events.emit('order.paid', order);
    if (order.fulfilment?.quoteId && this.d.delivery) {
      void this.d.delivery.fulfil(order, amount).catch(() => this.d.log?.(`Delivery dispatch failed for ${order.id}; payment remains paid`));
    }
    return order;
  }

  async resolveHold(holdId: string, body: unknown): Promise<Hold> {
    const b = (body ?? {}) as { decision?: string; byMemberId?: string; method?: string; passkeyAssertion?: unknown };
    if (b.decision !== 'release' && b.decision !== 'cancel') throw new ApiError(400, 'BAD_REQUEST', 'decision must be release or cancel');
    if (b.method !== 'verbal_on_verification_call' && b.method !== 'passkey_web') {
      throw new ApiError(400, 'BAD_REQUEST', 'method must be verbal_on_verification_call or passkey_web');
    }
    if (typeof b.byMemberId !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'byMemberId is required');

    const hold = await this.d.store.getHold(holdId);
    if (!hold) throw new ApiError(404, 'HOLD_NOT_FOUND', `No hold ${holdId}`);
    if (hold.status !== 'open') throw new ApiError(409, 'HOLD_NOT_OPEN', `Hold is ${hold.status}`);
    const order = await this.d.store.getOrder(hold.orderId);
    if (!order) throw new ApiError(500, 'ORDER_MISSING', 'Hold has no order');

    const circle = await this.d.family.getCircle(hold.seniorId);
    if (!circle.members.some((m) => m.id === b.byMemberId)) {
      throw new ApiError(403, 'NOT_A_MEMBER', 'Only circle members can resolve holds');
    }

    if (b.decision === 'release' && (order.fraud.hardStop || order.fraud.risk === 'high')) {
      if (b.method !== 'passkey_web') {
        throw new ApiError(403, 'PASSKEY_REQUIRED', 'Releasing a high-risk hold requires a passkey');
      }
      if (!(await this.d.passkey.verify(b.passkeyAssertion, b.byMemberId, hold.id))) {
        throw new ApiError(403, 'PASSKEY_INVALID', 'Passkey check failed');
      }
    }

    // Re-read right before writing so two resolvers can't both win.
    const fresh = await this.d.store.getHold(holdId);
    if (fresh?.status !== 'open') throw new ApiError(409, 'HOLD_NOT_OPEN', `Hold is ${fresh?.status}`);

    hold.status = b.decision === 'release' ? 'released' : 'cancelled';
    hold.resolution = { decision: b.decision, byMemberId: b.byMemberId, method: b.method, at: this.d.now().toISOString() };
    order.status = b.decision === 'release' ? 'approved' : 'cancelled';
    await this.d.store.saveHold(hold);
    await this.d.store.saveOrder(order);
    this.d.events.emit('fraud.hold_resolved', { order, hold });
    return hold;
  }

  /** Cooling-off expired with no decision → cancel. Never auto-release. */
  async expireDueHolds(): Promise<Hold[]> {
    const due = await this.d.store.listOpenHoldsDue(this.d.now().toISOString());
    const done: Hold[] = [];
    for (const hold of due) {
      const order = await this.d.store.getOrder(hold.orderId);
      hold.status = 'expired_cooling_off';
      await this.d.store.saveHold(hold);
      if (order) {
        order.status = 'cancelled';
        await this.d.store.saveOrder(order);
        this.d.events.emit('fraud.hold_resolved', { order, hold });
      }
      done.push(hold);
    }
    return done;
  }

  async credentials(seniorId: string) {
    const cred = this.d.credential(seniorId);
    if (!cred) throw new ApiError(404, 'UNKNOWN_SENIOR', `No credential for ${seniorId}`);
    const now = this.d.now();
    const circle = await this.d.family.getCircle(seniorId);
    const spent = spentThisMonth(await loadLedger(this.d.store, seniorId, now), now, circle.senior.tz);
    return { ...cred, spentThisMonthCents: spent, remainingThisMonthCents: Math.max(0, cred.monthlyCapCents - spent) };
  }

  async deliveryStatus(body: unknown): Promise<Order> {
    const b = (body ?? {}) as Record<string, unknown>;
    const statuses = ['cart_ready', 'dry_run_complete', 'awaiting_live_checkout', 'placed', 'picked_up', 'delivered', 'failed'];
    if (typeof b.orderId !== 'string' || typeof b.deliveryId !== 'string' || !b.deliveryId ||
        typeof b.status !== 'string' || !statuses.includes(b.status) ||
        ['etaText', 'trackingUrl', 'failureReason'].some(k => b[k] !== undefined && typeof b[k] !== 'string')) {
      throw new ApiError(400, 'BAD_REQUEST', 'Invalid delivery status event');
    }
    const order = await this.getOrder(b.orderId);
    if (order.status !== 'paid' || !order.fulfilment?.quoteId) {
      throw new ApiError(409, 'DELIVERY_NOT_EXPECTED', 'Delivery requires a paid, quoted order');
    }
    const previous = order.fulfilment.delivery;
    if (previous && previous.deliveryId !== b.deliveryId) throw new ApiError(409, 'DELIVERY_MISMATCH', 'Delivery ID differs');
    // Duplicate or out-of-order callbacks must not move a delivery backwards.
    if (previous && (previous.status === 'delivered' || previous.status === 'failed' ||
        statuses.indexOf(b.status) < statuses.indexOf(previous.status))) return order;
    order.fulfilment.delivery = { ...previous, deliveryId: b.deliveryId, status: b.status as DeliveryStatus['status'],
      ...Object.fromEntries(['etaText', 'trackingUrl', 'failureReason'].filter(k => b[k] !== undefined).map(k => [k, b[k]])) };
    await this.d.store.saveOrder(order);
    return order;
  }

  async getOrder(orderId: string): Promise<Order> {
    const order = await this.d.store.getOrder(orderId);
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', `No order ${orderId}`);
    return order;
  }

  listOrders(seniorId: string) { return this.d.store.listOrders(seniorId); }
  listHolds(seniorId: string) { return this.d.store.listHolds(seniorId); }
}
