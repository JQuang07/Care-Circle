import WebSocket from "ws";
import type { Config } from "./config.js";
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
      Authorization: `Token ${c.ttsKey}`,
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
