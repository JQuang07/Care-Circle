// Runs the post-call pipeline once against real Muse with a sample transcript (in-memory store).
// Usage: npx tsx dev/try-hooks.ts
import { loadConfig } from "../src/config.js";
import { systemClock } from "../src/clock.js";
import { createMuse } from "../src/adapters/muse.js";
import { fakeRooms } from "../src/adapters/livekit.js";
import { fakeMoney, recordingVoice } from "../src/adapters/services.js";
import { createMemoryStore } from "../src/store/memory.js";
import { seedAll } from "../src/domain/circle.js";
import { runPostCallPipeline } from "../src/domain/hooks.js";

const cfg = loadConfig();
const log = { info: console.log, warn: console.warn, error: console.error };
const deps = { cfg, log, store: createMemoryStore(), clock: systemClock(), muse: createMuse(cfg, log), rooms: fakeRooms(), voice: recordingVoice(), money: fakeMoney() };
await seedAll(deps);
const t = (s: number) => new Date(Date.now() - 600_000 + s * 1000).toISOString();
const started = Date.now();
const res = await runPostCallPipeline(deps, {
  callId: "call_try", seniorId: "sen_rose", kind: "inbound", startedAt: t(0), endedAt: t(300),
  transcript: [
    { speaker: "agent", text: "Hi Rose! How's your week going?", ts: t(1) },
    { speaker: "senior", text: "Oh wonderful. My tomatoes came in, the ones we planted in May!", ts: t(10) },
    { speaker: "senior", text: "I'm worried about Buddy's vet visit on Friday.", ts: t(20) },
    { speaker: "senior", text: "Keep this between us, okay?", ts: t(30) },
    { speaker: "senior", text: "I pawned grandpa's sapphire ring at Goldman's to cover the roof.", ts: t(35) },
    { speaker: "senior", text: "The new blood pressure pills make me dizzy.", ts: t(50) },
    { speaker: "senior", text: "Lisa never listens to me anyway.", ts: t(60) },
    { speaker: "senior", text: "Anyway, I baked a peach pie for the church sale, and I saw a blue heron at the pond!", ts: t(70) },
  ],
  privateSpans: [{ startTs: t(29), endTs: t(41) }],
});
console.log(`muse=${deps.muse.enabled} ${Date.now() - started}ms`, JSON.stringify(res, null, 2));
