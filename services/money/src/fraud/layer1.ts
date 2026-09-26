import type { FraudSignal, HardRuleCode, HardRuleContext, OrderRequest } from './types';

export const NEW_PAYEE_LIMIT_CENTS = 5000; // $50

export function normalize(s = ''): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bdont\b/g, "don't")
    .replace(/\s+/g, ' ')
    .trim();
}

// The contract's OrderType has no gift_card/wire/crypto values, so the payment
// rail is detected deterministically from what is being bought and from whom.
const RAIL_PATTERNS: Record<'gift_card' | 'wire' | 'crypto' | 'money_transfer', RegExp> = {
  gift_card: /\bgift ?cards?\b|\bitunes\b|\bgoogle play\b|\bsteam (card|wallet)\b|\bprepaid (visa|card)s?\b|\bvanilla (visa|gift)\b|\breloadit\b|\bgreen ?dot\b/,
  wire: /\bwire\b|\bwestern union\b|\bmoneygram\b/,
  crypto: /\bcrypto(currency)?\b|\bbitcoin\b|\bbtc\b|\bethereum\b|\busdt\b|\btether\b|\bcoinbase\b/,
  money_transfer: /\bzelle\b|\bvenmo\b|\bcash ?app\b|\bpaypal\b|\bmoney transfer\b|\bmoney order\b|\bsend (the )?money\b|\bsafe account\b/,
};

const SECRECY_PATTERNS: RegExp[] = [
  /\bdon't tell\b/,
  /\bkeep (it|this|that) (a )?secret\b/,
  /\bbetween (you and me|us)\b/,
  /\bdon't (call|contact|talk to) (your|the) (family|kids|children|son|daughter|bank)\b/,
];

const CASH_COURIER_PATTERNS: RegExp[] = [
  /\b(someone|somebody|a courier|a driver|an agent|a man|a woman|my (friend|associate|lawyer))\b.{0,40}\b(pick up|pick-up|collect|come get|come for)\b.{0,20}\b(cash|money|the envelope)\b/,
  /\bcourier\b.{0,40}\b(cash|money)\b/,
  /\b(cash|money)\b.{0,30}\b(will be|to be|gets?) (picked up|collected)\b/,
];

export function detectRails(req: OrderRequest): string[] {
  const what = normalize([req.payeeDescription, ...req.items.map((i) => i.name)].filter(Boolean).join(' | '));
  return (Object.keys(RAIL_PATTERNS) as (keyof typeof RAIL_PATTERNS)[]).filter((k) => RAIL_PATTERNS[k].test(what));
}

/** Never trust a lower client total: use the larger of amountCents and the priced items. */
export function effectiveAmountCents(req: OrderRequest): number {
  const itemsSum = req.items.reduce((s, i) => s + (i.priceCents ?? 0) * (i.qty || 0), 0);
  return Math.max(req.amountCents, itemsSum);
}

const sig = (code: HardRuleCode, description: string): FraudSignal => ({ layer: 1, code, description, weight: 0 });

/** Pure. Every signal returned is a hard stop no model output can override. */
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
      out.push(sig('BLOCKED_CATEGORY', `Payment by ${rail.replace('_', ' ')} is blocked`));
    }
  }

  const unknownPayee = !req.merchantId || !ctx.knownMerchantIds.has(req.merchantId);
  if (unknownPayee && amount > NEW_PAYEE_LIMIT_CENTS) {
    out.push(sig('NEW_PAYEE', 'New or unknown payee for more than $50'));
  }

  if (amount > ctx.perPurchaseCapCents || ctx.spentThisMonthCents + amount > ctx.monthlyCapCents) {
    out.push(sig('OVER_CAP', 'Over the per-purchase or monthly limit'));
  }

  if (SECRECY_PATTERNS.some((p) => p.test(text))) {
    out.push(sig('SECRECY', 'Someone asked to keep this secret'));
  }

  if (CASH_COURIER_PATTERNS.some((p) => p.test(text))) {
    out.push(sig('CASH_COURIER', 'Someone plans to pick up cash in person'));
  }

  return out;
}
