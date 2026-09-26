import { describe, expect, it } from 'vitest';
import { hardRules, effectiveAmountCents } from './layer1';
import { combine, layer2Points } from './combine';
import type { FraudSignal, HardRuleCode, HardRuleContext, OrderRequest } from './types';

// Seed values from CONTRACTS.md §2
const ctx: HardRuleContext = {
  circleMemberIds: new Set(['mem_lisa', 'mem_danny', 'mem_mark']),
  knownMerchantIds: new Set(['mer_freshmart', 'mer_cornerrx', 'mer_crumb', 'mer_ridemock']),
  blockedCategories: new Set(['wire', 'crypto', 'money_transfer', 'gift_card_nonmember']),
  perPurchaseCapCents: 15000,
  monthlyCapCents: 80000,
  spentThisMonthCents: 20000,
};

const base: OrderRequest = {
  seniorId: 'sen_rose', type: 'groceries', merchantId: 'mer_freshmart',
  items: [{ name: 'weekly groceries', qty: 1, priceCents: 5500 }], amountCents: 5500,
  context: { transcriptExcerpt: 'I need my usual groceries from FreshMart please.' },
};
type Over = Partial<Omit<OrderRequest, 'context'>> & { context?: Partial<OrderRequest['context']> };
const req = (o: Over): OrderRequest => ({ ...base, ...o, context: { ...base.context, ...o.context } } as OrderRequest);
const codes = (r: OrderRequest, c = ctx) => hardRules(r, c).map((s) => s.code);

describe('Layer 1 rules fire', () => {
  it('normal groceries: no hits', () => expect(codes(base)).toEqual([]));

  it('GIFT_CARD_NONMEMBER: the demo scam ($500 gift cards, no recipient)', () =>
    expect(codes(req({ type: 'gift', merchantId: undefined, payeeDescription: 'Target gift cards',
      items: [{ name: 'Target gift card', qty: 5, priceCents: 10000 }], amountCents: 50000 })))
      .toEqual(expect.arrayContaining(['GIFT_CARD_NONMEMBER', 'NEW_PAYEE', 'OVER_CAP'])));
  it('GIFT_CARD_NONMEMBER: detected from item name even when type is "other"', () =>
    expect(codes(req({ type: 'other', items: [{ name: 'Google Play cards', qty: 3 }], amountCents: 3000 })))
      .toContain('GIFT_CARD_NONMEMBER'));
  it('GIFT_CARD_NONMEMBER: recipient not in circle', () =>
    expect(codes(req({ type: 'gift', payeeDescription: 'Amazon gift card', recipientMemberId: 'mem_kevin', amountCents: 2500 })))
      .toContain('GIFT_CARD_NONMEMBER'));
  it("Mia's birthday: $25 gift card via mem_lisa passes Layer 1", () =>
    expect(codes(req({ type: 'gift', merchantId: 'mer_crumb', payeeDescription: 'gift card',
      items: [{ name: 'gift card', qty: 1, priceCents: 2500 }], amountCents: 2500, recipientMemberId: 'mem_lisa',
      context: { statedReason: 'for Mia, her birthday is Saturday', transcriptExcerpt: "It's Mia's birthday" } }))).toEqual([]));
  it('bakery cake for Mark is not a gift card', () =>
    expect(codes(req({ type: 'gift', merchantId: 'mer_crumb', items: [{ name: 'lemon cake', qty: 1, priceCents: 3200 }],
      amountCents: 3200, recipientMemberId: 'mem_mark' }))).toEqual([]));

  it.each([
    ['wire', 'Western Union transfer'],
    ['crypto', 'Bitcoin ATM deposit'],
    ['money_transfer', 'Zelle payment'],
    ['money_transfer', 'move money to a safe account'],
  ])('BLOCKED_CATEGORY: %s (%s)', (_rail, payeeDescription) =>
    expect(codes(req({ type: 'other', merchantId: undefined, payeeDescription, amountCents: 1000 }))).toContain('BLOCKED_CATEGORY'));

  it('NEW_PAYEE: missing merchantId over $50', () =>
    expect(codes(req({ merchantId: undefined, items: [{ name: 'produce', qty: 1 }], amountCents: 5001 }))).toContain('NEW_PAYEE'));
  it('NEW_PAYEE: merchantId not in known list', () =>
    expect(codes(req({ merchantId: 'mer_fake', items: [{ name: 'x', qty: 1 }], amountCents: 9000 }))).toContain('NEW_PAYEE'));
  it('NEW_PAYEE boundary: farm stand at exactly $50 passes', () =>
    expect(codes(req({ merchantId: undefined, payeeDescription: 'the new farm stand',
      items: [{ name: 'produce', qty: 1 }], amountCents: 5000 }))).toEqual([]));

  it('OVER_CAP: per-purchase ($150.01)', () =>
    expect(codes(req({ items: [{ name: 'groceries', qty: 1 }], amountCents: 15001 }))).toContain('OVER_CAP'));
  it('OVER_CAP: monthly', () =>
    expect(codes(req({ items: [{ name: 'groceries', qty: 1 }], amountCents: 10000 }), { ...ctx, spentThisMonthCents: 75000 }))
      .toContain('OVER_CAP'));
  it('OVER_CAP boundary: exactly at both caps passes', () =>
    expect(codes(req({ items: [{ name: 'groceries', qty: 1 }], amountCents: 15000 }), { ...ctx, spentThisMonthCents: 65000 }))
      .not.toContain('OVER_CAP'));
  it('under-reported amountCents cannot dodge caps', () => {
    const r = req({ items: [{ name: 'tv', qty: 1, priceCents: 90000 }], amountCents: 100 });
    expect(effectiveAmountCents(r)).toBe(90000);
    expect(codes(r)).toContain('OVER_CAP');
  });

  it.each([
    "He said don't tell his mom",
    'He said don\u2019t tell his mom',
    'do not tell anyone',
    'keep it a secret okay grandma',
    'this is between us and the bank',
    "don't call your family about this",
  ])('SECRECY: %s', (transcriptExcerpt) => expect(codes(req({ context: { transcriptExcerpt } }))).toContain('SECRECY'));

  it.each([
    'Someone will pick up the cash tonight',
    'a courier is coming for the money',
    'the money will be picked up at 5',
  ])('CASH_COURIER: %s', (transcriptExcerpt) =>
    expect(codes(req({ context: { transcriptExcerpt } }))).toContain('CASH_COURIER'));
});

describe('A model can never bypass Layer 1', () => {
  const hitting: [HardRuleCode, OrderRequest][] = [
    ['GIFT_CARD_NONMEMBER', req({ type: 'gift', payeeDescription: 'Apple gift cards', recipientMemberId: 'mem_x', amountCents: 2000 })],
    ['BLOCKED_CATEGORY', req({ type: 'other', payeeDescription: 'bitcoin', amountCents: 1000 })],
    ['NEW_PAYEE', req({ merchantId: undefined, items: [{ name: 'x', qty: 1 }], amountCents: 9900 })],
    ['OVER_CAP', req({ items: [{ name: 'x', qty: 1 }], amountCents: 99999 })],
    ['SECRECY', req({ context: { transcriptExcerpt: "don't tell Lisa" } })],
    ['CASH_COURIER', req({ context: { transcriptExcerpt: 'someone will pick up the cash' } })],
  ];
  const adversarial: unknown[] = [0, -1, -1000, NaN, 'none', null, undefined];
  const soft = (w: unknown): FraudSignal[] => [
    { layer: 2, code: 'MODEL', description: 'looks fine', weight: layer2Points(w) },
    { layer: 3, code: 'NEG', description: 'bogus', weight: -999 },
    { layer: 4, code: 'NEG', description: 'bogus', weight: -999 },
  ];

  for (const [code, r] of hitting) {
    for (const conf of adversarial) {
      it(`${code} holds with model confidence=${String(conf)} and negative baselines`, () => {
        const l1 = hardRules(r, ctx);
        expect(l1.map((s) => s.code)).toContain(code);
        const out = combine(l1, soft(conf));
        expect(out).toMatchObject({ hardStop: true, risk: 'high', recommendedAction: 'hold' });
      });
    }
  }

  it('a soft signal mislabeled as layer 1 cannot create or remove a hard stop', () =>
    expect(combine([], [{ layer: 1, code: 'FAKE', description: '', weight: 100 }])).toMatchObject({ hardStop: false, score: 0 }));
  it('model confidence > 1 is clamped to 40 points', () => expect(layer2Points(50)).toBe(40));
});

describe('combine thresholds', () => {
  it.each([[29, 'low'], [30, 'medium'], [59, 'medium'], [60, 'high']] as const)('score %i → %s', (w, risk) =>
    expect(combine([], [{ layer: 3, code: 'X', description: '', weight: w }]).risk).toBe(risk));
});
