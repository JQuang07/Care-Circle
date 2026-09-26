// `pnpm --filter @care-circle/money seed` (called by the root `pnpm seed`).
// Money also seeds itself on boot; this makes the root orchestrator work too.
import { seedIfEmpty } from '../deps';
import { PgStore } from '../store/pg';
import { MemoryStore, type Store } from '../store/store';

const url = process.env.DATABASE_URL;
const store: Store = process.env.MOCK !== '1' && url ? new PgStore(url) : new MemoryStore();
await store.init();
await seedIfEmpty(store, new Date());
console.log(`[money] seed ok (${store.constructor.name})`);
await (store as { close?: () => Promise<void> }).close?.();
