import { describe, expect, it } from 'vitest';
import { hardRules } from './layer1';
import { combine } from './combine';
import type { HardRuleCode, HardRuleContext, OrderRequest } from './types';

const ctx: HardRuleContext = {
  circleMemberIds: new Set(['mem_lisa', 'mem_danny', 'mem_mark']),
  blockedCategories: new Set(['wire', 'crypto', 'money_transfer']),
  perPurchaseCapCents: 20000,   // $200
  monthlyCapCents: 60000,       // $600
  spentThisMonthCents: 10000,
};

const base: OrderRequest = {
  seniorId: 'sen_rose', merchantId: 'm_freshmart', category: 'groceries',
  amountCents: 5500, items: [{ name: 'groceries', qty: 1, priceCents: 5500 }],
  requestedAt: '2026-11-20T15:00:00Z',
};
const req = (o: Partial<OrderRequest>): OrderRequest => ({ ...base, ...o });
const codes = (r: OrderRequest, c = ctx) => hardRules(r, c).map((h) => h.code);

describe('Layer 1 rules fire', () => {
  it('normal groceries: no hits', () => expect(codes(base)).toEqual([]));

  it('GIFT_CARD_NONMEMBER: missing recipient', () =>
    expect(codes(req({ category: 'gift_card', merchantId: 'm_giftco' }))).toContain('GIFT_CARD_NONMEMBER'));
  it('GIFT_CARD_NONMEMBER: stranger recipient', () =>
    expect(codes(req({ category: 'gift_card', recipientMemberId: 'mem_scammer' }))).toContain('GIFT_CARD_NONMEMBER'));
  it("Mia's birthday gift card via mem_lisa passes", () =>
    expect(codes(req({ category: 'gift_card', merchantId: 'm_giftco', amountCents: 2500,
      recipientMemberId: 'mem_lisa', note: 'for Mia' }))).toEqual([]));

  it.each(['wire', 'crypto', 'money_transfer'] as const)('BLOCKED_CATEGORY: %s', (category) =>
    expect(codes(req({ category, amountCents: 1000 }))).toContain('BLOCKED_CATEGORY'));

  it('NEW_PAYEE: $50.01 unknown payee', () =>
    expect(codes(req({ merchantId: null, amountCents: 5001 }))).toContain('NEW_PAYEE'));
  it('NEW_PAYEE boundary: exactly $50 passes', () =>
    expect(codes(req({ merchantId: null, amountCents: 5000 }))).not.toContain('NEW_PAYEE'));

  it('OVER_CAP: per-purchase', () =>
    expect(codes(req({ amountCents: 20001 }))).toContain('OVER_CAP'));
  it('OVER_CAP: monthly', () =>
    expect(codes(req({ amountCents: 15000 }), { ...ctx, spentThisMonthCents: 50000 })).toContain('OVER_CAP'));
  it('OVER_CAP boundary: exactly at caps passes', () =>
    expect(codes(req({ amountCents: 20000 }), { ...ctx, spentThisMonthCents: 40000 })).not.toContain('OVER_CAP'));

  it.each([
    "Please don't tell your mom",
    'Please don\u2019t tell your mom',          // curly apostrophe
    'do not tell anyone',
    'keep it a secret okay grandma',
    'this is between us and the bank',
    "don't call your family about this",
  ])('SECRECY: %s', (transcriptExcerpt) =>
    expect(codes(req({ transcriptExcerpt }))).toContain('SECRECY'));

  it.each([
    'Someone will pick up the cash tonight',
    'a courier is coming for the money',
    'the money will be picked up at 5',
  ])('CASH_COURIER: %s', (transcriptExcerpt) =>
    expect(codes(req({ transcriptExcerpt }))).toContain('CASH_COURIER'));
});

describe('A model can never bypass Layer 1', () => {
  const hitting: [HardRuleCode, OrderRequest][] = [
    ['GIFT_CARD_NONMEMBER', req({ category: 'gift_card', recipientMemberId: 'mem_x' })],
    ['BLOCKED_CATEGORY', req({ category: 'crypto' })],
    ['NEW_PAYEE', req({ merchantId: null, amountCents: 9900 })],
    ['OVER_CAP', req({ amountCents: 99999 })],
    ['SECRECY', req({ statedReason: "don't tell Lisa" })],
    ['CASH_COURIER', req({ transcriptExcerpt: 'someone will pick up the cash' })],
  ];
  const adversarialModelOutputs: unknown[] = [0, -1, -1000, NaN, 'none', null, undefined];

  for (const [code, r] of hitting) {
    for (const conf of adversarialModelOutputs) {
      it(`${code} holds even when model confidence = ${String(conf)} and baselines are negative`, () => {
        const hits = hardRules(r, ctx);
        expect(hits.map((h) => h.code)).toContain(code);
        const out = combine(hits, { layer2Confidence: conf, layer3: -999, layer4: -999 });
        expect(out.hardStop).toBe(true);
        expect(out.risk).toBe('high');
        expect(out.recommendedAction).toBe('hold');
      });
    }
  }

  it('model confidence > 1 is clamped to 40 points', () =>
    expect(combine([], { layer2Confidence: 50, layer3: 0, layer4: 0 }).score).toBe(40));
});

describe('combine thresholds', () => {
  it.each([[29, 'low'], [30, 'medium'], [59, 'medium'], [60, 'high']] as const)('score %i → %s', (s, risk) =>
    expect(combine([], { layer2Confidence: 0, layer3: s, layer4: 0 }).risk).toBe(risk));
});
