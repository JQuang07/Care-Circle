import pg from 'pg';
import type { Hold, Order } from '../contracts';
import type { LedgerEntry, Store } from './store';

// Agent 2 writes only to the `money` schema (CONTRACTS.md §1).
const DDL = `
CREATE SCHEMA IF NOT EXISTS money;
CREATE TABLE IF NOT EXISTS money.ledger (
  id text PRIMARY KEY, senior_id text NOT NULL, at timestamptz NOT NULL,
  merchant_id text, category text NOT NULL, amount_cents integer NOT NULL, label text);
CREATE INDEX IF NOT EXISTS ledger_senior_at ON money.ledger (senior_id, at);
CREATE TABLE IF NOT EXISTS money.orders (
  id text PRIMARY KEY, senior_id text NOT NULL, created_at timestamptz NOT NULL, doc jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS money.holds (
  id text PRIMARY KEY, senior_id text NOT NULL, status text NOT NULL,
  cooling_off_until timestamptz NOT NULL, created_at timestamptz NOT NULL, doc jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS holds_open_due ON money.holds (status, cooling_off_until);
`;

export class PgStore implements Store {
  private pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url }); }
  async init() { await this.pool.query(DDL); }
  async reset(seed: LedgerEntry[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE money.orders, money.holds, money.ledger');
      for (const e of seed) {
        await client.query(`INSERT INTO money.ledger (id, senior_id, at, merchant_id, category, amount_cents, label)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [e.id, e.seniorId, e.at, e.merchantId ?? null, e.category, e.amountCents, e.label ?? null]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async close() { await this.pool.end(); }

  async addLedger(entries: LedgerEntry[]) {
    for (const e of entries) {
      await this.pool.query(
        `INSERT INTO money.ledger (id, senior_id, at, merchant_id, category, amount_cents, label)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.seniorId, e.at, e.merchantId ?? null, e.category, e.amountCents, e.label ?? null]);
    }
  }
  async getLedger(seniorId: string, since: string) {
    const r = await this.pool.query(
      `SELECT * FROM money.ledger WHERE senior_id=$1 AND at >= $2 ORDER BY at`, [seniorId, since]);
    return r.rows.map((x) => ({
      id: x.id, seniorId: x.senior_id, at: new Date(x.at).toISOString(), merchantId: x.merchant_id ?? undefined,
      category: x.category, amountCents: x.amount_cents, label: x.label ?? undefined,
    }));
  }
  async countLedger(seniorId: string) {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM money.ledger WHERE senior_id=$1`, [seniorId]);
    return r.rows[0].n as number;
  }
  async saveOrder(o: Order) {
    await this.pool.query(
      `INSERT INTO money.orders (id, senior_id, created_at, doc) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`, [o.id, o.seniorId, o.createdAt, o]);
  }
  async getOrder(id: string) {
    const r = await this.pool.query(`SELECT doc FROM money.orders WHERE id=$1`, [id]);
    return r.rows[0]?.doc as Order | undefined;
  }
  async listOrders(seniorId: string) {
    const r = await this.pool.query(
      `SELECT doc FROM money.orders WHERE senior_id=$1 ORDER BY created_at DESC`, [seniorId]);
    return r.rows.map((x) => x.doc as Order);
  }
  async saveHold(h: Hold) {
    await this.pool.query(
      `INSERT INTO money.holds (id, senior_id, status, cooling_off_until, created_at, doc) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, doc = EXCLUDED.doc`,
      [h.id, h.seniorId, h.status, h.coolingOffUntil, h.createdAt, h]);
  }
  async getHold(id: string) {
    const r = await this.pool.query(`SELECT doc FROM money.holds WHERE id=$1`, [id]);
    return r.rows[0]?.doc as Hold | undefined;
  }
  async listHolds(seniorId: string) {
    const r = await this.pool.query(
      `SELECT doc FROM money.holds WHERE senior_id=$1 ORDER BY created_at DESC`, [seniorId]);
    return r.rows.map((x) => x.doc as Hold);
  }
  async listOpenHoldsDue(now: string) {
    const r = await this.pool.query(
      `SELECT doc FROM money.holds WHERE status='open' AND cooling_off_until <= $1`, [now]);
    return r.rows.map((x) => x.doc as Hold);
  }
}
