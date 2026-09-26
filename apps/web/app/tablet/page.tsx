"use client";
/**
 * Plan B for Rose: a tablet that only ever does one thing. Huge type, one green button,
 * and it auto-answers ONLY calls booked through her circle (the schedule is the allowlist).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { ScheduledCallSchema } from "@care-circle/contracts";
import { svc } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

const NAMES: Record<string, string> = { mem_lisa: "Lisa", mem_danny: "Danny", mem_mark: "Mark" };
const AUTO_ANSWER_SECONDS = 5;

export default function Tablet() {
  const router = useRouter();
  const [now, setNow] = useState<Date>();
  const [countdown, setCountdown] = useState<number>();

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const ringing = usePoll(async (signal) => {
    const r = await svc("family", "/schedule/sen_rose/upcoming", { schema: z.array(ScheduledCallSchema), signal });
    return r.ok ? r.data.find((c) => c.status === "ringing" && c.seniorJoin === "tablet" && c.memberIds.every((m) => m in NAMES)) : undefined;
  }, 1500);

  // Auto-answer after a short, visible countdown so Rose is never surprised.
  useEffect(() => {
    if (!ringing) { setCountdown(undefined); return; }
    setCountdown(AUTO_ANSWER_SECONDS);
    const id = setInterval(() => setCountdown((c) => (c === undefined ? c : c - 1)), 1000);
    return () => clearInterval(id);
  }, [ringing?.id]);

  useEffect(() => {
    if (ringing && countdown !== undefined && countdown <= 0) router.push(`/call/${ringing.id}?as=sen_rose`);
  }, [countdown, ringing, router]);

  const who = ringing ? ringing.memberIds.map((m) => NAMES[m]).join(" and ") : "";

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f5ef] px-8 text-center text-ink">
      {ringing ? (
        <div>
          <p className="text-[64px] font-bold leading-tight">{who}</p>
          <p className="mt-2 text-[36px]">want to see you!</p>
          <button
            type="button"
            onClick={() => router.push(`/call/${ringing.id}?as=sen_rose`)}
            className="mt-12 h-[180px] w-[min(80vw,560px)] rounded-[40px] bg-leaf text-[56px] font-bold text-white shadow-lg"
          >
            Answer
          </button>
          {countdown !== undefined && countdown > 0 && <p className="mt-6 text-[28px] text-heron">Answering by itself in {countdown}</p>}
        </div>
      ) : (
        <div>
          <p className="text-[96px] font-bold leading-none tabular-nums">
            {now ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(now) : ""}
          </p>
          <p className="mt-4 text-[40px]">
            {now ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" }).format(now) : ""}
          </p>
          <p className="mt-16 text-[32px] text-heron">When your family calls, this screen lights up.</p>
        </div>
      )}
    </main>
  );
}
