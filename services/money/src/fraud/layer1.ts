import type { FraudSignal, OrderRequest } from '../contracts';
import { CASH_COURIER_PATTERNS, SECRECY_PATTERNS, normalize } from './text';

export const NEW_PAYEE_LIMIT_CENTS = 5000; // $50

export type HardRuleCode =
  | 'GIFT_CARD_NONMEMBER' | 'BLOCKED_CATEGORY' | 'NEW_PAYEE'
  | 'OVER_CAP' | 'SECRECY' | 'CASH_COURIER';

export interface HardRuleContext {
  circleMemberIds: ReadonlySet<string>;
  knownMerchantIds: ReadonlySet<string>;
  blockedCategories: ReadonlySet<string>;
  perPurchaseCapCents: number;
  monthlyCapCents: number;
  spentThisMonthCents: number;
}

// The contract's OrderType has no gift_card/wire/crypto values, so the payment
// rail is detected deterministically from what is being bought and from whom.
const RAIL_PATTERNS = {
  gift_card: /\bgift ?cards?\b|\bitunes\b|\bgoogle play\b|\bsteam (card|wallet)\b|\bprepaid (visa|card)s?\b|\bvanilla (visa|gift)\b|\breloadit\b|\bgreen ?dot\b/,
  wire: /\bwire\b|\bwired\b|\bwestern union\b|\bmoneygram\b/,
  crypto: /\bcrypto(currency)?\b|\bbitcoin\b|\bbtc\b|\bethereum\b|\busdt\b|\btether\b|\bcoinbase\b/,
  money_transfer: /\bzelle\b|\bvenmo\b|\bcash ?app\b|\bpaypal\b|\bmoney transfer\b|\bmoney order\b|\bsend (the )?money\b|\bsafe account\b/,
} as const;
export type Rail = keyof typeof RAIL_PATTERNS;

export function detectRails(req: OrderRequest): Rail[] {
  const what = normalize([req.payeeDescription, ...req.items.map((i) => i.name)].filter(Boolean).join(' | '));
  return (Object.keys(RAIL_PATTERNS) as Rail[]).filter((k) => RAIL_PATTERNS[k].test(what));
}

/** Category used for baselines: the payment rail if one is detected, else the order type. */
export const categoryOf = (req: OrderRequest): string => detectRails(req)[0] ?? req.type;

/** Never trust a lower client total: use the larger of amountCents and the priced items. */
export function effectiveAmountCents(req: OrderRequest): number {
  const itemsSum = req.items.reduce((s, i) => s + (i.priceCents ?? 0) * (i.qty || 0), 0);
  return Math.max(req.amountCents, itemsSum);
}

const sig = (code: HardRuleCode, description: string): FraudSignal => ({ layer: 1, code, description, weight: 0 });

/** Pure. Every signal returned is a hard stop that no model output can override. */
export function hardRules(req: OrderRequest, ctx: HardRuleContext): FraudSignal[] {
  const out: FraudSignal[] = [];
  const text = normalize([req.context.statedReason, req.context.transcriptExcerpt].filter(Boolean).join(' \n '));
  const rails = detectRails(req);
  const amount = effectiveAmountCents(req);

  if (rails.includes('gift_card') &&
      (!req.recipientMemberId || !ctx.circleMemberIds.has(req.recipientMemberId))) {
    out.push(sig('GIFT_CARD_NONMEMBER', 'Gift cards for someone outside the family circle'));
  }
  for (const rail of rails) {
    if (rail !== 'gift_card' && ctx.blockedCategories.has(rail)) {
      out.push(sig('BLOCKED_CATEGORY', `Payment by ${rail.replace('_', ' ')}, which is blocked`));
    }
  }
  const unknownPayee = !req.merchantId || !ctx.knownMerchantIds.has(req.merchantId);
  if (unknownPayee && amount > NEW_PAYEE_LIMIT_CENTS) {
    out.push(sig('NEW_PAYEE', 'A new, unknown payee for more than $50'));
  }
  if (amount > ctx.perPurchaseCapCents || ctx.spentThisMonthCents + amount > ctx.monthlyCapCents) {
    out.push(sig('OVER_CAP', 'Over the per-purchase or monthly limit'));
  }
  if (SECRECY_PATTERNS.some((p) => p.test(text))) {
    out.push(sig('SECRECY', 'The caller asked to keep it secret'));
  }
  if (CASH_COURIER_PATTERNS.some((p) => p.test(text))) {
    out.push(sig('CASH_COURIER', 'Someone plans to pick up cash in person'));
  }
  return out;
}
