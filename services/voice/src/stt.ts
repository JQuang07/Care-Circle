import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "./config.js";

export type TranscribedBy = "muse" | "deepgram" | "sidecar" | "none";
export type Transcript = { transcript: string; transcribedBy: TranscribedBy; cached?: boolean };
export type Audio = { buffer: Buffer; filename?: string; mimetype?: string };

const cache = new Map<string, Transcript>();
const isWav = (b: Buffer) =>
  b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";
/** Sidecar lines may start with a speaker marker ("mem_danny: ..."); it is not speech. */
const clean = (t: string) => t.trim().replace(/^mem_\w+:\s*/, "");

/** Muse Voice Transcribe (file-based). Accepts 16/24 kHz mono 16-bit PCM WAV only. */
async function muse(c: Config, a: Audio) {
  if (!c.metaKey || !isWav(a.buffer)) return undefined;
  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify({ mode: "PUSH_TO_TALK", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" })], {
      type: "application/json",
    }),
  );
  form.append("audio", new Blob([new Uint8Array(a.buffer)], { type: "audio/wav" }), a.filename || "clip.wav");
  const res = await fetch("https://api.meta.ai/v1/asr/transcribe?sessionId=care-circle-demo", {
    method: "POST",
    headers: { Authorization: `Bearer ${c.metaKey}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Muse transcribe ${res.status}`);
  return ((await res.json()) as { transcript?: string }).transcript?.trim() || undefined;
}

/** Deepgram prerecorded: takes mp3/m4a/wav/webm as-is. */
async function deepgram(c: Config, a: Audio) {
  if (!c.deepgramKey) return undefined;
  const res = await fetch(`https://api.deepgram.com/v1/listen?model=${c.sttModel}&smart_format=true`, {
    method: "POST",
    headers: { Authorization: `Token ${c.deepgramKey}`, "Content-Type": a.mimetype || "application/octet-stream" },
    body: new Uint8Array(a.buffer),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}`);
  const body = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return body.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || undefined;
}

/** Finds the same clip under demo-audio/ by content hash and reads its .txt. */
function sidecarFor(hash: string, dir = process.env.DEMO_AUDIO_DIR || resolve(process.cwd(), "../../demo-audio")) {
  if (!existsSync(dir)) return undefined;
  for (const scenario of readdirSync(dir, { withFileTypes: true })) {
    if (!scenario.isDirectory()) continue;
    for (const f of readdirSync(join(dir, scenario.name))) {
      if (!/\.(mp3|m4a|wav|webm|ogg)$/i.test(f)) continue;
      const path = join(dir, scenario.name, f);
      if (createHash("sha256").update(readFileSync(path)).digest("hex") !== hash) continue;
      const txt = path.replace(/\.[^.]+$/, ".txt");
      return existsSync(txt) ? clean(readFileSync(txt, "utf8")) : undefined;
    }
  }
  return undefined;
}

/** Never throws: Muse → Deepgram → sidecar .txt. Cached per file hash. */
export async function transcribe(c: Config, a: Audio, sidecar?: string): Promise<Transcript> {
  const hash = createHash("sha256").update(a.buffer).digest("hex");
  const hit = cache.get(hash);
  if (hit) return { ...hit, cached: true };
  for (const [name, fn] of [
    ["muse", muse],
    ["deepgram", deepgram],
  ] as const) {
    try {
      const transcript = await fn(c, a);
      if (transcript) {
        const t = { transcript, transcribedBy: name };
        cache.set(hash, t);
        return t;
      }
    } catch (e) {
      console.warn(`[voice] ${name} STT failed:`, (e as Error).message);
    }
  }
  const text = sidecar ? clean(sidecar) : sidecarFor(hash);
  // Sidecar results are not cached, so a later provider success still wins.
  return text ? { transcript: text, transcribedBy: "sidecar" } : { transcript: "", transcribedBy: "none" };
}
