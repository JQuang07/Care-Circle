import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { fixedClock } from "../src/clock.js";
import { loadConfig } from "../src/config.js";
import type { Deps } from "../src/deps.js";
import { silentLogger } from "../src/deps.js";
import { disabledMuse, type Muse } from "../src/adapters/muse.js";
import { fakeRooms } from "../src/adapters/livekit.js";
import { fakeMoney, recordingVoice } from "../src/adapters/services.js";
import { createMemoryStore } from "../src/store/memory.js";
import { seedAll } from "../src/domain/circle.js";
import type { Store } from "../src/store/types.js";

export const SECRET = "test-secret";
/** Wednesday Sep 30 2026, 11:00 ET. The next Sunday 4pm ET is Oct 4 20:00Z. */
export const NOW = "2026-09-30T15:00:00Z";

export interface TestCtx {
  app: FastifyInstance;
  deps: Deps;
  clock: ReturnType<typeof fixedClock>;
  rooms: ReturnType<typeof fakeRooms>;
  voice: ReturnType<typeof recordingVoice>;
  money: ReturnType<typeof fakeMoney>;
  h: Record<string, string>;
}

export async function makeCtx(opts: { now?: string; muse?: Muse; money?: ReturnType<typeof fakeMoney>; store?: Store; seed?: boolean } = {}): Promise<TestCtx> {
  const clock = fixedClock(opts.now ?? NOW);
  const rooms = fakeRooms();
  const voice = recordingVoice();
  const money = opts.money ?? fakeMoney();
  const deps: Deps = {
    cfg: loadConfig({ internalSecret: SECRET, mock: false, museEnabled: false, tickMs: 0, webUrl: "http://web.test", requireSecretEverywhere: false }),
    store: opts.store ?? createMemoryStore(),
    clock, rooms, voice, money,
    muse: opts.muse ?? disabledMuse(),
    log: silentLogger,
  };
  if (opts.seed !== false) await seedAll(deps);
  const app = await buildApp(deps);
  return { app, deps, clock, rooms, voice, money, h: { "x-cc-secret": SECRET } };
}

export async function json<T = any>(ctx: TestCtx, method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = ctx.h) {
  const res = await ctx.app.inject({ method, url, payload: payload as any, headers });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as T) : (undefined as T) };
}
