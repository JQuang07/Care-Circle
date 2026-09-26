import type { HardRuleContext, HardRuleHit, OrderRequest } from './types';

export const NEW_PAYEE_LIMIT_CENTS = 5000; // $50

// Normalize so curly quotes / "do not" / extra spaces can't dodge the patterns.
export function normalize(s = ''): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bdont\b/g, "don't")
    .replace(/\s+/g, ' ')
    .trim();
}

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

/** Pure. Every hit is a hard stop that no model output can override. */
export function hardRules(req: OrderRequest, ctx: HardRuleContext): HardRuleHit[] {
  const hits: HardRuleHit[] = [];
  const text = normalize([req.statedReason, req.transcriptExcerpt, req.note].filter(Boolean).join(' \n '));

  if (req.category === 'gift_card' &&
      (!req.recipientMemberId || !ctx.circleMemberIds.has(req.recipientMemberId))) {
    hits.push({ code: 'GIFT_CARD_NONMEMBER', detail: 'Gift card recipient is not a circle member' });
  }

  if (ctx.blockedCategories.has(req.category)) {
    hits.push({ code: 'BLOCKED_CATEGORY', detail: `Category ${req.category} is blocked` });
  }

  if (!req.merchantId && req.amountCents > NEW_PAYEE_LIMIT_CENTS) {
    hits.push({ code: 'NEW_PAYEE', detail: 'Unknown payee over $50' });
  }

  if (req.amountCents > ctx.perPurchaseCapCents ||
      ctx.spentThisMonthCents + req.amountCents > ctx.monthlyCapCents) {
    hits.push({ code: 'OVER_CAP', detail: 'Exceeds per-purchase or monthly cap' });
  }

  if (SECRECY_PATTERNS.some((p) => p.test(text))) {
    hits.push({ code: 'SECRECY', detail: 'Secrecy language in request context' });
  }

  if (CASH_COURIER_PATTERNS.some((p) => p.test(text))) {
    hits.push({ code: 'CASH_COURIER', detail: 'Cash pickup by a third party mentioned — alert family' });
  }

  return hits;
}
