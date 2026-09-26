"use client";
/**
 * The recording control panel. Every button works without a real phone: scenarios go
 * through voice /demo/simulate-inbound with the SAME scripts the E2E suite runs.
 */
import { useState } from "react";
import { z } from "zod";
import { HoldSchema, OrderSchema, ScheduledCallSchema } from "@care-circle/contracts";
import { DEMO_BUTTONS, DANNY_CANCELS, type DemoScript } from "@care-circle/e2e/scripts";
import { svc, explain } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

type Status = { tone: "ok" | "err" | "busy"; text: string };

function useStatus() {
  const [s, set] = useState<Record<string, Status>>({});
  return [s, (k: string, v: Status) => set((p) => ({ ...p, [k]: v }))] as const;
}

const roseTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function Line({ s }: { s?: Status }) {
  if (!s) return null;
  const color = s.tone === "err" ? "text-alarm" : s.tone === "ok" ? "text-leaf" : "text-heron";
  return <p role="status" className={`mt-1 text-[14px] ${color}`}>{s.text}</p>;
}

export default function Demo() {
  const [status, setStatus] = useStatus();
  const [evalResult, setEvalResult] = useState<unknown>();

  const health = usePoll(async (signal) => {
    const svcs = ["voice", "money", "family"] as const;
    const r = await Promise.all(svcs.map((s) => svc<{ ok: boolean; mock: boolean }>(s, "/health", { signal })));
    return svcs.map((s, i) => ({ s, ok: r[i]!.ok, mock: r[i]!.ok ? (r[i] as { data: { mock: boolean } }).data.mock : undefined }));
  }, 5000);

  const next = usePoll(async (signal) => {
    const r = await svc("family", "/schedule/sen_rose/upcoming", { schema: z.array(ScheduledCallSchema), signal });
    return r.ok ? [...r.data].filter((c) => c.status === "scheduled").sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0] : undefined;
  }, 3000);

  const run = async (d: DemoScript) => {
    setStatus(d.id, { tone: "busy", text: "Rose is calling…" });
    const r = await svc<{ callId: string }>("voice", "/demo/simulate-inbound", { method: "POST", body: { seniorId: "sen_rose", script: d.script } });
    setStatus(d.id, r.ok ? { tone: "ok", text: `Call ${r.data.callId} started. Watch the phones.` } : { tone: "err", text: explain(r) });
  };

  const verifierCancels = async () => {
    setStatus("verify", { tone: "busy", text: "Finding the paused purchase…" });
    const [holds, orders] = await Promise.all([
      svc("money", "/holds?seniorId=sen_rose", { schema: z.array(HoldSchema) }),
      svc("money", "/orders?seniorId=sen_rose", { schema: z.array(OrderSchema) }),
    ]);
    if (!holds.ok) return setStatus("verify", { tone: "err", text: explain(holds) });
    const hold = holds.data.filter((h) => h.status === "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!hold) return setStatus("verify", { tone: "err", text: "Nothing is paused. Run the grandparent scam first." });
    const verifier = orders.ok ? orders.data.find((o) => o.id === hold.orderId)?.fraud.suggestedVerifierId ?? "mem_danny" : "mem_danny";
    const r = await svc<{ callId: string }>("voice", "/demo/simulate-verification", {
      method: "POST", body: { seniorId: "sen_rose", holdId: hold.id, memberId: verifier, script: DANNY_CANCELS },
    });
    setStatus("verify", r.ok ? { tone: "ok", text: `Check-in call ${r.data.callId}: ${verifier.replace("mem_", "")} said it wasn't him.` } : { tone: "err", text: explain(r, "CCR-04") });
  };

  const fastForward = async () => {
    if (!next) return setStatus("ff", { tone: "err", text: "No family call is booked. Run “I'd love to see the kids” and accept a time first." });
    setStatus("ff", { tone: "busy", text: "Ringing Rose…" });
    const r = await svc("family", "/demo/fire-due", { method: "POST", body: { scheduledCallId: next.id } });
    setStatus("ff", r.ok ? { tone: "ok", text: "It's call time. Rose's phone is ringing." } : { tone: "err", text: explain(r, "CCR-02") });
  };

  const reset = async () => {
    if (!confirm("Reset every service to the seed data? Orders, messages, and calls from this session will be erased.")) return;
    setStatus("reset", { tone: "busy", text: "Resetting family, then money, then voice…" });
    for (const s of ["family", "money", "voice"] as const) {
      const r = await svc(s, "/demo/reset", { method: "POST", body: {} });
      if (!r.ok) return setStatus("reset", { tone: "err", text: `${s}: ${explain(r, "CCR-01")}` });
    }
    setStatus("reset", { tone: "ok", text: "All data reset to the seed." });
  };

  const showEval = async () => {
    setStatus("eval", { tone: "busy", text: "Loading…" });
    const r = await svc("money", "/eval/results");
    if (!r.ok) return setStatus("eval", { tone: "err", text: explain(r) });
    setEvalResult(r.data);
    setStatus("eval", { tone: "ok", text: "Latest eval run" });
  };

  return (
    <main className="mx-auto max-w-[1000px] px-5 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-3xl font-bold">Demo controls</h1>
        <p className="text-[14px] text-heron">
          {health?.map((h) => (
            <span key={h.s} className="ml-3">
              <span aria-hidden className={h.ok ? "text-leaf" : "text-alarm"}>●</span> {h.s}{h.ok ? (h.mock ? " (mock)" : "") : " down"}
            </span>
          )) ?? "Checking services…"}
        </p>
      </div>

      <section aria-labelledby="scen-h" className="mt-8">
        <h2 id="scen-h" className="text-xl font-bold">Rose calls</h2>
        <p className="mt-1 text-[15px] text-heron">Each one plays Rose's side of a phone call as text. Keep /family open in another window to watch it land.</p>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
          {DEMO_BUTTONS.map((d, i) => (
            <li key={d.id} className="rounded-xl bg-white p-4">
              <button type="button" onClick={() => run(d)} disabled={status[d.id]?.tone === "busy"}
                className="w-full rounded-lg bg-ink px-4 py-3 text-left text-[17px] font-bold text-white disabled:opacity-60">
                {i + 1}. {d.label}
              </button>
              <p className="mt-2 text-[14.5px]">{d.expect}</p>
              <details className="mt-1 text-[14px] text-heron">
                <summary className="cursor-pointer">What Rose says</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{d.script.map((l) => <li key={l}>{l}</li>)}</ul>
              </details>
              <Line s={status[d.id]} />
            </li>
          ))}
          <li className="rounded-xl border-2 border-dashed border-alarm/40 p-4">
            <button type="button" onClick={verifierCancels} className="w-full rounded-lg border-2 border-alarm px-4 py-3 text-left text-[17px] font-bold text-alarm">
              Danny answers the check-in call
            </button>
            <p className="mt-2 text-[14.5px]">After the scam: the real Danny, on his number on file, says it wasn't him and cancels.</p>
            <Line s={status.verify} />
          </li>
        </ol>
      </section>

      <section aria-labelledby="time-h" className="mt-10 grid gap-3 sm:grid-cols-3">
        <h2 id="time-h" className="sr-only">Time and data</h2>
        <div className="rounded-xl bg-white p-4">
          <button type="button" onClick={fastForward} className="w-full rounded-lg bg-leaf px-4 py-3 text-[16px] font-bold text-white">
            Fast-forward to {next ? roseTime(next.startUtc) : "the next call"}
          </button>
          <Line s={status.ff} />
        </div>
        <div className="rounded-xl bg-white p-4">
          <button type="button" onClick={showEval} className="w-full rounded-lg border-2 border-ink px-4 py-3 text-[16px] font-bold">Show eval results</button>
          <Line s={status.eval} />
        </div>
        <div className="rounded-xl bg-white p-4">
          <button type="button" onClick={reset} className="w-full rounded-lg border-2 border-alarm px-4 py-3 text-[16px] font-bold text-alarm">Reset all data</button>
          <Line s={status.reset} />
        </div>
      </section>

      {evalResult !== undefined && (
        <section aria-labelledby="eval-h" className="mt-6 rounded-xl bg-white p-4">
          <h2 id="eval-h" className="text-lg font-bold">Fraud eval: latest run</h2>
          <pre className="mt-2 max-h-[420px] overflow-auto rounded-lg bg-mist p-3 text-[13px]">{JSON.stringify(evalResult, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
