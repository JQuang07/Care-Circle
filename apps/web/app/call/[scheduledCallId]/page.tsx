"use client";
/**
 * Family video room. Phase 3 wires LiveKit here (@livekit/components-react, token
 * minted server-side by the web app from LIVEKIT_API_KEY/SECRET). Until then this page
 * shows the call it would join, so links from the dashboard and tablet resolve.
 */
import { use } from "react";
import Link from "next/link";
import { z } from "zod";
import { ScheduledCallSchema } from "@care-circle/contracts";
import { svc } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

export default function CallRoom({ params }: { params: Promise<{ scheduledCallId: string }> }) {
  const { scheduledCallId } = use(params);
  const call = usePoll(async (signal) => {
    const r = await svc("family", "/schedule/sen_rose/upcoming", { schema: z.array(ScheduledCallSchema), signal });
    return r.ok ? r.data.find((c) => c.id === scheduledCallId) ?? null : null;
  }, 3000, [scheduledCallId]);

  return (
    <main className="mx-auto max-w-[900px] px-5 py-8">
      <h1 className="text-3xl font-bold">Family call</h1>
      <div className="mt-6 grid aspect-video place-items-center rounded-2xl bg-ink text-center text-white">
        <div className="px-6">
          <p className="text-2xl font-bold">Video room “{call?.roomName ?? scheduledCallId}”</p>
          <p className="mt-2 text-white/70">LiveKit video joins here in Phase 3. Rose appears as an audio tile from her phone.</p>
          {call && <p className="mt-4 text-white/80">Status: {call.status}</p>}
          {call === null && <p className="mt-4 text-white/80">This call isn't in Rose's upcoming calls.</p>}
        </div>
      </div>
      <Link href="/dashboard" className="mt-4 inline-block text-heron underline underline-offset-4">Back to Rose's week</Link>
    </main>
  );
}
