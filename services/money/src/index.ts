import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { buildService, makeLlm, seedIfEmpty } from './deps';
import { RecordingEvents, httpEvents } from './events';
import { httpFamilyClient, seedFamilyClient } from './family';
import { choosePayments } from './payments';
import { PgStore } from './store/pg';
import { MemoryStore, type Store } from './store/store';

const env = process.env;
const mock = env.MOCK === '1';
const now = () => new Date();
const warn = (m: string) => console.warn(`[money] ${m}`);

const store: Store = !mock && env.DATABASE_URL ? new PgStore(env.DATABASE_URL) : new MemoryStore();
await store.init();
await seedIfEmpty(store, now());

const family = mock || !env.FAMILY_URL
  ? seedFamilyClient(now)
  : httpFamilyClient(env.FAMILY_URL, env.CC_INTERNAL_SECRET ?? '', now, warn);
const events = mock || !env.FAMILY_URL
  ? new RecordingEvents((m) => console.log(`[money] ${m}`))
  : httpEvents(env.FAMILY_URL, env.CC_INTERNAL_SECRET ?? '', warn);
const payments = choosePayments(env, warn);
const llm = mock ? null : makeLlm(env);
if (!mock && !llm) warn('No META_API_KEY: Layer 2 and messages use the offline heuristic/templates');

const service = buildService({ store, family, payments, events, llm, now, mock, log: warn });
const app = buildApp({
  service, mock, secret: env.CC_INTERNAL_SECRET, logger: true,
  evalResultsPath: fileURLToPath(new URL('../eval/results/latest.json', import.meta.url)),
});

// Cooling-off sweeper: expired holds get cancelled, never released.
setInterval(() => { service.expireDueHolds().catch((e) => warn(`sweeper: ${e.message}`)); }, 60_000).unref();

await app.listen({ port: Number(env.PORT ?? 4002), host: '0.0.0.0' });
console.log(`[money] up on :${env.PORT ?? 4002} mock=${mock} payments=${payments.name} store=${store.constructor.name}`);
