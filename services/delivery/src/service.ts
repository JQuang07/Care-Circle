import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { classify } from "./match.js";
import { ProviderError, type Provider, type Store } from "./providers/provider.js";
import { MockProvider } from "./providers/mock.js";
import type { DeliveryOrder, DeliveryStatus, Kind, Quote, QuoteLine, RequestedItem } from "./types.js";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface MoneyOrder { id: string; seniorId: string; status: string; amountCents?: number; request?: { amountCents?: number } }

/** Money is the only authority on whether an order may be fulfilled. */
export interface MoneyClient { getOrder(orderId: string, seniorId: string): Promise<MoneyOrder | undefined> }

export function httpMoneyClient(baseUrl: string, secret: string): MoneyClient {
  const headers = { "X-CC-Secret": secret };
  return {
    async getOrder(orderId, seniorId) {
      const one = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}`, { headers });
      if (one.ok) return (await one.json()) as MoneyOrder;
      const list = await fetch(`${baseUrl}/orders?seniorId=${encodeURIComponent(seniorId)}`, { headers });
      if (!list.ok) throw new ApiError(502, "MONEY_UNREACHABLE", `money GET /orders → HTTP ${list.status}`);
      return ((await list.json()) as MoneyOrder[]).find((o) => o.id === orderId);
    },
  };
}

/** D14 event, plus `seniorId` and `storeName` (additive) so receivers can route it without a lookup. */
export type Emit = (event: { deliveryId: string; orderId: string; seniorId: string; storeName: string; status: DeliveryStatus; etaUtc?: string; etaText?: string; trackingUrl?: string; failureReason?: string }) => void;

export function httpEmitter(targets: string[], secret: string, log: (m: string) => void): Emit {
  return (ev) => {
    for (const base of targets) {
      fetch(`${base}/webhooks/delivery-status`, {
        method: "POST", headers: { "content-type": "application/json", "X-CC-Secret": secret }, body: JSON.stringify(ev),
      }).then((r) => { if (!r.ok && r.status !== 404) log(`delivery-status → ${base}: HTTP ${r.status}`); })
        .catch((e) => log(`delivery-status → ${base}: ${e.message}`));
    }
  };
}

const nowIso = () => new Date().toISOString();

export class DeliveryService {
  private quotes = new Map<string, Quote>();
  private stores = new Map<string, Store>();
  private orders = new Map<string, DeliveryOrder>();
  private pollers = new Map<string, NodeJS.Timeout>();

  constructor(
    private cfg: Config,
    private provider: Provider,
    private money: MoneyClient,
    private emit: Emit,
    private log: (m: string) => void = console.log,
  ) {}

  get providerName() { return this.provider.name; }
  providerStatus() { return this.provider.status(); }

  async quote(body: { kind?: Kind; items?: RequestedItem[]; storeHint?: string; dropoffPersonId?: string }): Promise<Quote> {
    const kind: Kind = body?.kind === "meal" ? "meal" : "grocery";
    const items = Array.isArray(body?.items) ? body.items.filter((i) => i && typeof i.name === "string" && i.name.trim()) : [];
    if (!items.length) throw new ApiError(400, "BAD_REQUEST", "items[] with at least one { name, qty } is required");
    const store = await this.wrap(() => this.provider.findStore(kind, body.storeHint));
    const catalog = await this.wrap(() => this.provider.catalog(store, items.map((i) => i.name)));
    const lines: QuoteLine[] = items.map((i) => {
      const qty = Math.max(1, Math.round(Number(i.qty) || 1));
      const c = classify(i.name, catalog);
      if (c.status === "matched") return { requested: i.name, qty, status: "matched", matched: { name: c.item.name, priceCents: c.item.priceCents, qty } };
      if (c.status === "ambiguous") return { requested: i.name, qty, status: "ambiguous", options: c.options };
      return { requested: i.name, qty, status: "not_found" };
    });
    const subtotalCents = lines.reduce((s, l) => s + (l.matched ? l.matched.priceCents * l.matched.qty : 0), 0);
    const feesCents = subtotalCents > 0 ? this.provider.estimateFeesCents(subtotalCents) : 0;
    const q: Quote = {
      quoteId: `q_${randomUUID().slice(0, 12)}`, provider: this.provider.name, kind,
      storeName: store.name, storeId: store.id, lines, subtotalCents, feesCents, totalCents: subtotalCents + feesCents,
      expiresAt: new Date(Date.now() + this.cfg.quoteTtlMs).toISOString(),
    };
    this.quotes.set(q.quoteId, q);
    this.stores.set(store.id, store);
    return q;
  }

  /** Called by money AFTER it approved and charged the order. Builds the cart; pays only behind the live gate. */
  async createOrder(body: { orderId?: string; seniorId?: string; quoteId?: string; approvedAmountCents?: number }): Promise<DeliveryOrder> {
    const { orderId, seniorId = "sen_rose", quoteId } = body ?? {};
    const approved = Number(body?.approvedAmountCents);
    if (!orderId || !quoteId || !Number.isInteger(approved) || approved <= 0) {
      throw new ApiError(400, "BAD_REQUEST", "orderId, quoteId and integer approvedAmountCents are required");
    }
    const existing = [...this.orders.values()].find((o) => o.orderId === orderId);
    if (existing) return existing; // idempotent
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new ApiError(404, "QUOTE_NOT_FOUND", `No quote ${quoteId}`);
    if (Date.parse(quote.expiresAt) < Date.now()) throw new ApiError(409, "QUOTE_EXPIRED", "Quote expired; request a new one");

    // Gate 1: money must say this order is paid.
    const mo = await this.money.getOrder(orderId, seniorId).catch((e) => {
      throw e instanceof ApiError ? e : new ApiError(502, "MONEY_UNREACHABLE", String(e?.message ?? e));
    });
    if (!mo) throw new ApiError(404, "ORDER_NOT_FOUND", `money has no order ${orderId}`);
    if (mo.status !== "paid") throw new ApiError(409, "ORDER_NOT_PAID", `money order ${orderId} is "${mo.status}", not "paid"`);
    const moneyAmount = mo.amountCents ?? mo.request?.amountCents;
    if (typeof moneyAmount === "number" && approved > moneyAmount) {
      throw new ApiError(409, "AMOUNT_MISMATCH", `approvedAmountCents ${approved} exceeds what money charged (${moneyAmount})`);
    }

    const d: DeliveryOrder = {
      deliveryId: `del_${randomUUID().slice(0, 12)}`, orderId, seniorId, quoteId, provider: this.provider.name,
      status: "cart_ready", cartTotalCents: 0, approvedAmountCents: approved, storeName: quote.storeName,
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    this.orders.set(d.deliveryId, d);

    const lines = quote.lines.filter((l) => l.status === "matched" && l.matched).map((l) => ({ name: l.matched!.name, qty: l.matched!.qty }));
    if (!lines.length) return this.fail(d, "Nothing in the quote matched the store's items");
    const store = this.stores.get(quote.storeId) ?? { id: quote.storeId, name: quote.storeName };
    try {
      const cart = await this.provider.buildCart(store, lines);
      const preview = await this.provider.preview();
      const total = Math.max(cart.totalCents, preview.totalCents ?? 0);
      d.cartTotalCents = total;
      d.etaText = preview.etaText;
      // Gate 2: the cart can't cost more than money approved (+ tolerance), nor more than the hard cap.
      const ceiling = Math.floor(approved * (1 + this.cfg.tolerancePct / 100));
      if (total > ceiling) return this.fail(d, `Cart total $${(total / 100).toFixed(2)} is above the approved $${(approved / 100).toFixed(2)} (+${this.cfg.tolerancePct}%)`);
      if (total > this.cfg.maxOrderCents) return this.fail(d, `Cart total $${(total / 100).toFixed(2)} is above the hard cap $${(this.cfg.maxOrderCents / 100).toFixed(2)}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (this.cfg.liveCheckout) return this.fail(d, reason);
      // Dry run: nothing is ever bought, so a flaky browser step (DoorDash's page changed, a
      // selector timed out) shouldn't reach the family as "didn't go through". Finish the dry
      // run on the quote's DoorDash prices; the amount gates still apply to that total.
      this.log(`delivery ${d.deliveryId}: cart build failed in dry run, completing on quote prices: ${reason}`);
      const total = quote.totalCents;
      const ceiling = Math.floor(approved * (1 + this.cfg.tolerancePct / 100));
      if (total > ceiling) return this.fail(d, `Quote total $${(total / 100).toFixed(2)} is above the approved $${(approved / 100).toFixed(2)} (+${this.cfg.tolerancePct}%)`);
      if (total > this.cfg.maxOrderCents) return this.fail(d, `Quote total $${(total / 100).toFixed(2)} is above the hard cap $${(this.cfg.maxOrderCents / 100).toFixed(2)}`);
      d.cartTotalCents = total;
      d.cartNote = `Cart not built on DoorDash (${reason.split("\n")[0]!.slice(0, 160)}); dry run completed on quote prices.`;
    }
    return this.setStatus(d, this.cfg.liveCheckout ? "awaiting_live_checkout" : "dry_run_complete");
  }

  /** Gate 3: the only path to a real order. Needs DOORDASH_LIVE_CHECKOUT=1 (checked here) + X-CC-Secret (checked in app) + a named human. */
  async checkout(deliveryId: string, body: { confirmedBy?: string }): Promise<DeliveryOrder> {
    const d = this.get(deliveryId);
    if (!this.cfg.liveCheckout) throw new ApiError(403, "LIVE_CHECKOUT_DISABLED", "Live checkout is off (DOORDASH_LIVE_CHECKOUT=0 or provider is mock). This was a dry run.");
    if (!body?.confirmedBy?.trim()) throw new ApiError(400, "CONFIRMATION_REQUIRED", "confirmedBy (the human who approved) is required");
    if (d.status !== "awaiting_live_checkout") throw new ApiError(409, "NOT_AWAITING_CHECKOUT", `Delivery is "${d.status}"`);
    const mo = await this.money.getOrder(d.orderId, d.seniorId);
    if (mo?.status !== "paid") throw new ApiError(409, "ORDER_NOT_PAID", "money no longer shows this order as paid");
    d.confirmedBy = body.confirmedBy.trim();
    try {
      const r = await this.provider.checkout();
      d.externalOrderId = r.externalOrderId;
      d.etaText = r.etaText ?? d.etaText;
      this.log(`LIVE ORDER PLACED ${d.deliveryId} (${d.storeName}, $${(d.cartTotalCents / 100).toFixed(2)}) confirmed by ${d.confirmedBy}`);
    } catch (e) {
      return this.fail(d, e instanceof Error ? e.message : String(e));
    }
    this.startPolling(d);
    return this.setStatus(d, "placed");
  }

  get(deliveryId: string): DeliveryOrder {
    const d = this.orders.get(deliveryId);
    if (!d) throw new ApiError(404, "NOT_FOUND", `No delivery ${deliveryId}`);
    return d;
  }

  list(seniorId?: string) {
    return [...this.orders.values()].filter((o) => !seniorId || o.seniorId === seniorId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Demo control. Mock provider only: simulates the Dasher after a dry run or a mock placement. */
  advance(deliveryId: string, to: string): DeliveryOrder {
    if (this.provider.name !== "mock") throw new ApiError(403, "MOCK_ONLY", "/demo/advance only works with DELIVERY_PROVIDER=mock");
    const d = this.get(deliveryId);
    if (!["placed", "picked_up", "delivered"].includes(to)) throw new ApiError(400, "BAD_REQUEST", "to must be placed | picked_up | delivered");
    if (d.status === "failed") throw new ApiError(409, "FAILED", "Delivery failed; nothing to advance");
    if (this.provider instanceof MockProvider && d.externalOrderId) this.provider.force(d.externalOrderId, to as "placed");
    return this.setStatus(d, to as DeliveryStatus);
  }

  reset() {
    for (const t of this.pollers.values()) clearInterval(t);
    this.pollers.clear(); this.orders.clear(); this.quotes.clear(); this.stores.clear();
  }

  stop() { for (const t of this.pollers.values()) clearInterval(t); }

  private startPolling(d: DeliveryOrder) {
    const t = setInterval(async () => {
      try {
        const s = await this.provider.track(d.externalOrderId!);
        if (s.etaText) d.etaText = s.etaText;
        if (s.status !== d.status) this.setStatus(d, s.status);
        if (s.status === "delivered") { clearInterval(t); this.pollers.delete(d.deliveryId); }
      } catch (e) { this.log(`track ${d.deliveryId}: ${e instanceof Error ? e.message : e}`); }
    }, this.cfg.pollMs);
    t.unref?.();
    this.pollers.set(d.deliveryId, t);
  }

  private setStatus(d: DeliveryOrder, status: DeliveryStatus): DeliveryOrder {
    d.status = status; d.updatedAt = nowIso();
    this.emit({ deliveryId: d.deliveryId, orderId: d.orderId, seniorId: d.seniorId, storeName: d.storeName, status, etaUtc: d.etaUtc, etaText: d.etaText, trackingUrl: d.trackingUrl, failureReason: d.failureReason });
    return d;
  }

  private fail(d: DeliveryOrder, reason: string) {
    d.failureReason = reason;
    this.log(`delivery ${d.deliveryId} failed: ${reason}`);
    return this.setStatus(d, "failed");
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (e instanceof ProviderError) throw new ApiError(502, e.code, e.message);
      throw e;
    }
  }
}
