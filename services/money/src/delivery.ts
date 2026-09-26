import type { Fulfilment, Order, OrderRequest } from './contracts';
import { ApiError } from './errors';

export interface PricedOrder { request: OrderRequest; fulfilment: Fulfilment }
export interface DeliveryClient {
  price(request: OrderRequest): Promise<PricedOrder>;
  fulfil(order: Order, approvedAmountCents: number): Promise<void>;
}
interface QuoteLine {
  requested: string; qty: number; status: 'matched' | 'not_found' | 'ambiguous';
  matched?: { name: string; priceCents: number; qty: number };
}
interface Quote {
  quoteId: string; provider: Fulfilment['provider']; storeName: string;
  lines: QuoteLine[]; subtotalCents: number; feesCents: number; totalCents: number; expiresAt: string;
}
const cents = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const key = (s: string) => s.toLowerCase().trim();
// Deterministic local FreshMart catalogue, used only when delivery is unavailable.
const freshMart: Record<string, number> = {
  'whole milk': 429, 'whole milk 1 gal': 429, 'milk': 429,
  'wheat bread': 349, 'whole wheat bread': 349, 'bread': 349,
  'bananas': 189, 'eggs': 379, 'apples': 599, 'roma tomatoes': 199,
  'chicken breast': 649,
};
function fallback(request: OrderRequest): PricedOrder {
  const unmatchedItems: string[] = [];
  const items = request.items.map(item => {
    const priceCents = freshMart[key(item.name)];
    if (priceCents === undefined) unmatchedItems.push(item.name);
    return { ...item, priceCents: priceCents ?? 0 };
  });
  return { request: { ...request, items, amountCents: items.reduce((n, i) => n + i.qty * i.priceCents, 0) },
    fulfilment: { provider: 'mock', storeName: 'FreshMart', unmatchedItems } };
}

export function httpDelivery(url: string, secret: string, log: (message: string) => void = () => {}, now = () => new Date()): DeliveryClient {
  return {
    async fulfil(order, approvedAmountCents) {
      const response = await fetch(`${url.replace(/\/$/, '')}/orders`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-secret': secret },
        body: JSON.stringify({ orderId: order.id, seniorId: order.seniorId,
          quoteId: order.fulfilment?.quoteId, approvedAmountCents }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Delivery dispatch returned HTTP ${response.status}`);
    },
    async price(request) {
      let response: Response;
      try {
        response = await fetch(`${url.replace(/\/$/, '')}/quote`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-secret': secret },
          body: JSON.stringify({ kind: 'grocery', items: request.items.map(({ name, qty }) => ({ name, qty })) }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        log('Delivery unavailable; using FreshMart fallback prices');
        return fallback(request);
      }
      if (!response.ok) {
        if (response.status >= 500) { log('Delivery unavailable; using FreshMart fallback prices'); return fallback(request); }
        throw new ApiError(502, 'DELIVERY_QUOTE_FAILED', 'Delivery rejected the quote request');
      }
      let quote: Quote;
      try { quote = await response.json() as Quote; }
      catch { throw new ApiError(502, 'INVALID_QUOTE', 'Delivery returned invalid JSON'); }
      const invalid = () => new ApiError(502, 'INVALID_QUOTE', 'Delivery returned an incomplete or inconsistent quote');
      if (!quote || typeof quote.quoteId !== 'string' || !quote.quoteId ||
          !['mock', 'doordash_thirdparty'].includes(quote.provider) || typeof quote.storeName !== 'string' ||
          !Array.isArray(quote.lines) || quote.lines.length !== request.items.length ||
          !cents(quote.subtotalCents) || !cents(quote.feesCents) || !cents(quote.totalCents) ||
          quote.totalCents !== quote.subtotalCents + quote.feesCents ||
          !(Date.parse(quote.expiresAt) > now().getTime())) throw invalid();
      const remaining = [...quote.lines];
      const unmatchedItems: string[] = [];
      const items = request.items.map(item => {
        const index = remaining.findIndex(line => line && line.requested === item.name && line.qty === item.qty);
        if (index < 0) throw invalid();
        const [line] = remaining.splice(index, 1);
        if (!['matched', 'not_found', 'ambiguous'].includes(line.status)) throw invalid();
        if (line.status !== 'matched') {
          unmatchedItems.push(item.name);
          return { ...item, priceCents: 0 };
        }
        if (!line.matched || !cents(line.matched.priceCents) || line.matched.qty !== item.qty) throw invalid();
        // Retain the requested name so matching cannot erase gift-card/other risky rails.
        return { ...item, priceCents: line.matched.priceCents };
      });
      if (items.reduce((n, i) => n + i.qty * i.priceCents, 0) !== quote.subtotalCents) throw invalid();
      return { request: { ...request, items, amountCents: quote.totalCents }, fulfilment: {
        provider: quote.provider, storeName: quote.storeName, quoteId: quote.quoteId, unmatchedItems,
      } };
    },
  };
}
