// Regenerates Rose's demo clips from their .txt with Deepgram Aura-2 "athena" (the only
// mature American female voice), aged a little: played ~7% slower, which also lowers the
// pitch. Danny's lines ("mem_danny: …") are left alone. Rose is a fictional demo persona.
//   node demo-audio/make-rose-voice.mjs            (reads DEEPGRAM_API_KEY from the repo .env)
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, "..", ".env");
const env = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  : {};
const key = process.env.DEEPGRAM_API_KEY || env.DEEPGRAM_API_KEY;
if (!key) throw new Error("DEEPGRAM_API_KEY missing");

const MODEL = process.env.ROSE_TTS_MODEL || "aura-2-athena-en";
const AGE = Number(process.env.ROSE_AGE_FACTOR || 0.93); // <1 = slower and lower
const SRC_RATE = 24000, OUT_RATE = 16000;

async function tts(text) {
  const q = new URLSearchParams({ model: MODEL, encoding: "linear16", sample_rate: String(SRC_RATE), container: "none" });
  const r = await fetch(`https://api.deepgram.com/v1/speak?${q}`, {
    method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`Deepgram ${r.status}: ${await r.text()}`);
  const b = Buffer.from(await r.arrayBuffer());
  return new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
}

/** Play the 24 kHz samples as if recorded at 24 kHz × AGE, resampled to 16 kHz (linear). */
function age(src) {
  const step = (SRC_RATE * AGE) / OUT_RATE;
  const pad = Math.round(OUT_RATE * 0.3);
  const n = Math.floor((src.length - 1) / step);
  const out = new Int16Array(n + pad * 2);
  for (let i = 0; i < n; i++) {
    const x = i * step, j = Math.floor(x), f = x - j;
    out[pad + i] = Math.round(src[j] * (1 - f) + src[j + 1] * f);
  }
  return out;
}

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(OUT_RATE, 24); h.writeUInt32LE(OUT_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

for (const scenario of readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  for (const t of readdirSync(join(here, scenario)).filter((f) => /^\d+\.txt$/.test(f))) {
    const text = readFileSync(join(here, scenario, t), "utf8").trim();
    if (!text || /^mem_\w+:/.test(text)) continue; // family members' lines stay as recorded
    const out = join(here, scenario, t.replace(/\.txt$/, ".wav"));
    writeFileSync(out, wav(age(await tts(text))));
    console.log(`Rose → ${scenario}/${t.replace(/\.txt$/, ".wav")}: "${text.slice(0, 60)}"`);
  }
}
