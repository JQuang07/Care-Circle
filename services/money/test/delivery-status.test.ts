import { expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { GROCERIES, setup } from './helpers';

it('authenticates, validates and persists idempotent delivery events without regressions', async () => {
  const { service, store } = await setup();
  const order = await service.draft(GROCERIES);
  order.fulfilment = { provider: 'mock', storeName: 'FreshMart', quoteId: 'q1' };
  await store.saveOrder(order);
  const a = buildApp({ service, mock: true, secret: 'test', evalResultsPath: '' });
  const payload = { orderId: order.id, deliveryId: 'd1', status: 'delivered', etaText: 'Arrived' };
  const post = (body: Record<string, unknown>, headers = { 'x-cc-secret': 'test' }) => a.inject({ method: 'POST', url: '/webhooks/delivery-status', headers, payload: body });
  expect((await post(payload, { 'x-cc-secret': '' })).statusCode).toBe(401);
  expect((await post({ ...payload, status: 'invented' })).statusCode).toBe(400);
  expect((await post(payload)).statusCode).toBe(409);
  await service.confirm(order.id);
  expect((await post(payload)).statusCode).toBe(200);
  await post(payload);
  await post({ ...payload, status: 'placed' });
  expect((await service.getOrder(order.id)).fulfilment?.delivery).toEqual({ deliveryId: 'd1', status: 'delivered', etaText: 'Arrived' });
  expect((await post({ ...payload, deliveryId: 'wrong' })).statusCode).toBe(409);
  await a.close();
});
