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
interface Turn { who: string; text: string; by?: string; kind: "in" | "out"; pending?: boolean }
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
const TONE: Record<string, { tint: string; mark: string; icon: string }> = {
  leaf: { tint: "var(--color-leaf)", mark: "bg-leaf/15 text-leaf", icon: "✓" },
  alarm: { tint: "var(--color-alarm)", mark: "bg-alarm/12 text-alarm", icon: "!" },
  honey: { tint: "var(--color-honey)", mark: "bg-honey/25 text-[#8a5a00]", icon: "…" },
  heron: { tint: "var(--color-heron)", mark: "bg-heron/12 text-heron", icon: "↺" },
};

/** One thing that happened: a frosted pane tinted by its tone, with a small mark. */
function EventCard({ tone, title, body }: { tone: string; title: string; body: string }) {
  const t = TONE[tone] ?? TONE.heron!;
  return (
    <li className="glass-tint flex gap-3 rounded-2xl px-3.5 py-3" style={{ "--tint": t.tint } as React.CSSProperties}>
      <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-[14px] font-bold ${t.mark}`}>{t.icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-bold leading-snug">{title}</span>
        <span className="block text-[14.5px] leading-snug text-ink/80">{body}</span>
      </span>
    </li>
  );
}

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

/** Care Circle's voice: Deepgram Aura-2 MP3 via voice /demo/speak, fetched once per line. */
type Voice = "care" | "rose";
const voiceClips = new Map<string, Promise<string | undefined>>();
function fetchVoice(text: string, voice: Voice = "care"): Promise<string | undefined> {
  const key = `${voice}|${text}`;
  let clip = voiceClips.get(key);
  if (!clip) {
    clip = fetch("/api/stage/speak", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice }),
      signal: AbortSignal.timeout(6000),
    })
      .then(async (r) => (r.ok && r.headers.get("content-type")?.includes("audio") ? URL.createObjectURL(await r.blob()) : undefined))
      .catch(() => undefined);
    voiceClips.set(key, clip);
    void clip.then((url) => { if (!url) voiceClips.delete(key); }); // retry a failed line next time
  }
  return clip;
}
let playing: HTMLAudioElement | undefined;

/** Spoken while a slow turn (a live DoorDash quote) runs. */
const HOLD_LINES = {
  groceries: { wait: "One moment, Rose. I'm checking Kroger's prices on DoorDash for you.", almost: "Almost done. I've found most of your items." },
  other: { wait: "One moment, Rose. Let me check on that for you.", almost: "Almost done, Rose." },
};

async function speak(text: string, member?: boolean, voice: Voice = "care"): Promise<void> {
  if (typeof window === "undefined" || !text) return;
  const url = await fetchVoice(text, voice);
  if (url) {
    const ok = await new Promise<boolean>((done) => {
      playing?.pause();
      speechSynthesis?.cancel();
      const audio = (playing = new Audio(url));
      // Never block the demo on a missing "ended" event.
      const timer = setTimeout(() => done(true), 3000 + text.length * 100);
      audio.onended = () => { clearTimeout(timer); done(true); };
      audio.onerror = () => { clearTimeout(timer); done(false); };
      audio.play().catch(() => { clearTimeout(timer); done(false); });
    });
    if (ok) return;
  }
  return browserSpeak(text, member);
}

/** Fallback when the voice service has no TTS key or doesn't answer. */
function browserSpeak(text: string, member?: boolean): Promise<void> {
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
  // Where the current turn is: speech-to-text, then the reply (Muse + tools), then speaking it.
  const [phase, setPhase] = useState<"Transcribing…" | "Thinking…" | "Speaking…">();
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
    // The holding lines are fetched up front so they play the moment they're needed.
    for (const l of Object.values(HOLD_LINES)) { void fetchVoice(l.wait); void fetchVoice(l.almost); }
    fetch("/api/stage/clips").then((r) => r.json()).then((b) => setScenarios(b.scenarios ?? [])).catch(() => setStatus("Couldn't list demo-audio clips."));
    speechSynthesis?.getVoices();
  }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns, events, phase]);

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

  // A real DoorDash cart builds after payment (a store search per item), so it lands after
  // Rose's reply. Follow each paid grocery order through delivery's own record.
  const shownDelivery = new Set(events.filter((e) => e.type.startsWith("delivery.")).map((e) => e.data?.cart?.orderId ?? e.data?.orderId));
  const deliveryCards = events
    .filter((e) => e.type === "order.paid" && ordersById[e.data?.orderId]?.fulfilment)
    .map((e) => e.data.orderId as string)
    .filter((id) => !shownDelivery.has(id))
    .map((id) => {
      const d = phones?.delivery.byOrderId[id];
      const store = (d?.storeName ?? ordersById[id]?.fulfilment?.storeName ?? "the store").replace(/\s*\(demo\)$/i, "");
      if (!d || d.status === "cart_ready") {
        const secs = d?.createdAt ? (Date.now() - Date.parse(d.createdAt)) / 1000 : 0;
        return secs > 20
          ? { key: id, tone: "honey", title: `Almost done: filling the ${store} cart…`, body: "DoorDash is adding the last items to the cart." }
          : { key: id, tone: "honey", title: `Building the ${store} cart…`, body: "DoorDash is finding each item in the store. This takes about a minute." };
      }
      if (d.status === "failed")
        return { key: id, tone: "alarm", title: "Delivery couldn't finish", body: d.failureReason ?? "See the delivery service log." };
      return {
        key: id, tone: "leaf", title: `Ordered from ${store}`,
        body: d.provider === "doordash_thirdparty"
          ? `DoorDash cart ${money(d.cartTotalCents)} · stopped at DoorDash checkout (DRY RUN, no charge).`
          : `Cart ${money(d.cartTotalCents)} · mock delivery (DRY RUN, no charge).`,
      };
    });

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

  /** A live DoorDash quote takes a minute: if the reply is slow, Care Circle says so out loud. */
  const holdOn = (pending: Promise<unknown>, member: boolean) => {
    let settled = false;
    void pending.catch(() => undefined).finally(() => { settled = true; });
    const say = (text: string) => {
      if (settled || member) return;
      setTurns((ts) => [...ts, { who: "Care Circle (AI voice)", text, by: "while it works", kind: "out" }]);
      void speak(text);
    };
    const lines = HOLD_LINES[active === "groceries" ? "groceries" : "other"];
    const timers = [setTimeout(() => say(lines.wait), 1500), setTimeout(() => say(lines.almost), 30_000)];
    return () => timers.forEach(clearTimeout);
  };

  /** Rose's words show as soon as she has said them; the real transcript replaces them later. */
  const heard = (who: string, text: string) =>
    setTurns((t) => [...t, { who, text, by: "listening…", kind: "in", pending: true }]);
  const unheard = () => setTurns((t) => t.filter((x) => !x.pending));
  /** The transcript is back: Rose's real words replace the placeholder straight away. */
  const transcribed = (text: string, by: string) =>
    setTurns((t) => t.map((x) => (x.pending ? { ...x, text, by } : x)));
  const settled = () => setTurns((t) => t.map((x) => (x.pending ? { ...x, pending: false } : x)));

  /**
   * One spoken turn in two steps: speech-to-text first (its result shows at once), then the
   * reply from voice /demo/converse, which can take a minute when it quotes DoorDash.
   */
  const transcribe = (form: FormData) => fetch("/api/stage/audio-turn?step=transcribe", { method: "POST", body: form });
  const audioTurn = async (stt: Promise<Response>, speaker: string | undefined, sid: string | undefined) => {
    const who_ = speaker ? who(speaker) : "Rose";
    const member = !!speaker;
    setPhase("Transcribing…");
    const res = await stt;
    const t = await res.json();
    if (!res.ok) throw new Error(t?.error ? `${t.error.code}: ${t.error.message}` : "speech-to-text failed");
    const by = HEARD_BY[t.transcribedBy] ?? t.transcribedBy;
    if (!t.transcript) {
      transcribed("", by); settled();
      const sorry = "I'm sorry, I didn't catch that. Could you say it again?";
      setTurns((ts) => [...ts, { who: "Care Circle (AI voice)", text: sorry, kind: "out" }]);
      setPhase("Speaking…");
      return speak(sorry, member);
    }
    transcribed(t.transcript, by);
    setPhase("Thinking…");
    const req = svc<any>("voice", "/demo/converse", { method: "POST", body: { sessionId: sid, seniorId: "sen_rose", text: t.transcript, speaker } });
    const stopHold = holdOn(req, member);
    const r = await req.finally(stopHold);
    if (!r.ok) { settled(); throw new Error(explain(r)); }
    await handle({ ...r.data, transcript: t.transcript, transcribedBy: t.transcribedBy }, who_, member);
  };

  const handle = async (r: any, who: string, member: boolean) => {
    setSessionId(r.sessionId);
    setPhase("Speaking…");
    setTurns((t) => {
      const said: Turn = { who, text: r.transcript ?? "", by: HEARD_BY[r.transcribedBy] ?? r.transcribedBy, kind: "in" };
      const reply: Turn = { who: "Care Circle (AI voice)", text: r.reply, by: r.reasonedBy === "mock" ? "keyword fallback" : "Muse", kind: "out" };
      const i = t.findIndex((x) => x.pending);
      if (i < 0) return [...t, said, reply];
      return [...t.slice(0, i), said, ...t.slice(i + 1), reply];
    });
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
      const stt = transcribe(form); // runs while the clip plays
      await played;
      heard(clip.speaker ? who(clip.speaker) : "Rose", clip.text);
      await audioTurn(stt, clip.speaker, sessionId);
      setDone((d) => new Set(d).add(clip.file));
    } catch (e) {
      unheard();
      setStatus((e as Error).message);
    } finally {
      setBusy(undefined); setPhase(undefined);
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
      heard(as === "senior" ? "Rose" : who(as), "…");
      await audioTurn(transcribe(form), as === "senior" ? undefined : as, sid);
    } catch (e) {
      unheard();
      setStatus((e as Error).message);
    } finally {
      setBusy(undefined); setPhase(undefined);
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
    setBusy("typed"); setTyped(""); setPhase("Thinking…");
    const req = svc<any>("voice", "/demo/converse", { method: "POST", body: { sessionId, seniorId: "sen_rose", text } });
    heard("Rose", text);
    await speak(text, false, "rose"); // Rose says it aloud while the turn runs
    const stopHold = holdOn(req, false);
    const r = await req.finally(stopHold);
    if (r.ok) await handle({ ...r.data, transcript: text, transcribedBy: "typed" }, "Rose", false);
    else { unheard(); setStatus(explain(r)); }
    setBusy(undefined); setPhase(undefined);
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
              <button type="button" onClick={newCall} disabled={!!busy} className="glass-btn rounded-full px-4 py-1.5 text-[15px] font-bold disabled:opacity-50">New call</button>
              <button type="button" onClick={reset} disabled={!!busy} className="glass-btn rounded-full px-4 py-1.5 text-[15px] font-bold text-alarm disabled:opacity-50">Reset demo</button>
            </div>
          </div>

          <div role="tablist" aria-label="Scenario" className="glass-soft mt-3 inline-flex w-fit flex-wrap gap-1 rounded-full p-1">
            {(scenarios.length ? scenarios : Object.keys(LABELS).map((name) => ({ name, clips: [] }))).map((s) => (
              <button key={s.name} role="tab" aria-selected={s.name === active} type="button" onClick={() => pick(s.name)} disabled={!!busy}
                className={`rounded-full px-4 py-1.5 text-[15px] font-bold transition-colors ${s.name === active ? "glass-ink" : "text-ink/75 hover:bg-white/50 hover:text-ink"} disabled:opacity-60`}>
                {LABELS[s.name] ?? s.name}
              </button>
            ))}
          </div>

          <ol className="mt-3 grid gap-2">
            {scenario?.clips.map((c, i) => (
              <li key={c.file} className={`glass flex items-center gap-3 rounded-2xl p-3 ${done.has(c.file) ? "opacity-60" : ""}`}>
                <button type="button" onClick={() => play(c)} disabled={!!busy} aria-label={`Play clip ${i + 1}`}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_12px_-4px_rgb(30_43_51/0.4)] disabled:opacity-50 ${c.speaker ? "bg-heron" : "bg-leaf"}`}>
                  {busy === c.file ? "…" : "▶"}
                </button>
                <p className="min-w-0 text-[15px]">
                  <span className="font-bold">{c.speaker ? "Danny (check-in call)" : "Rose"}:</span> {c.text || <em>(no transcript)</em>}
                </p>
              </li>
            ))}
            {active === "family" && <li className="glass-tint rounded-2xl px-3.5 py-2.5 text-[14.5px]" style={{ "--tint": "var(--color-honey)" } as React.CSSProperties}>After clip 1, tap the same time on Lisa's and Danny's phones, then play clip 2.</li>}
            {scenario && !scenario.clips.length && <li className="text-[15px] text-heron">No clips in demo-audio/{active}.</li>}
          </ol>

          <div className="glass mt-3 flex flex-wrap items-center gap-3 rounded-2xl p-3">
            <button type="button" onClick={mic ? stopMic : startMic} disabled={!!busy && !mic}
              aria-pressed={!!mic} aria-label={mic ? "Stop and send" : "Speak into the microphone"}
              className={`flex h-14 items-center gap-2 rounded-full px-5 text-[17px] font-bold text-white disabled:opacity-50 ${mic ? "animate-pulse bg-alarm shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]" : "glass-ink"}`}>
              <span aria-hidden>{mic ? "■" : "🎙"}</span>
              {mic ? `Listening… 0:${String(elapsed).padStart(2, "0")} · tap to send` : busy === "mic" ? phase ?? "Working…" : "Speak"}
            </button>
            <fieldset className="flex items-center gap-1 text-[15px]" disabled={!!mic || !!busy}>
              <legend className="sr-only">Who is speaking</legend>
              {([["senior", "as Rose"], ["mem_danny", "as Danny (check-in call)"]] as const).map(([v, label]) => (
                <label key={v} className={`cursor-pointer rounded-full px-3 py-1.5 transition-colors ${speakAs === v ? "bg-heron text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]" : "glass-soft"}`}>
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
                  className="glass-soft max-w-[260px] truncate rounded-lg px-2 py-1 text-ink">
                  <option value="">System default</option>
                  {devices.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                  ))}
                </select>
              </label>
              <span className="flex items-center gap-2" aria-label={mic ? `Input level ${Math.round(level * 100)} percent` : undefined}>
                <span>Level</span>
                <span className="h-2.5 w-32 overflow-hidden rounded-full bg-ink/8 shadow-[inset_0_1px_2px_rgb(30_43_51/0.12)]">
                  <span className={`block h-full rounded-full transition-[width] duration-75 ${level > 0.05 ? "bg-leaf" : "bg-heron/40"}`} style={{ width: `${Math.round(level * 100)}%` }} />
                </span>
                {mic && level < 0.02 && elapsed >= 2 && <span className="text-alarm">no sound yet</span>}
              </span>
            </div>
          </div>

          <div ref={log} id="rose-log" aria-live="polite" className="glass-soft mt-4 max-h-[46vh] min-h-[220px] flex-1 space-y-2 overflow-y-auto rounded-2xl p-3">
            {!turns.length && <p className="text-[15px] text-heron">Press ▶ to play Rose's first clip.</p>}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.kind === "out" ? "justify-end" : ""}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15.5px] ${t.kind === "out" ? "glass-tint rounded-br-md" : "glass rounded-bl-md"}`}
                  style={t.kind === "out" ? ({ "--tint": "var(--color-leaf)" } as React.CSSProperties) : undefined}>
                  <p className="text-[12.5px] font-bold text-heron">{t.who}{t.by ? ` · ${t.by}` : ""}</p>
                  <p>{t.text || <em>(didn't catch that)</em>}</p>
                </div>
              </div>
            ))}
            {phase && (
              <p className={`flex ${phase === "Transcribing…" ? "" : "justify-end"}`}>
                <span className="glass-soft animate-pulse rounded-full px-3 py-1 text-[13.5px] text-heron">
                  {phase === "Transcribing…" ? "Transcribing…" : phase === "Thinking…" ? "Care Circle is thinking…" : "Care Circle is speaking…"}
                </span>
              </p>
            )}
          </div>

          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void sendTyped(); }}>
            <label htmlFor="typed" className="sr-only">Type as Rose</label>
            <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type what Rose says…"
              className="glass min-w-0 flex-1 rounded-full px-4 py-2 text-[15px] outline-none placeholder:text-heron/80" />
            <button type="submit" disabled={!!busy || !typed.trim()} className="glass-ink rounded-full px-5 py-2 text-[15px] font-bold disabled:opacity-50">Say</button>
          </form>
          {status && <p role="status" className="mt-2 text-[14.5px] text-heron">{status}</p>}

          <ul aria-label="What happened" className="mt-4 grid gap-2 sm:grid-cols-2">
            {events.map((e, i) => {
              const c = card(e);
              return c ? <EventCard key={i} {...c} /> : null;
            })}
            {deliveryCards.map((c) => <EventCard key={c.key} tone={c.tone} title={c.title} body={c.body} />)}
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
