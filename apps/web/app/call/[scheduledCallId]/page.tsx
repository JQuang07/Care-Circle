"use client";
/**
 * Family video room (D5: `roomJoinUrl` = `/call/:id?member=mem_x`). Join credentials come
 * from family `GET /schedule/calls/:id/join?memberId=` (D11), which mints the LiveKit token
 * server-side. Rose joins by phone (Plan A) or tablet (Plan B) and shows up as a tile.
 * With MOCK=1 and no LiveKit configured, family hands out fake credentials; we say so
 * instead of trying to connect.
 */
import "@livekit/components-styles";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import { CallJoinSchema, ScheduledCallSchema, type CallJoin } from "@care-circle/contracts";
import { svc, explain } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

const NAMES: Record<string, string> = { mem_lisa: "Lisa", mem_danny: "Danny", mem_mark: "Mark" };
const roseTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

type Join = { state: "loading" } | { state: "error"; text: string } | { state: "ready"; join: CallJoin; fake: boolean };

export default function CallRoom({ params, searchParams }: {
  params: Promise<{ scheduledCallId: string }>;
  searchParams: Promise<{ member?: string }>;
}) {
  const { scheduledCallId } = use(params);
  const { member } = use(searchParams);

  const call = usePoll(async (signal) => {
    const r = await svc("family", "/schedule/sen_rose/upcoming", { schema: z.array(ScheduledCallSchema), signal });
    return r.ok ? r.data.find((c) => c.id === scheduledCallId) ?? null : null;
  }, 5000, [scheduledCallId]);

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-8">
      <h1 className="text-3xl font-bold">Family call</h1>
      {call && (
        <p className="mt-1 text-[16px] text-heron">
          {roseTime(call.startUtc)} Rose's time · {call.memberIds.map((m) => NAMES[m] ?? m).join(", ")} · Rose joins {call.seniorJoin === "tablet" ? "on her tablet" : "from her phone"} · {call.status}
        </p>
      )}
      {call === null && <p className="mt-1 text-[16px] text-heron">This call isn't in Rose's upcoming calls, so it may have ended.</p>}

      {member ? (
        <Room scheduledCallId={scheduledCallId} memberId={member} />
      ) : (
        <section aria-labelledby="who-h" className="glass mt-6 rounded-2xl p-6">
          <h2 id="who-h" className="text-xl font-bold">Who's joining?</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {call === undefined && <p className="text-heron">Loading the call…</p>}
            {call !== undefined && (call?.memberIds ?? Object.keys(NAMES)).map((m) => (
              <Link key={m} href={`/call/${scheduledCallId}?member=${m}`} className="rounded-lg bg-leaf px-5 py-3 text-[17px] font-bold text-white">
                I'm {NAMES[m] ?? m}
              </Link>
            ))}
          </div>
        </section>
      )}
      <Link href="/dashboard" className="mt-4 inline-block text-heron underline underline-offset-4">Back to Rose's week</Link>
    </main>
  );
}

function Room({ scheduledCallId, memberId }: { scheduledCallId: string; memberId: string }) {
  const [join, setJoin] = useState<Join>({ state: "loading" });
  const [left, setLeft] = useState(false);
  const [problem, setProblem] = useState<string>();
  const connected = useRef(false);   // a failed first connect also "disconnects"; that isn't leaving

  useEffect(() => {
    const ctrl = new AbortController();
    svc("family", `/schedule/calls/${scheduledCallId}/join?memberId=${encodeURIComponent(memberId)}`, { schema: CallJoinSchema, signal: ctrl.signal })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        if (!r.ok) return setJoin({ state: "error", text: r.code === "NOT_INVITED" ? `${NAMES[memberId] ?? memberId} isn't invited to this call.` : explain(r, "family D11 /schedule/calls/:id/join") });
        const fake = r.data.serverUrl.includes("fake") || r.data.token.startsWith("fake.");
        setJoin({ state: "ready", join: r.data, fake });
      });
    return () => ctrl.abort();
  }, [scheduledCallId, memberId]);

  const frame = "mt-6 grid aspect-video place-items-center rounded-2xl bg-ink px-6 text-center text-white";
  if (join.state === "loading") return <div className={frame}><p className="text-xl">Getting you into the room…</p></div>;
  if (join.state === "error") return <div className={frame}><p className="text-xl">{join.text}</p></div>;
  if (join.fake)
    return (
      <div className={frame}>
        <div>
          <p className="text-2xl font-bold">Simulated video room “{join.join.roomName}”</p>
          <p className="mt-2 text-white/75">LiveKit is mocked (MOCK=1 without a LiveKit server), so there's no real video. With LiveKit configured, {NAMES[memberId] ?? memberId} joins here.</p>
        </div>
      </div>
    );
  if (left)
    return (
      <div className={frame}>
        <div>
          <p className="text-2xl font-bold">You left the call.</p>
          <button type="button" onClick={() => { setLeft(false); setProblem(undefined); }} className="mt-4 rounded-lg bg-leaf px-5 py-3 text-[17px] font-bold">Rejoin</button>
        </div>
      </div>
    );

  return (
    <div className="mt-6">
      {problem && <p role="status" className="mb-3 rounded-lg border border-alarm/40 bg-white px-4 py-2 text-[15px] text-alarm">{problem}</p>}
      <LiveKitRoom
        serverUrl={join.join.serverUrl}
        token={join.join.token}
        connect
        video
        audio
        data-lk-theme="default"
        className="aspect-video overflow-hidden rounded-2xl"
        onConnected={() => { connected.current = true; setProblem(undefined); }}
        onDisconnected={() => { if (connected.current) { connected.current = false; setLeft(true); } }}
        onError={(e) => setProblem(`Couldn't connect to the video server at ${join.join.serverUrl}: ${e.message}`)}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
