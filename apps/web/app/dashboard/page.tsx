"use client";
import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { HoldSchema, OrderSchema, ScheduledCallSchema, type Hold, type Order, type ScheduledCall } from "@care-circle/contracts";
import { FraudDrawer } from "@/components/FraudDrawer";
import { SAMPLE_HOLDS, SAMPLE_MOMENTS, SAMPLE_ORDERS, SAMPLE_UPCOMING } from "@/lib/fixtures";
import { svc, explain } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

type Moments = typeof SAMPLE_MOMENTS;
interface Section<T> { data: T; sample: boolean; note?: string }

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const count = (x: unknown) => (typeof x === "number" ? x : Array.isArray(x) ? x.length : 0);
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0 });
const roseTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

async function load<T>(p: ReturnType<typeof svc<T>>, sample: T): Promise<Section<T>> {
  const r = await p;
  return r.ok ? { data: r.data, sample: false } : { data: sample, sample: true, note: explain(r) };
}

function SampleTag({ s }: { s: Section<unknown> | undefined }) {
  if (!s?.sample) return null;
  return <span title={s.note} className="ml-2 whitespace-nowrap rounded bg-honey/25 px-1.5 py-0.5 align-middle text-[12px] font-normal text-ink/70">sample data</span>;
}

export default function Dashboard() {
  const [open, setOpen] = useState<Order>();
  const d = usePoll(async (signal) => {
    const [moments, upcoming, holds, orders] = await Promise.all([
      load(svc<Moments>("family", "/moments/sen_rose", { signal }), SAMPLE_MOMENTS),
      load(svc("family", "/schedule/sen_rose/upcoming", { schema: z.array(ScheduledCallSchema), signal }), SAMPLE_UPCOMING as ScheduledCall[]),
      load(svc("money", "/holds?seniorId=sen_rose", { schema: z.array(HoldSchema), signal }), SAMPLE_HOLDS as Hold[]),
      load(svc("money", "/orders?seniorId=sen_rose", { schema: z.array(OrderSchema), signal }), SAMPLE_ORDERS as Order[]),
    ]);
    return { moments, upcoming, holds, orders };
  }, 3000);

  const m = d?.moments.data;
  const connections = m ? count(m.calls) + count(m.voiceNotes) + count(m.gifts) + count(m.addedItems) : undefined;
  const orderById = Object.fromEntries((d?.orders.data ?? []).map((o) => [o.id, o]));
  const openHolds = (d?.holds.data ?? []).filter((h) => h.status === "open");
  const recent = [...(d?.orders.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);

  return (
    <main className="mx-auto max-w-[1120px] px-5 py-8">
      <h1 className="text-3xl font-bold">Rose's week</h1>
      <p className="mt-3 max-w-[40ch] text-[26px] leading-snug">
        {m === undefined ? "Loading…" : (
          <>
            <b>{connections}</b> connection moment{connections === 1 ? "" : "s"}. <b>{m.scamsStopped}</b> scam{m.scamsStopped === 1 ? "" : "s"} stopped.{" "}
            <b>{usd(m.savedCents)}</b> saved.
          </>
        )}
        <SampleTag s={d?.moments} />
      </p>
      {m && (
        <p className="mt-2 text-[15px] text-heron">
          {n(count(m.calls), "call")}, {n(count(m.voiceNotes), "voice note")}, {n(count(m.gifts), "gift")},{" "}
          {n(count(m.addedItems), "item")} the family added to her orders.
        </p>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-10">
          <section aria-labelledby="holds-h">
            <h2 id="holds-h" className="text-xl font-bold">Paused purchases<SampleTag s={d?.holds} /></h2>
            {openHolds.length === 0 ? (
              <p className="mt-2 text-[15px] text-heron">Nothing is paused right now.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {openHolds.map((h) => {
                  const o = orderById[h.orderId];
                  return (
                    <li key={h.id} className="rounded-xl border-l-4 border-alarm bg-white px-4 py-3">
                      <p className="text-[15px] font-bold">{o ? `${o.request.payeeDescription ?? o.request.type}, ${usd(o.request.amountCents)}` : h.orderId}</p>
                      <p className="mt-1 text-[15.5px] leading-relaxed">{o?.fraud.familyFacingSummary ?? "Loading the reason…"}</p>
                      <p className="mt-2 text-[14px] text-heron">Stays paused until {roseTime(h.coolingOffUntil)} unless the family decides sooner.</p>
                      {o && <button type="button" onClick={() => setOpen(o)} className="mt-2 text-[15px] font-bold text-ink underline underline-offset-4">See how we decided</button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="orders-h">
            <h2 id="orders-h" className="text-xl font-bold">Recent orders<SampleTag s={d?.orders} /></h2>
            <div className="mt-3 overflow-x-auto rounded-xl bg-white">
              <table className="w-full text-left text-[15px]">
                <thead className="text-[13.5px] text-heron">
                  <tr><th className="px-4 py-2 font-normal">When</th><th className="px-4 py-2 font-normal">What</th><th className="px-4 py-2 text-right font-normal">Amount</th><th className="px-4 py-2 font-normal">Status</th><th className="px-4 py-2"><span className="sr-only">Details</span></th></tr>
                </thead>
                <tbody>
                  {recent.map((o) => (
                    <tr key={o.id} className="border-t border-mist">
                      <td className="whitespace-nowrap px-4 py-2 text-heron">{roseTime(o.createdAt)}</td>
                      <td className="px-4 py-2">{o.request.payeeDescription ?? o.request.items.map((i) => i.name).join(", ")}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{usd(o.request.amountCents)}</td>
                      <td className="px-4 py-2">
                        <span className={o.status === "held" ? "font-bold text-alarm" : o.status === "paid" ? "text-leaf" : "text-heron"}>{o.status}</span>
                      </td>
                      <td className="px-4 py-2 text-right"><button type="button" onClick={() => setOpen(o)} className="text-[14px] text-heron underline underline-offset-4">Details</button></td>
                    </tr>
                  ))}
                  {recent.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-heron">No orders yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section aria-labelledby="calls-h">
          <h2 id="calls-h" className="text-xl font-bold">Upcoming calls<SampleTag s={d?.upcoming} /></h2>
          {(d?.upcoming.data ?? []).length === 0 ? (
            <p className="mt-2 text-[15px] text-heron">No calls booked. Ask Rose, or tap “I'd love to see the kids” on Demo controls.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {d!.upcoming.data.map((c) => (
                <li key={c.id} className="rounded-xl bg-white px-4 py-3">
                  <p className="text-[17px] font-bold">{roseTime(c.startUtc)} <span className="text-[14px] font-normal text-heron">Rose's time</span></p>
                  <p className="mt-1 text-[15px]">{c.memberIds.map((id) => id.replace("mem_", "").replace(/^./, (x) => x.toUpperCase())).join(", ")}{c.recurring ? ", every week" : ""}</p>
                  <p className="mt-1 text-[14px] text-heron">Rose joins {c.seniorJoin === "phone_dialout" ? "on her regular phone" : "on her tablet"}. Status: {c.status}.</p>
                  <Link href={`/call/${c.id}`} className="mt-2 inline-block rounded-lg bg-leaf px-3 py-1.5 text-[15px] font-bold text-white">Join the video call</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {open && <FraudDrawer order={open} onClose={() => setOpen(undefined)} />}
    </main>
  );
}
