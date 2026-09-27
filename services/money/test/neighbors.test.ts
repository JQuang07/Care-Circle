import { afterEach, expect, it, vi } from 'vitest';
import { selectNeighbors } from '../src/neighbors';
import { RecordingEvents } from '../src/events';
import { SEED_CIRCLE } from '../src/seed';
import { setup, GROCERIES } from './helpers';
afterEach(() => vi.unstubAllGlobals());
it('MOCK=1 still uses HTTP neighbors and authenticated family events', async () => {
  const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(SEED_CIRCLE), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const deps = selectNeighbors({ MOCK: '1', MOCK_DEPENDENCIES: '0', FAMILY_URL: 'http://family.test', CC_INTERNAL_SECRET: 'test-secret' }, () => new Date(), () => {});
  await deps.family.getCircle('sen_rose');
  const { service } = await setup();
  deps.events.emit('order.paid', await service.draft(GROCERIES));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1][0]).toBe('http://family.test/webhooks/order-paid');
  expect((fetch.mock.calls[1][1]!.headers as Record<string, string>)['X-CC-Secret']).toBe('test-secret');
});
it('MOCK_DEPENDENCIES=1 explicitly uses fake neighbors', () => {
  const deps = selectNeighbors({ MOCK_DEPENDENCIES: '1', FAMILY_URL: 'http://family.test' }, () => new Date(), () => {});
  expect(deps.events).toBeInstanceOf(RecordingEvents);
});
it('mock external providers do not bypass per-purchase hard stops', async () => {
  const { service } = await setup({ mock: true });
  const order = await service.draft({ ...GROCERIES, amountCents: 20000 });
  expect(order.status).toBe('held');
  expect(order.fraud.signals.some((s) => s.code === 'OVER_CAP')).toBe(true);
});
