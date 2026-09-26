import type WebSocket from "ws";
import type { Config } from "./config.js";
import type { Engine } from "./engine.js";
import type { Session } from "./types.js";
import { listen, synthesize } from "./speech.js";
export function media(
  socket: WebSocket,
  c: Config,
  engine: Engine,
  adapters = { listen, synthesize },
) {
  let s: Session | undefined,
    streamSid: string | undefined,
    stt: ReturnType<typeof listen> | undefined;
  let closed = false,
    generation = 0,
    queue = Promise.resolve(),
    abort: AbortController | undefined,
    activeMark: string | undefined,
    speechEnd = 0,
    playing = false;
  const send = (data: unknown) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(data));
  };
  const interrupt = () => {
    generation++;
    abort?.abort();
    activeMark = undefined;
    if (playing && s) s.pendingDelivered = false;
    playing = false;
    send({ event: "clear", streamSid });
  };
  const speak = async (text: string, version: number) => {
    if (closed || version !== generation) return;
    abort = new AbortController();
    playing = true;
    let first = true;
    try {
      for await (const chunk of adapters.synthesize(c, text, abort.signal)) {
        if (version !== generation || closed) return;
        if (first && speechEnd && s) {
          s.latencies.push(performance.now() - speechEnd);
          await engine.store.save(s);
        }
        first = false;
        for (let i = 0; i < chunk.length; i += 1600)
          send({
            event: "media",
            streamSid,
            media: { payload: chunk.subarray(i, i + 1600).toString("base64") },
          });
      }
      if (version !== generation || closed) return;
      activeMark = `turn-${version}`;
      send({ event: "mark", streamSid, mark: { name: activeMark } });
    } catch {
      if (!abort.signal.aborted) socket.close(1011, "Speech unavailable");
    }
  };
  const turn = (text: string) => {
    speechEnd = performance.now();
    const version = generation;
    queue = queue.then(async () => {
      if (closed || version !== generation || !s) return;
      try {
        const reply = await engine.turn(s, text);
        await speak(reply, version);
      } catch {
        await speak(
          "I couldn’t complete that safely. Please try again or ask your family for help.",
          version,
        );
      }
    });
  };
  const idle = setInterval(() => {
    if (
      s &&
      !closed &&
      Date.now() - Date.parse(s.transcript.at(-1)?.ts || s.startedAt) > 45000
    ) {
      const version = generation;
      queue = queue.then(() =>
        speak("Take your time. I’m here when you’re ready.", version),
      );
    }
  }, 45000);
  const timeout = setTimeout(
    () => socket.close(1000, "Call time limit"),
    15 * 60 * 1000,
  );
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(idle);
    clearTimeout(timeout);
    abort?.abort();
    stt?.close();
  };
  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === "start") {
        if (s) throw new Error("Duplicate stream start");
        const candidate = engine.store.sessions.get(
          msg.start?.customParameters?.callId,
        );
        if (
          !candidate ||
          candidate.endedAt ||
          candidate.streamToken !== msg.start?.customParameters?.token ||
          candidate.twilioSid !== msg.start?.callSid
        )
          throw new Error("Unbound stream");
        s = candidate;
        delete s.streamToken;
        streamSid = msg.start.streamSid;
        stt = adapters.listen(c, turn, interrupt, () =>
          socket.close(1011, "Transcription unavailable"),
        );
        const version = generation;
        queue = queue.then(async () => {
          try {
            await engine.store.save(s!);
            await speak(await engine.begin(s!), version);
          } catch {
            socket.close(1011, "Family service unavailable");
          }
        });
      } else if (msg.event === "media" && stt)
        stt.send(Buffer.from(msg.media.payload, "base64"));
      else if (msg.event === "mark" && s && activeMark === msg.mark?.name) {
        activeMark = undefined;
        playing = false;
        void engine.delivered(s).catch(() => socket.close(1011));
      } else if (msg.event === "stop") cleanup();
    } catch {
      socket.close(1008, "Invalid stream");
    }
  });
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  // call.ended is emitted by Twilio's terminal status, not stream.stop: a conference transfer stops a stream mid-call.
}
