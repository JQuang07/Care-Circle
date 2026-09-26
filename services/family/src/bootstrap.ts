import { DateTime } from "luxon";
import type { Config } from "./config.js";
import { systemClock } from "./clock.js";
import type { Deps, Logger } from "./deps.js";
import { createMuse } from "./adapters/muse.js";
import { createLiveKitRooms, fakeRooms, type Rooms } from "./adapters/livekit.js";
import { httpMoneyClient, httpVoiceClient } from "./adapters/services.js";
import { createMemoryStore } from "./store/memory.js";
import { createPgStore } from "./store/postgres.js";
import type { Store } from "./store/types.js";
import { runRhythmJob, tick } from "./domain/jobs.js";
import { SENIOR_ROSE } from "./seed-data.js";

export async function createStore(cfg: Config, log: Logger): Promise<Store> {
  if (cfg.databaseUrl) {
    try {
      return await createPgStore(cfg.databaseUrl);
    } catch (err) {
      if (!cfg.mock) throw err;
      log.warn({ err: String(err) }, "Postgres unavailable; MOCK=1 so using the in-memory store");
    }
  }
  return createMemoryStore();
}

export function createRooms(cfg: Config, log: Logger): Rooms {
  try {
    return createLiveKitRooms(cfg);
  } catch (err) {
    if (!cfg.mock) throw err;
    log.warn({ err: String(err) }, "LiveKit not configured; MOCK=1 so using fake rooms");
    return fakeRooms();
  }
}

export async function createDeps(cfg: Config, log: Logger): Promise<Deps> {
  return {
    cfg, log,
    store: await createStore(cfg, log),
    clock: systemClock(),
    muse: createMuse(cfg, log),
    rooms: createRooms(cfg, log),
    voice: httpVoiceClient(cfg),
    money: httpMoneyClient(cfg),
  };
}

/** Background scheduler: tick every cfg.tickMs; the rhythm job once a day at 9am Rose's time. */
export function startScheduler(deps: Deps): () => void {
  if (!deps.cfg.tickMs) return () => {};
  let lastRhythmDay = "";
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick(deps);
      const local = DateTime.fromJSDate(deps.clock.now()).setZone(SENIOR_ROSE.tz);
      if (local.hour >= 9 && local.toISODate() !== lastRhythmDay) {
        lastRhythmDay = local.toISODate()!;
        const created = await runRhythmJob(deps, SENIOR_ROSE.id);
        if (created.length) deps.log.info({ created }, "rhythm job suggested calls");
      }
    } catch (err) {
      deps.log.error({ err: String(err) }, "scheduler tick failed");
    } finally {
      running = false;
    }
  }, deps.cfg.tickMs);
  return () => clearInterval(timer);
}
