import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createDeps, startScheduler } from "./bootstrap.js";
import { ensureSeeded } from "./domain/circle.js";

const cfg = loadConfig();
// Borrow Fastify's pino logger for domain logs too.
const bootLog = { info: console.log, warn: console.warn, error: console.error };
const deps = await createDeps(cfg, bootLog);
const app = await buildApp(deps, { logger: true });
deps.log = app.log;

if (await ensureSeeded(deps)) app.log.info("seeded circle + 8 weeks of call history");
const stop = startScheduler(deps);

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info({ store: deps.store.kind, muse: deps.muse.enabled, mock: cfg.mock, livekit: deps.rooms.serverUrl }, "family service ready");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stop();
    await app.close();
    await deps.store.close();
    process.exit(0);
  });
}
