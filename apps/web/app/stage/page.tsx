"use client";
/**
 * The demo screen. Left: Rose's line (recorded clips → speech-to-text → Muse → spoken reply).
 * Right: Lisa's and Danny's phones, live. Everything goes through server routes; the
 * internal secret never reaches the browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { MessageSchema, OrderSchema, type Message, type Order } from "@care-circle/contracts";
import { Phone, type PhoneOwner } from "@/components/phone/Phone";
import { loadDelivery, type DeliveryInfo } from "@/lib/delivery";
import { RESET_ORDER } from "@/lib/services";
import { explain, svc } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

const OWNERS: PhoneOwner[] = [
  { id: "mem_lisa", name: "Lisa", relation: "Daughter", tz: "America/Chicago", city: "Chicago" },
  { id: "mem_danny", name: "Danny", relation: "Grandson", tz: "America/Denver", city: "Denver" },
];
const LABELS: Record<string, string> = {
  groceries: "Groceries",
  family: "Family call",
  scam: "Scam call",
  gift: "Mia's gift",
};

interface Clip { file: string; text: string; speaker?: string }
interface Scenario { name: string; clips: Clip[] }
interface DemoEvent { type: string; summary: string; data?: any }
interface Turn { who: string; text: string; by?: string; kind: "in" | "out" }
type Action = NonNullable<Message["actions"]>[number];

const roseTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const who = (id?: string) => (id ? id.replace("mem_", "").replace(/^\w/, (ch) => ch.toUpperCase()) : "family");
const HEARD_BY: Record<string, string> = {
  muse: "heard by Muse",
  deepgram: "heard by Deepgram",
  sidecar: "from the clip's transcript",
  typed: "typed",
};
const money = (c?: number) => (typeof c === "number" ? `$${(c / 100).toFixed(2)}` : "");

/** Stage cards for the events a turn produced. */
function card(e: DemoEvent): { tone: string; title: string; body: string } | undefined {
  const d = e.data ?? {};
  switch (e.type) {
    case "order.drafted":
      return { tone: "heron", title: "Order read back", body: e.summary.replace(/^Order read back: /, "") };
    case "order.paid":
      return { tone: "leaf", title: "Order paid", body: e.summary.replace(/^Order paid: /, "") };
    case "delivery.dry_run_complete": {
      const dd = d.cart?.provider === "doordash_thirdparty" || /DoorDash/.test(e.summary);
      return {
        tone: "leaf",
        title: `Ordered from ${(d.cart?.storeName ?? "the store").replace(/\s*\(demo\)$/i, "")}`,
        body: dd
          ? `DoorDash cart ${money(d.cart?.cartTotalCents)} · stopped at DoorDash checkout (DRY RUN, no charge).`
          : `Cart ${money(d.cart?.cartTotalCents)} · mock delivery (DRY RUN, no charge).`,
      };
    }
    case "hold.placed":
      return { tone: "alarm", title: "Hold placed", body: `${d.risk ?? ""} risk${d.typology ? ` · ${String(d.typology).replace(/_/g, " ")}` : ""}. Nothing was paid.` };
    case "verification.started":
      return { tone: "honey", title: `Calling ${who(d.memberId)}`, body: "On the number stored in the circle, never one a caller gave." };
    case "hold.cancelled":
      return { tone: "leaf", title: "Hold cancelled", body: `By ${who(d.resolution?.byMemberId)} on the check-in call. No money left.` };
    case "proposal.sent":
      return { tone: "honey", title: "Proposal sent", body: `To ${(d.memberIds ?? []).map(who).join(" and ")}. Tap a time on their phones.` };
    case "call.scheduled":
      return { tone: "leaf", title: "Family call scheduled", body: `${d.startUtc ? roseTime(d.startUtc) : ""} (Rose's time). Join links sent.` };
    case "error":
      return { tone: "alarm", title: "Couldn't finish", body: e.summary };
    default:
      return undefined;
  }
}
const TONE: Record<string, string> = {
  leaf: "border-leaf bg-leaf/10",
  alarm: "border-alarm bg-alarm/10",
  honey: "border-honey bg-honey/15",
  heron: "border-heron/40 bg-white",
};

/** Any audio the browser can decode → 16 kHz mono 16-bit WAV (what Muse Voice Transcribe takes). */
async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  // Quiet laptop mics: normalise the peak (up to 20×) so speech-to-text hears the words.
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.002) {
    const gain = Math.min(20, 0.9 / peak);
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i]! * gain;
  }
  const buf = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => buf.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, "data"); buf.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([buf], { type: "audio/wav" });
}

function speak(text: string, member?: boolean): Promise<void> {
  return new Promise((done) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) return done();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /Aria|Jenny|Samantha|Google US English|Zira/i.test(v.name)) ?? null;
    u.rate = member ? 1.05 : 0.97;
    // Some engines never fire onend (headless, no voices): never block the demo on it.
    const timer = setTimeout(done, 1500 + text.length * 80);
    u.onend = () => { clearTimeout(timer); done(); };
    u.onerror = () => { clearTimeout(timer); done(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

export default function Stage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [active, setActive] = useState("groceries");
  const [sessionId, setSessionId] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [typed, setTyped] = useState("");
  const [toasts, setToasts] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  // Live microphone: who is speaking, and the recording in progress.
  const [speakAs, setSpeakAs] = useState<"senior" | "mem_danny">("senior");
  const [mic, setMic] = useState<{ rec: MediaRecorder; started: number }>();
  const [elapsed, setElapsed] = useState(0);
  // Input level (0–1) while recording, the loudest seen, and the chosen input device.
  const [level, setLevel] = useState(0);
  const loudest = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const refreshDevices = useCallback(async () => {
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      setDevices(all);
    } catch { /* no device list: the default mic is used */ }
  }, []);
  useEffect(() => {
    try { setDeviceId(localStorage.getItem("stage-mic") ?? ""); } catch { /* storage blocked */ }
    void refreshDevices();
  }, [refreshDevices]);
  useEffect(() => {
    if (!mic) return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - mic.started) / 1000);
      setElapsed(s);
      if (s >= 60) mic.rec.state === "recording" && mic.rec.stop(); // hard stop at a minute
    }, 250);
    return () => clearInterval(t);
  }, [mic]);

  useEffect(() => {
    fetch("/api/stage/clips").then((r) => r.json()).then((b) => setScenarios(b.scenarios ?? [])).catch(() => setStatus("Couldn't list demo-audio clips."));
    speechSynthesis?.getVoices();
  }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns, events]);

  const phones = usePoll<{ inboxes: Record<string, Message[]>; orders: Order[]; delivery: DeliveryInfo }>(async (signal) => {
    const [inboxes, orders, delivery] = await Promise.all([
      Promise.all(OWNERS.map((o) => svc("family", `/messages?memberId=${o.id}`, { schema: z.array(MessageSchema), signal }))),
      svc("money", "/orders?seniorId=sen_rose", { schema: z.array(OrderSchema), signal }),
      loadDelivery(signal),
    ]);
    return {
      inboxes: Object.fromEntries(OWNERS.map((o, i) => [o.id, inboxes[i]!.ok ? (inboxes[i] as { data: Message[] }).data : []])),
      orders: orders.ok ? orders.data : [],
      delivery,
    };
  }, 1500, [tick]);
  const ordersById = Object.fromEntries((phones?.orders ?? []).map((o) => [o.id, o]));

  const toast = useCallback((memberId: string, text: string) => {
    setToasts((t) => ({ ...t, [memberId]: text }));
    setTimeout(() => setToasts((t) => (t[memberId] === text ? { ...t, [memberId]: "" } : t)), 4000);
  }, []);
  const onAct = (owner: PhoneOwner) => async (msg: Message, action: Action) => {
    if (/release|approve/i.test(action.action)) return toast(owner.id, "Releasing needs a passkey: use /family.");
    const r = await svc("family", `/messages/${msg.id}/act`, { method: "POST", body: { action: action.action, payload: action.payload } });
    toast(owner.id, r.ok ? `Sent: ${action.label}` : explain(r));
    setTick((n) => n + 1);
  };
  const onReply = (owner: PhoneOwner) => async (text: string) => {
    const r = await svc("family", "/messages/reply", { method: "POST", body: { fromMemberId: owner.id, body: text } });
    if (!r.ok) toast(owner.id, explain(r));
    setTick((n) => n + 1);
  };

  const scenario = scenarios.find((s) => s.name === active);

  const newCall = () => {
    if (sessionId) void svc("voice", `/demo/converse/${sessionId}/end`, { method: "POST", body: {} });
    setSessionId(undefined); setTurns([]); setEvents([]); setDone(new Set()); setStatus(undefined);
  };
  const pick = (name: string) => { if (name !== active) { newCall(); setActive(name); } };

  const handle = async (r: any, who: string, member: boolean) => {
    setSessionId(r.sessionId);
    setTurns((t) => [
      ...t,
      { who, text: r.transcript ?? "", by: HEARD_BY[r.transcribedBy] ?? r.transcribedBy, kind: "in" },
      { who: "Care Circle", text: r.reply, by: r.reasonedBy === "mock" ? "keyword fallback" : "Muse", kind: "out" },
    ]);
    setEvents((e) => [...e, ...(r.events ?? [])]);
    setTick((n) => n + 1);
    await speak(r.reply, member);
  };

  const play = async (clip: Clip) => {
    if (busy) return;
    setBusy(clip.file); setStatus(undefined);
    try {
      const blob = await (await fetch(`/api/stage/clip/${active}/${clip.file}`)).blob();
      const audio = new Audio(URL.createObjectURL(blob));
      const played = audio.play().then(() => new Promise<void>((r) => { audio.onended = () => r(); })).catch(() => undefined);
      const wav = /\.wav$/i.test(clip.file) ? blob : await toWav(blob).catch(() => blob);
      const form = new FormData();
      form.append("file", wav, /\.wav$/i.test(clip.file) ? clip.file : clip.file.replace(/\.\w+$/, ".wav"));
      form.append("seniorId", "sen_rose");
      if (sessionId) form.append("sessionId", sessionId);
      if (clip.speaker) form.append("speaker", clip.speaker);
      form.append("scenario", active);
      form.append("clip", clip.file);
      // Transcribe while the clip plays; show the result once Rose has finished speaking.
      const pending = fetch("/api/stage/audio-turn", { method: "POST", body: form }).then(async (res) => ({ ok: res.ok, body: await res.json() }));
      await played;
      const r = await pending;
      if (!r.ok) throw new Error(r.body?.error ? `${r.body.error.code}: ${r.body.error.message}` : "voice failed");
      await handle(r.body, clip.speaker ? who(clip.speaker) : "Rose", !!clip.speaker);
      setDone((d) => new Set(d).add(clip.file));
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  /** Recorded speech → 16 kHz WAV → /api/stage/audio-turn (Muse Voice Transcribe, then Deepgram). */
  const sendRecording = async (blob: Blob, as: "senior" | "mem_danny", sid?: string) => {
    if (blob.size < 1000) return setStatus("The recording came back empty. Try again, or pick another microphone.");
    setBusy("mic");
    try {
      const wav = await toWav(blob).catch(() => blob);
      const form = new FormData();
      form.append("file", wav, wav.type === "audio/wav" ? "mic.wav" : "mic.webm");
      form.append("seniorId", "sen_rose");
      if (sid) form.append("sessionId", sid);
      if (as !== "senior") form.append("speaker", as);
      const res = await fetch("/api/stage/audio-turn", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ? `${body.error.code}: ${body.error.message}` : "voice failed");
      await handle(body, as === "senior" ? "Rose" : who(as), as !== "senior");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const startMic = async () => {
    if (busy || mic) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
      return setStatus("This browser can't record here. Open the demo at http://localhost:3000 in Chrome or Edge.");
    try {
      speechSynthesis?.cancel();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      void refreshDevices(); // device names are only visible after permission
      // Live level meter: shows at a glance whether this microphone hears anything.
      const actx = new AudioContext();
      const analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      actx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      loudest.current = 0;
      const meter = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        loudest.current = Math.max(loudest.current, peak);
        setLevel(Math.min(1, peak * 3));
      }, 80);
      const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      const as = speakAs, sid = sessionId, started = Date.now();
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        clearInterval(meter);
        void actx.close();
        stream.getTracks().forEach((t) => t.stop());
        setMic(undefined);
        setLevel(0);
        if (Date.now() - started < 700)
          return setStatus("That was very short. Press Speak, say the whole sentence, then press again to send.");
        if (loudest.current < 0.01)
          return setStatus("No sound reached this microphone. Pick another one in the list next to the button, or check it isn't muted.");
        void sendRecording(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), as, sid);
      };
      rec.start(250); // collect in slices so a stop never loses the tail
      setElapsed(0); setStatus(undefined);
      setMic({ rec, started: Date.now() });
    } catch (e) {
      setStatus(`Microphone blocked (${(e as Error).name}). Allow the microphone for localhost:3000 in the address bar, then try again.`);
    }
  };
  const stopMic = () => { if (mic?.rec.state === "recording") mic.rec.stop(); };

  const sendTyped = async () => {
    const text = typed.trim();
    if (!text || busy) return;
    setBusy("typed"); setTyped("");
    const r = await svc<any>("voice", "/demo/converse", { method: "POST", body: { sessionId, seniorId: "sen_rose", text } });
    if (r.ok) await handle({ ...r.data, transcript: text, transcribedBy: "typed" }, "Rose", false);
    else setStatus(explain(r));
    setBusy(undefined);
  };

  const reset = async () => {
    setBusy("reset"); setStatus(`Resetting ${RESET_ORDER.join(" → ")}…`);
    speechSynthesis?.cancel();
    const failed: string[] = [];
    for (const s of RESET_ORDER) {
      const r = await svc(s, "/demo/reset", { method: "POST", body: {} });
      if (!r.ok) failed.push(`${s}: ${explain(r)}`);
    }
    setSessionId(undefined); setTurns([]); setEvents([]); setDone(new Set());
    setStatus(failed.length ? `Reset failed: ${failed.join(" · ")}` : "Every service is back to the seed.");
    setTick((n) => n + 1); setBusy(undefined);
  };

  return (
    <main className="px-4 py-5">
      <div className="mx-auto grid max-w-[1500px] gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <section aria-labelledby="line-h" className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 id="line-h" className="text-2xl font-bold">Rose's line</h1>
            <div className="flex gap-2">
              <button type="button" onClick={newCall} disabled={!!busy} className="rounded-lg border-2 border-ink px-3 py-1.5 text-[15px] font-bold disabled:opacity-50">New call</button>
              <button type="button" onClick={reset} disabled={!!busy} className="rounded-lg bg-alarm px-3 py-1.5 text-[15px] font-bold text-white disabled:opacity-50">Reset demo</button>
            </div>
          </div>

          <div role="tablist" aria-label="Scenario" className="mt-3 flex flex-wrap gap-2">
            {(scenarios.length ? scenarios : Object.keys(LABELS).map((name) => ({ name, clips: [] }))).map((s) => (
              <button key={s.name} role="tab" aria-selected={s.name === active} type="button" onClick={() => pick(s.name)} disabled={!!busy}
                className={`rounded-full px-4 py-1.5 text-[15px] font-bold ${s.name === active ? "bg-ink text-white" : "bg-white text-ink"} disabled:opacity-60`}>
                {LABELS[s.name] ?? s.name}
              </button>
            ))}
          </div>

          <ol className="mt-3 grid gap-2">
            {scenario?.clips.map((c, i) => (
              <li key={c.file} className={`flex items-center gap-3 rounded-xl bg-white p-3 ${done.has(c.file) ? "opacity-60" : ""}`}>
                <button type="button" onClick={() => play(c)} disabled={!!busy} aria-label={`Play clip ${i + 1}`}
                  className={`h-11 w-11 shrink-0 rounded-full text-lg font-bold text-white disabled:opacity-50 ${c.speaker ? "bg-heron" : "bg-leaf"}`}>
                  {busy === c.file ? "…" : "▶"}
                </button>
                <p className="min-w-0 text-[15px]">
                  <span className="font-bold">{c.speaker ? "Danny (check-in call)" : "Rose"}:</span> {c.text || <em>(no transcript)</em>}
                </p>
              </li>
            ))}
            {active === "family" && <li className="rounded-xl border-2 border-dashed border-honey px-3 py-2 text-[14.5px]">After clip 1, tap the same time on Lisa's and Danny's phones, then play clip 2.</li>}
            {scenario && !scenario.clips.length && <li className="text-[15px] text-heron">No clips in demo-audio/{active}.</li>}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-white p-3">
            <button type="button" onClick={mic ? stopMic : startMic} disabled={!!busy && !mic}
              aria-pressed={!!mic} aria-label={mic ? "Stop and send" : "Speak into the microphone"}
              className={`flex h-14 items-center gap-2 rounded-full px-5 text-[17px] font-bold text-white disabled:opacity-50 ${mic ? "animate-pulse bg-alarm" : "bg-ink"}`}>
              <span aria-hidden>{mic ? "■" : "🎙"}</span>
              {mic ? `Listening… 0:${String(elapsed).padStart(2, "0")} · tap to send` : busy === "mic" ? "Transcribing…" : "Speak"}
            </button>
            <fieldset className="flex items-center gap-1 text-[15px]" disabled={!!mic || !!busy}>
              <legend className="sr-only">Who is speaking</legend>
              {([["senior", "as Rose"], ["mem_danny", "as Danny (check-in call)"]] as const).map(([v, label]) => (
                <label key={v} className={`cursor-pointer rounded-full px-3 py-1.5 ${speakAs === v ? "bg-heron text-white" : "bg-mist"}`}>
                  <input type="radio" name="speakAs" value={v} checked={speakAs === v} onChange={() => setSpeakAs(v)} className="sr-only" />
                  {label}
                </label>
              ))}
            </fieldset>
            <div className="flex w-full flex-wrap items-center gap-3 text-[14px] text-heron">
              <label className="flex min-w-0 items-center gap-2">
                <span>Mic</span>
                <select value={deviceId} disabled={!!mic}
                  onChange={(e) => { setDeviceId(e.target.value); try { localStorage.setItem("stage-mic", e.target.value); } catch { /* storage blocked */ } }}
                  className="max-w-[260px] truncate rounded-md border border-heron/40 bg-white px-2 py-1 text-ink">
                  <option value="">System default</option>
                  {devices.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                  ))}
                </select>
              </label>
              <span className="flex items-center gap-2" aria-label={mic ? `Input level ${Math.round(level * 100)} percent` : undefined}>
                <span>Level</span>
                <span className="h-2.5 w-32 overflow-hidden rounded-full bg-mist">
                  <span className={`block h-full rounded-full transition-[width] duration-75 ${level > 0.05 ? "bg-leaf" : "bg-heron/40"}`} style={{ width: `${Math.round(level * 100)}%` }} />
                </span>
                {mic && level < 0.02 && elapsed >= 2 && <span className="text-alarm">no sound yet</span>}
              </span>
            </div>
          </div>

          <div ref={log} id="rose-log" aria-live="polite" className="mt-4 max-h-[46vh] min-h-[220px] flex-1 space-y-2 overflow-y-auto rounded-xl bg-chat-wall p-3">
            {!turns.length && <p className="text-[15px] text-heron">Press ▶ to play Rose's first clip.</p>}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.kind === "out" ? "justify-end" : ""}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[15.5px] shadow-sm ${t.kind === "out" ? "bg-chat-out" : "bg-white"}`}>
                  <p className="text-[12.5px] font-bold text-heron">{t.who}{t.by ? ` · ${t.by}` : ""}</p>
                  <p>{t.text || <em>(didn't catch that)</em>}</p>
                </div>
              </div>
            ))}
          </div>

          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void sendTyped(); }}>
            <label htmlFor="typed" className="sr-only">Type as Rose</label>
            <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type what Rose says…"
              className="min-w-0 flex-1 rounded-lg border border-heron/40 bg-white px-3 py-2 text-[15px]" />
            <button type="submit" disabled={!!busy || !typed.trim()} className="rounded-lg bg-ink px-4 py-2 text-[15px] font-bold text-white disabled:opacity-50">Say</button>
          </form>
          {status && <p role="status" className="mt-2 text-[14.5px] text-heron">{status}</p>}

          <ul aria-label="What happened" className="mt-4 grid gap-2 sm:grid-cols-2">
            {events.map((e, i) => {
              const c = card(e);
              return c ? (
                <li key={i} className={`rounded-xl border-l-4 px-3 py-2 ${TONE[c.tone]}`}>
                  <p className="text-[15px] font-bold">{c.title}</p>
                  <p className="text-[14.5px]">{c.body}</p>
                </li>
              ) : null;
            })}
          </ul>
        </section>

        <section aria-label="Family phones" className="flex flex-wrap justify-center gap-5 lg:flex-nowrap">
          {OWNERS.map((o) => (
            <Phone key={o.id} owner={o} messages={phones?.inboxes[o.id]} ordersById={ordersById} delivery={phones?.delivery}
              onAct={onAct(o)} onReply={onReply(o)} toast={toasts[o.id] || undefined} />
          ))}
        </section>
      </div>
    </main>
  );
}
