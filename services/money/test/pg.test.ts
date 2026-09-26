import { afterAll, describe, expect, it } from 'vitest';
import { buildService } from '../src/deps';
import { RecordingEvents } from '../src/events';
import { seedFamilyClient } from '../src/family';
import { mockPayments } from '../src/payments';
import { generateHistory } from '../src/seed';
import { PgStore } from '../src/store/pg';
import { DEMO_SCAM, GROCERIES, NOW } from './helpers';

// Runs only when TEST_DATABASE_URL is set (e.g. docker Postgres from Agent 4's scaffold).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PgStore (money schema)', () => {
  const store = new PgStore(url!);
  afterAll(() => store.close());

  it('orders, holds, ledger, and cooling-off round-trip through Postgres', async () => {
    await store.init();
    if ((await store.countLedger('sen_rose')) === 0) await store.addLedger(generateHistory(NOW));
    let now = NOW;
    const s = buildService({ store, family: seedFamilyClient(() => now), payments: mockPayments,
      events: new RecordingEvents(), llm: null, now: () => now });

    const g = await s.draft(GROCERIES);
    expect((await s.confirm(g.id)).status).toBe('paid');
    expect((await store.getOrder(g.id))?.receiptUrl).toBeTruthy();

    const held = await s.draft(DEMO_SCAM);
    expect((await store.getHold(held.holdId!))?.status).toBe('open');
    now = new Date(NOW.getTime() + 25 * 3600_000);
    const expired = await s.expireDueHolds();
    expect(expired.map((h) => h.id)).toContain(held.holdId);
    expect((await store.getOrder(held.id))?.status).toBe('cancelled');
  });
});
