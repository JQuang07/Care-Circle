import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { DEMO_SCAM, GROCERIES, MIA, setup } from './helpers';

const H = { 'x-cc-secret': 's3cret' };

async function app(mock = false) {
  const { service } = await setup({ mock });
  return buildApp({ service, mock, secret: 's3cret', evalResultsPath: '/nonexistent/latest.json' });
}

describe('HTTP API', () => {
  it('health is open and reports mock', async () => {
    const a = await app(true);
    const r = await a.inject({ method: 'GET', url: '/health' });
    expect(r.json()).toEqual({ ok: true, service: 'money', mock: true });
  });

  it('requires X-CC-Secret with the contract error shape', async () => {
    const a = await app();
    const r = await a.inject({ method: 'GET', url: '/credentials/sen_rose' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  });

  it('bad body → 400 BAD_REQUEST', async () => {
    const a = await app();
    const r = await a.inject({ method: 'POST', url: '/fraud/assess', headers: H, payload: { seniorId: 'sen_rose' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('BAD_REQUEST');
  });

  it('full flow over HTTP: draft → held → cancel', async () => {
    const a = await app();
    const d = (await a.inject({ method: 'POST', url: '/orders/draft', headers: H, payload: DEMO_SCAM })).json();
    expect(d.status).toBe('held');
    const holds = (await a.inject({ method: 'GET', url: '/holds?seniorId=sen_rose', headers: H })).json();
    expect(holds[0].id).toBe(d.holdId);
    const r = await a.inject({ method: 'POST', url: `/holds/${d.holdId}/resolve`, headers: H,
      payload: { decision: 'release', byMemberId: 'mem_danny', method: 'verbal_on_verification_call' } });
    expect(r.statusCode).toBe(403);
    const c = await a.inject({ method: 'POST', url: `/holds/${d.holdId}/resolve`, headers: H,
      payload: { decision: 'cancel', byMemberId: 'mem_danny', method: 'verbal_on_verification_call' } });
    expect(c.json().status).toBe('cancelled');
  });

  it('groceries pay and credentials reflect spend', async () => {
    const a = await app();
    const d = (await a.inject({ method: 'POST', url: '/orders/draft', headers: H, payload: GROCERIES })).json();
    const p = (await a.inject({ method: 'POST', url: `/orders/${d.id}/confirm`, headers: H })).json();
    expect(p.status).toBe('paid');
    const c = (await a.inject({ method: 'GET', url: '/credentials/sen_rose', headers: H })).json();
    expect(c).toMatchObject({ perPurchaseCapCents: 15000, monthlyCapCents: 80000, spentThisMonthCents: expect.any(Number) });
    const orders = (await a.inject({ method: 'GET', url: '/orders?seniorId=sen_rose', headers: H })).json();
    expect(orders[0].id).toBe(d.id);
  });

  it('MOCK=1 returns canned low/high per contract', async () => {
    const a = await app(true);
    const hi = (await a.inject({ method: 'POST', url: '/fraud/assess', headers: H, payload: DEMO_SCAM })).json();
    expect(hi).toMatchObject({ risk: 'high', hardStop: true, suggestedVerifierId: 'mem_danny' });
    const lo = (await a.inject({ method: 'POST', url: '/fraud/assess', headers: H, payload: MIA })).json();
    expect(lo.risk).toBe('low');
  });

  it('eval results 404 before a run', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/eval/results', headers: H })).statusCode).toBe(404);
  });

  it('looks up a draft and returns the contract 404 for missing orders', async () => {
    const a = await app();
    const d = (await a.inject({ method: 'POST', url: '/orders/draft', headers: H, payload: GROCERIES })).json();
    expect((await a.inject({ method: 'GET', url: `/orders/${d.id}`, headers: H })).json()).toEqual(d);
    const missing = await a.inject({ method: 'GET', url: '/orders/missing', headers: H });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: 'ORDER_NOT_FOUND', message: expect.any(String) } });
  });

  it('unknown order → 404' , async () => {
    const a = await app();
    const r = await a.inject({ method: 'POST', url: '/orders/ord_nope/confirm', headers: H });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('ORDER_NOT_FOUND');
  });
});
