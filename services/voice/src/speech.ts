import WebSocket from "ws";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "./config.js";

/**
 * The TTS key, from the environment or, if `pnpm dev` started before the key was added,
 * from the repo-root .env (read once it's needed, so no restart is required).
 */
export function ttsKey(c: Config): string | undefined {
  if (c.ttsKey) return c.ttsKey;
  for (let dir = process.cwd(), i = 0; i < 4; i++, dir = dirname(dir)) {
    const file = join(dir, ".env");
    if (!existsSync(file)) continue;
    const vars = Object.fromEntries(
      readFileSync(file, "utf8").split(/\r?\n/)
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => [m[1], m[2]!.replace(/^(['"])(.*)\1$/, "$2")]),
    );
    const key = vars.TTS_API_KEY || vars.DEEPGRAM_API_KEY;
    if (key) return (c.ttsKey = key);
  }
  return undefined;
}

const mp3Cache = new Map<string, Buffer>();
/** Care Circle's voice for the browser (stage): Deepgram Aura-2 as MP3. Repeated lines come from memory. */
export async function speakMp3(c: Config, text: string): Promise<Buffer> {
  const key = ttsKey(c);
  if (!key) throw new Error("No TTS key (DEEPGRAM_API_KEY)");
  const cacheKey = `${c.ttsModel}|${text}`;
  const hit = mp3Cache.get(cacheKey);
  if (hit) return hit;
  const query = new URLSearchParams({ model: c.ttsModel, encoding: "mp3" });
  const response = await fetch(`https://api.deepgram.com/v1/speak?${query}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Deepgram TTS ${response.status}`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (mp3Cache.size >= 100) mp3Cache.delete(mp3Cache.keys().next().value!);
  mp3Cache.set(cacheKey, audio);
  return audio;
}

export function listen(
  c: Config,
  onText: (text: string) => void,
  onSpeech: () => void,
  onError: () => void,
) {
  const query = new URLSearchParams({
    model: c.sttModel,
    encoding: "mulaw",
    sample_rate: "8000",
    channels: "1",
    interim_results: "true",
    endpointing: "300",
    vad_events: "true",
    punctuate: "true",
  });
  const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${query}`, {
    headers: { Authorization: `Token ${c.deepgramKey}` },
  });
  let pending: Buffer[] = [];
  let finals: string[] = [];
  socket.on("open", () => {
    for (const chunk of pending) socket.send(chunk);
    pending = [];
  });
  socket.on("message", (raw) => {
    try {
      const event = JSON.parse(raw.toString());
      if (event.type === "SpeechStarted") onSpeech();
      if (event.type === "Results") {
        const text = event.channel?.alternatives?.[0]?.transcript;
        if (text && event.is_final) finals.push(text);
        if (event.speech_final && finals.length) {
          onText(finals.join(" "));
          finals = [];
        }
      }
    } catch {
      onError();
    }
  });
  socket.on("error", onError);
  const keepalive = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: "KeepAlive" }));
  }, 5000);
  return {
    send(chunk: Buffer) {
      if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
      else if (
        socket.readyState === WebSocket.CONNECTING &&
        pending.length < 250
      )
        pending.push(chunk);
    },
    close() {
      clearInterval(keepalive);
      socket.close();
    },
  };
}
export async function* synthesize(
  c: Config,
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const query = new URLSearchParams({
    model: c.ttsModel,
    encoding: "mulaw",
    sample_rate: "8000",
    container: "none",
  });
  const response = await fetch(`https://api.deepgram.com/v1/speak?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${ttsKey(c)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body)
    throw new Error("Speech synthesis unavailable");
  for await (const chunk of response.body) yield Buffer.from(chunk);
}
