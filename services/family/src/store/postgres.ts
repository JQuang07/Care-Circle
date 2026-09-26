import pg from "pg";
import { COLLECTIONS, type Collection, type CollectionName, type Store } from "./types.js";

const SCHEMA = "family";

const TABLES: Record<CollectionName, string> = {
  circle: "circle",
  calls: "call_history",
  messages: "messages",
  hooks: "hooks",
  proposals: "proposals",
  scheduledCalls: "scheduled_calls",
  voiceNotes: "order_voice_notes",
  moments: "moment_events",
  availability: "availability",
  seniorHints: "senior_hints",
  holds: "holds_seen",
  processed: "processed_events",
};

/** Idempotent. Only ever touches the `family` schema. */
export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  for (const table of Object.values(TABLES)) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.${table} (
        seq bigserial,
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_data_gin ON ${SCHEMA}.${table} USING gin (data jsonb_path_ops)`);
  }
}

function pgCollection<T extends { id: string }>(pool: pg.Pool, table: string): Collection<T> {
  const t = `${SCHEMA}.${table}`;
  return {
    async get(id) {
      const r = await pool.query(`SELECT data FROM ${t} WHERE id = $1`, [id]);
      return r.rows[0]?.data;
    },
    async put(doc) {
      await pool.query(
        `INSERT INTO ${t} (id, data) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [doc.id, JSON.stringify(doc)],
      );
      return doc;
    },
    async list(filter) {
      const hasFilter = filter && Object.keys(filter).length > 0;
      const r = hasFilter
        ? await pool.query(`SELECT data FROM ${t} WHERE data @> $1::jsonb ORDER BY seq`, [JSON.stringify(filter)])
        : await pool.query(`SELECT data FROM ${t} ORDER BY seq`);
      return r.rows.map((row) => row.data);
    },
    async delete(id) { await pool.query(`DELETE FROM ${t} WHERE id = $1`, [id]); },
    async clear() { await pool.query(`TRUNCATE ${t}`); },
  };
}

export async function createPgStore(databaseUrl: string): Promise<Store> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  await migrate(pool);
  const store: any = { kind: "postgres", close: () => pool.end() };
  for (const name of COLLECTIONS) store[name] = pgCollection(pool, TABLES[name]);
  return store as Store;
}
