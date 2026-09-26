import Stripe from 'stripe';
import type { Order } from './contracts';
import { effectiveAmountCents } from './fraud/layer1';

export interface PaymentsProvider {
  name: 'mock' | 'stripe' | 'visa';
  charge(order: Order): Promise<{ receiptUrl: string; providerRef: string }>;
}

export const mockPayments: PaymentsProvider = {
  name: 'mock',
  async charge(order) {
    return { receiptUrl: `https://receipts.care-circle.mock/${order.id}`, providerRef: `mock_${order.id}` };
  },
};

/** Stripe test mode: charges the Visa test card and returns the real Stripe receipt URL. */
export function stripePayments(secretKey: string): PaymentsProvider {
  const stripe = new Stripe(secretKey);
  return {
    name: 'stripe',
    async charge(order) {
      const pi = await stripe.paymentIntents.create({
        amount: effectiveAmountCents(order.request),
        currency: 'usd',
        payment_method: 'pm_card_visa',
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description: `Care Circle order ${order.id}`,
        metadata: { orderId: order.id, seniorId: order.seniorId },
        expand: ['latest_charge'],
      }, { idempotencyKey: `confirm_${order.id}` });
      const charge = pi.latest_charge as Stripe.Charge | null;
      return {
        receiptUrl: charge?.receipt_url ?? `https://dashboard.stripe.com/test/payments/${pi.id}`,
        providerRef: pi.id,
      };
    },
  };
}

/**
 * Visa Intelligent Commerce sandbox. NOT IMPLEMENTED: needs sandbox credentials and the
 * agent-credential API docs from developer.visa.com. Wire it here; the rest of the service
 * only depends on PaymentsProvider. Until then, choosePayments() falls back to Stripe.
 */
export function visaPayments(): PaymentsProvider {
  return {
    name: 'visa',
    async charge() { throw new Error('VISA_NOT_IMPLEMENTED'); },
  };
}

export function choosePayments(env: NodeJS.ProcessEnv, warn: (m: string) => void): PaymentsProvider {
  if (env.MOCK === '1') return mockPayments;
  if (env.PAYMENTS_PROVIDER === 'visa') {
    warn('PAYMENTS_PROVIDER=visa but the Visa sandbox adapter is not wired yet (see status/AGENT-2.md); falling back to Stripe');
  }
  if (env.STRIPE_SECRET_KEY) return stripePayments(env.STRIPE_SECRET_KEY);
  warn('No STRIPE_SECRET_KEY; using mock payments');
  return mockPayments;
}
