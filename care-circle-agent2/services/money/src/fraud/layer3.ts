import type { FraudSignal, OrderRequest } from '../contracts';
import type { LedgerEntry } from '../store/store';
import { categoryOf, effectiveAmountCents } from './layer1';
import { fmtUsd } from './text';

export const W = { NEW_MERCHANT: 10, BIG_AMOUNT: 15, ODD_HOUR: 10, NEW_CATEGORY: 10 } as const;

export function localHour(now: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Personal baseline against Rose's own last 60 days. */
export function baselineSignals(req: OrderRequest, ledger: LedgerEntry[], now: Date, tz: string): FraudSignal[] {
  const out: FraudSignal[] = [];
  const merchants = new Set(ledger.map((e) => e.merchantId).filter(Boolean));
  const categories = new Set(ledger.map((e) => e.category));
  const amount = effectiveAmountCents(req);
  const med = median(ledger.map((e) => e.amountCents));
  const hour = localHour(now, tz);
  const cat = categoryOf(req);

  if (!req.merchantId || !merchants.has(req.merchantId)) {
    out.push({ layer: 3, code: 'NEW_MERCHANT', weight: W.NEW_MERCHANT,
      description: `A store or payee Rose hasn't used before${req.payeeDescription ? ` (${req.payeeDescription})` : ''}` });
  }
  if (med > 0 && amount > 5 * med) {
    out.push({ layer: 3, code: 'BIG_AMOUNT', weight: W.BIG_AMOUNT,
      description: `${fmtUsd(amount)} is more than 5 times her usual ${fmtUsd(med)}` });
  }
  if (hour < 7 || hour >= 22) {
    out.push({ layer: 3, code: 'ODD_HOUR', weight: W.ODD_HOUR,
      description: 'Requested at an hour Rose doesn\'t usually shop (before 7am or after 10pm)' });
  }
  if (!categories.has(cat)) {
    out.push({ layer: 3, code: 'NEW_CATEGORY', weight: W.NEW_CATEGORY,
      description: `A kind of purchase Rose hasn't made before (${cat.replace('_', ' ')})` });
  }
  return out;
}
