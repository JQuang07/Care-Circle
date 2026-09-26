import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { loadConfig } from "../src/config.js";
import { createPgStore } from "../src/store/postgres.js";
import type { Store } from "../src/store/types.js";

// Uses the real `family` schema (never any other). Skips when Postgres isn't reachable with DATABASE_URL.
const url = process.env.FAMILY_TEST_DATABASE_URL ?? loadConfig().databaseUrl;

async function reachable(): Promise<boolean> {
  if (!url) return false;
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

const ok = await reachable();
let store: Store | undefined;
afterAll(async () => { await store?.close(); });

describe.skipIf(!ok)("postgres store (family schema)", () => {
  it("migrates idempotently and round-trips documents with jsonb filters", async () => {
    await (await createPgStore(url!)).close(); // migrate once…
    const s = await createPgStore(url!);       // …and again: must be idempotent
    store = s;
    const id = `msg_test_${Date.now()}`;
    await s.messages.put({ id, toMemberId: "mem_test", direction: "out", kind: "text", body: "hi", createdAt: new Date().toISOString() });
    expect((await s.messages.get(id))?.body).toBe("hi");
    await s.messages.put({ id, toMemberId: "mem_test", direction: "out", kind: "text", body: "updated", createdAt: new Date().toISOString() });
    const listed = await s.messages.list({ toMemberId: "mem_test" });
    expect(listed.map((m) => m.body)).toEqual(["updated"]);
    await s.messages.delete(id);
    expect(await s.messages.get(id)).toBeUndefined();
  });
});
