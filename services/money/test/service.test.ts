import { describe, expect, it } from 'vitest';
import { COOLING_OFF_MS } from '../src/service';
import { DEMO_SCAM, GROCERIES, MIA, MEDICARE, NOW, setup } from './helpers';

const passkey = (holdId: string, member = 'mem_lisa') => ({ credentialId: `cred_${member}`, holdId, signature: 'sig' });

describe('orders', () => {
  it('low risk: draft → approved → confirm → paid with receipt, ledger + order.paid', async () => {
    const { service, events } = await setup();
    const before = (await service.credentials('sen_rose')).spentThisMonthCents;
    const o = await service.draft(GROCERIES);
    expect(o.status).toBe('approved');
    const paid = await service.confirm(o.id);
    expect(paid).toMatchObject({ status: 'paid', receiptUrl: expect.stringContaining(o.id) });
    expect((await service.credentials('sen_rose')).spentThisMonthCents).toBe(before + 5800);
    expect(events.sent.map((e) => e.name)).toEqual(['order.paid']);
    expect(await service.confirm(o.id)).toMatchObject({ status: 'paid' }); // idempotent
  });

  it('medium risk is approved (voice agent verifies first) and does not create a hold', async () => {
    const { service } = await setup();
    const o = await service.draft(MEDICARE);
    expect(o).toMatchObject({ status: 'approved', fraud: { risk: 'medium' } });
    expect(o.holdId).toBeUndefined();
  });

  it('confirm re-checks the monthly cap', async () => {
    const { service } = await setup();
    const big = { ...GROCERIES, items: [{ name: 'groceries', qty: 1, priceCents: 14000 }], amountCents: 14000 };
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await service.draft(big)).id);
    let rejected = 0;
    for (const id of ids) await service.confirm(id).catch((e) => { expect(e.code).toBe('OVER_CAP'); rejected++; });
    expect(rejected).toBeGreaterThan(0);
  });
});

describe('holds', () => {
  it('high risk: draft → held, hold open 24h, fraud.hold_created', async () => {
    const { service, events } = await setup();
    const o = await service.draft(DEMO_SCAM);
    expect(o.status).toBe('held');
    const [h] = await service.listHolds('sen_rose');
    expect(h).toMatchObject({ id: o.holdId, status: 'open', coolingOffUntil: new Date(NOW.getTime() + COOLING_OFF_MS).toISOString() });
    expect(events.sent[0]).toMatchObject({ name: 'fraud.hold_created', path: '/webhooks/fraud-hold' });
    await expect(service.confirm(o.id)).rejects.toMatchObject({ code: 'ORDER_NOT_CONFIRMABLE', statusCode: 409 });
  });

  it('cancel is always allowed (verbal, on the verification call)', async () => {
    const { service, events } = await setup();
    const o = await service.draft(DEMO_SCAM);
    const h = await service.resolveHold(o.holdId!, { decision: 'cancel', byMemberId: 'mem_danny', method: 'verbal_on_verification_call' });
    expect(h).toMatchObject({ status: 'cancelled', resolution: { decision: 'cancel', byMemberId: 'mem_danny' } });
    expect((await service.listOrders('sen_rose'))[0].status).toBe('cancelled');
    expect(events.sent.at(-1)?.name).toBe('fraud.hold_resolved');
  });

  it('high-risk release: verbal refused, bad passkey refused, good passkey works', async () => {
    const { service } = await setup();
    const o = await service.draft(DEMO_SCAM);
    const id = o.holdId!;
    await expect(service.resolveHold(id, { decision: 'release', byMemberId: 'mem_danny', method: 'verbal_on_verification_call' }))
      .rejects.toMatchObject({ code: 'PASSKEY_REQUIRED', statusCode: 403 });
    await expect(service.resolveHold(id, { decision: 'release', byMemberId: 'mem_lisa', method: 'passkey_web' }))
      .rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
    await expect(service.resolveHold(id, { decision: 'release', byMemberId: 'mem_lisa', method: 'passkey_web', passkeyAssertion: passkey(id, 'mem_danny') }))
      .rejects.toMatchObject({ code: 'PASSKEY_INVALID' }); // someone else's credential
    await expect(service.resolveHold(id, { decision: 'release', byMemberId: 'mem_lisa', method: 'passkey_web', passkeyAssertion: passkey('hold_other') }))
      .rejects.toMatchObject({ code: 'PASSKEY_INVALID' }); // bound to another hold
    const h = await service.resolveHold(id, { decision: 'release', byMemberId: 'mem_lisa', method: 'passkey_web', passkeyAssertion: passkey(id) });
    expect(h.status).toBe('released');
    expect(await service.confirm(o.id)).toMatchObject({ status: 'paid' });
  });

  it('strangers cannot resolve; resolved holds cannot be resolved again', async () => {
    const { service } = await setup();
    const o = await service.draft(DEMO_SCAM);
    await expect(service.resolveHold(o.holdId!, { decision: 'cancel', byMemberId: 'mem_kevin', method: 'verbal_on_verification_call' }))
      .rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await service.resolveHold(o.holdId!, { decision: 'cancel', byMemberId: 'mem_lisa', method: 'verbal_on_verification_call' });
    await expect(service.resolveHold(o.holdId!, { decision: 'cancel', byMemberId: 'mem_lisa', method: 'verbal_on_verification_call' }))
      .rejects.toMatchObject({ code: 'HOLD_NOT_OPEN' });
  });

  it('cooling-off expiry cancels, never auto-releases', async () => {
    const { service, clock, events } = await setup();
    const o = await service.draft(DEMO_SCAM);
    clock.set(new Date(NOW.getTime() + COOLING_OFF_MS - 1000));
    expect(await service.expireDueHolds()).toHaveLength(0);
    clock.set(new Date(NOW.getTime() + COOLING_OFF_MS + 1000));
    const [h] = await service.expireDueHolds();
    expect(h).toMatchObject({ id: o.holdId, status: 'expired_cooling_off' });
    expect(h.resolution).toBeUndefined();
    expect((await service.listOrders('sen_rose'))[0].status).toBe('cancelled');
    expect(events.sent.at(-1)?.name).toBe('fraud.hold_resolved');
    await expect(service.confirm(o.id)).rejects.toMatchObject({ code: 'ORDER_NOT_CONFIRMABLE' });
  });
});

it('Mia gift routed through Lisa stays low-risk and can be paid', async () => {
  const { service } = await setup();
  const order = await service.draft({ ...MIA, merchantId: 'mer_crumb', items: [{ name: 'Sweet Crumb Bakery gift card', qty: 1, priceCents: 2500 }] });
  expect(order.fraud.risk).toBe('low');
  expect(order.fraud.signals.map(s => s.code)).not.toContain('GIFT_CARD_NONMEMBER');
  expect((await service.confirm(order.id)).status).toBe('paid');
});
