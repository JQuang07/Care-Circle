import { afterEach, expect, it, vi } from 'vitest';
import { httpDelivery } from '../src/delivery';
import { GROCERIES, NOW, setup } from './helpers';
const request = { ...GROCERIES, amountCents: 1, items: [{ name: 'whole milk', qty: 2, priceCents: 1 }] };
const quote = { quoteId: 'quote1', provider: 'mock', storeName: 'FreshMart', expiresAt: '2026-11-19T19:00:00Z',
  subtotalCents: 858, feesCents: 299, totalCents: 1157,
  lines: [{ requested: 'whole milk', qty: 2, status: 'matched', matched: { name: 'Whole Milk', qty: 2, priceCents: 429 } }] };
const client = () => httpDelivery('http://delivery.test', 'private-test', () => {}, () => NOW);
afterEach(() => vi.unstubAllGlobals());
it('uses authenticated quotes including fees before assessing and charging', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(quote)));
  vi.stubGlobal('fetch', fetch);
  const { service, store } = await setup({ delivery: client() });
  const order = await service.draft(request);
  expect(order.request.amountCents).toBe(1157);
  expect(order.request.items[0].priceCents).toBe(429);
  expect(order.fulfilment).toMatchObject({ quoteId: 'quote1', unmatchedItems: [] });
  expect(fetch.mock.calls[0][1].headers['x-cc-secret']).toBe('private-test');
  await service.confirm(order.id);
  expect((await store.getLedger('sen_rose', NOW.toISOString()))[0].amountCents).toBe(1157);
});
it('holds over-cap quotes even if caller supplied a tiny amount', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...quote, subtotalCents: 20000, totalCents: 20299,
    lines: [{ ...quote.lines[0], matched: { name: 'Whole Milk', qty: 2, priceCents: 10000 } }] }))));
  const { service } = await setup({ delivery: client() });
  expect((await service.draft(request)).status).toBe('held');
});
it('falls back to known FreshMart prices without a quote when unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const priced = await client().price(request);
  expect(priced.request.amountCents).toBe(858);
  expect(priced.fulfilment.quoteId).toBeUndefined();
});
it('retains unmatched item names and blocks payment', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...quote, subtotalCents: 0, totalCents: 299,
    lines: [{ requested: 'whole milk', qty: 2, status: 'ambiguous' }] }))));
  const { service } = await setup({ delivery: client() });
  const order = await service.draft(request);
  expect(order.request.items[0].name).toBe('whole milk');
  await expect(service.confirm(order.id)).rejects.toMatchObject({ code: 'UNMATCHED_ITEMS' });
});
it('rejects inconsistent or expired quotes rather than charging the caller amount', async () => {
  for (const invalid of [{ ...quote, totalCents: 1 }, { ...quote, expiresAt: '2020-01-01' }, { ...quote, lines: [] }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid))));
    await expect(client().price(request)).rejects.toMatchObject({ code: 'INVALID_QUOTE' });
  }
});

it('dispatches only after payment, once, with the exact amount charged; failure never un-pays', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(quote)));
  vi.stubGlobal('fetch', fetch);
  const delivery = client();
  const fulfil = vi.spyOn(delivery, 'fulfil').mockRejectedValue(new Error('offline'));
  const { service, store } = await setup({ delivery });
  const order = await service.draft(request);
  expect(fulfil).not.toHaveBeenCalled();
  expect((await service.confirm(order.id)).status).toBe('paid');
  await Promise.resolve();
  expect(fulfil).toHaveBeenCalledWith(expect.objectContaining({ id: order.id, status: 'paid' }), 1157);
  expect((await store.getOrder(order.id))?.status).toBe('paid');
  await service.confirm(order.id);
  expect(fulfil).toHaveBeenCalledTimes(1);
});
it('sends the delivery dispatch contract and shared secret', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const { service } = await setup();
  const order = await service.draft(request);
  order.fulfilment = { provider: 'mock', storeName: 'FreshMart', quoteId: 'quote1' };
  await client().fulfil(order, 1157);
  expect(fetch.mock.calls[0][0]).toBe('http://delivery.test/orders');
  expect(fetch.mock.calls[0][1].headers['x-cc-secret']).toBe('private-test');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ orderId: order.id, seniorId: 'sen_rose', quoteId: 'quote1', approvedAmountCents: 1157 });
});
it('hard-stops a $200 Apple gift card through a DoorDash grocery quote', async () => {
  const name = '$200 Apple gift card';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...quote,
    provider: 'doordash_thirdparty', storeName: 'DoorDash grocery store', subtotalCents: 20000, totalCents: 20299,
    lines: [{ requested: name, qty: 1, status: 'matched', matched: { name: 'Apple prepaid', qty: 1, priceCents: 20000 } }] }))));
  const { service } = await setup({ delivery: client() });
  const order = await service.draft({ ...request, items: [{ name, qty: 1 }] });
  expect(order.status).toBe('held');
  expect(order.fraud.hardStop).toBe(true);
  expect(order.fraud.signals.map(s => s.code)).toContain('GIFT_CARD_NONMEMBER');
  await expect(service.confirm(order.id)).rejects.toMatchObject({ code: 'ORDER_NOT_CONFIRMABLE' });
});
it('keeps gift-card hard stops when delivery cannot match the item', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const { service } = await setup({ delivery: client() });
  const order = await service.draft({ ...request, items: [{ name: '$200 Apple gift card', qty: 1 }] });
  expect(order.fraud.signals.map(s => s.code)).toContain('GIFT_CARD_NONMEMBER');
  expect(order.status).toBe('held');
});
