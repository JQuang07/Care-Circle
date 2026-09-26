import { expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateHistory } from '../src/seed';
import { DEMO_SCAM, GROCERIES, NOW, setup } from './helpers';
it('requires the secret, clears only owned order/hold/ledger state and restores seed idempotently', async () => {
  const { service, store } = await setup();
  const seed = await service.credentials('sen_rose');
  await service.confirm((await service.draft(GROCERIES)).id);
  await service.draft(DEMO_SCAM);
  const a = buildApp({ service, mock: true, secret: 'test', evalResultsPath: '' });
  expect((await a.inject({ method: 'POST', url: '/demo/reset' })).statusCode).toBe(401);
  expect(await service.listOrders('sen_rose')).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    const r = await a.inject({ method: 'POST', url: '/demo/reset', headers: { 'x-cc-secret': 'test' } });
    expect(r.json()).toEqual({ ok: true });
    expect(await service.listOrders('sen_rose')).toEqual([]);
    expect(await service.listHolds('sen_rose')).toEqual([]);
    expect(await store.countLedger('sen_rose')).toBe(generateHistory(NOW).length);
    expect(await service.credentials('sen_rose')).toEqual(seed);
  }
  await a.close();
});
it('does not expose reset if the server has no configured secret', async () => {
  const { service } = await setup();
  const a = buildApp({ service, mock: true, evalResultsPath: '' });
  expect((await a.inject({ method: 'POST', url: '/demo/reset' })).statusCode).toBe(503);
  await a.close();
});
