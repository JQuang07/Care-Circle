import pg from "pg";
import type { Session } from "./types.js";
export class Store {
  sessions = new Map<string, Session>();
  jobs = new Map<
    string,
    { payload: unknown; done: boolean; attempts: number }
  >();
  claims = new Map<string, string>();
  pool?: pg.Pool;
  constructor(url?: string) {
    if (url) this.pool = new pg.Pool({ connectionString: url });
  }
  async init() {
    if (!this.pool) return;
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS voice;
      CREATE TABLE IF NOT EXISTS voice.sessions (id text PRIMARY KEY, payload jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS voice.outbox (id text PRIMARY KEY, payload jsonb NOT NULL, done boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS voice.dispatches (id text PRIMARY KEY, call_id text NOT NULL);`);
    for (const row of (await this.pool.query("SELECT * FROM voice.sessions"))
      .rows)
      this.sessions.set(row.id, row.payload);
    for (const row of (
      await this.pool.query("SELECT * FROM voice.outbox WHERE NOT done")
    ).rows)
      this.jobs.set(row.id, {
        payload: row.payload,
        done: false,
        attempts: row.attempts,
      });
    for (const row of (await this.pool.query("SELECT * FROM voice.dispatches"))
      .rows)
      this.claims.set(row.id, row.call_id);
  }
  async save(s: Session) {
    this.sessions.set(s.callId, s);
    await this.pool?.query(
      "INSERT INTO voice.sessions VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET payload=$2",
      [s.callId, JSON.stringify(s)],
    );
  }
  async enqueue(id: string, payload: unknown) {
    if (this.jobs.has(id)) return;
    if (this.pool) {
      const inserted = await this.pool.query(
        "INSERT INTO voice.outbox (id,payload) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [id, JSON.stringify(payload)],
      );
      if (!inserted.rowCount) return;
    }
    this.jobs.set(id, { payload, done: false, attempts: 0 });
  }
  async mark(id: string, done: boolean) {
    const job = this.jobs.get(id)!;
    job.done = done;
    job.attempts++;
    await this.pool?.query(
      "UPDATE voice.outbox SET done=$2,attempts=attempts+1 WHERE id=$1",
      [id, done],
    );
  }
  async claim(key: string, callId: string) {
    if (this.claims.has(key)) return false;
    if (this.pool) {
      const r = await this.pool.query(
        "INSERT INTO voice.dispatches VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [key, callId],
      );
      if (!r.rowCount) return false;
    }
    this.claims.set(key, callId);
    return true;
  }
  async reset() {
    // Reset only voice-owned state; other services reset themselves via D1.
    await this.pool?.query(
      "TRUNCATE voice.sessions, voice.outbox, voice.dispatches",
    );
    this.sessions.clear();
    this.jobs.clear();
    this.claims.clear();
  }
  async close() {
    await this.pool?.end();
  }
}
