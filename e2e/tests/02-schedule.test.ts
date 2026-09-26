/**
 * E2E 2 · Schedule: proposal → Lisa and Danny accept → Rose confirms (scripted) →
 * ScheduledCall exists → fast-forward → voice /calls/outbound was hit.
 */
import type { Message, Slot } from "@care-circle/contracts";
import { family, voice, inboxSnapshot, newSince, summarizeMsg } from "../src/api";
import { scenario, waitFor, FailFast } from "../src/harness";
import { SEE_THE_KIDS, confirmSlotScript } from "../src/scripts";
import { checkSlot } from "../src/slots";

/** Slot buttons on a schedule_proposal. Payload shape is proposed in CCR-05. */
function slotActions(m: Message) {
  return (m.actions ?? []).filter((a) => a.payload && (a.payload.slotId || a.payload.slot?.id));
}
const slotIdOf = (payload: any): string => payload.slotId ?? payload.slot?.id;

scenario("E2E 2 · schedule → confirm → phone rings", async (t) => {
  const before = await inboxSnapshot(["mem_lisa", "mem_danny"]);

  await t.step("voice", "simulate-inbound accepts “I'd love to see the kids”", () => voice.simulateInbound(SEE_THE_KIDS.script));

  const proposals = await t.step("family", "Lisa and Danny each receive a `schedule_proposal` with 3 slot buttons", async () => {
    const out: Record<string, Message> = {};
    for (const m of ["mem_lisa", "mem_danny"] as const) {
      out[m] = await waitFor(`schedule_proposal for ${m}`, async (observe) => {
        const fresh = newSince(await family.inbox(m), before[m]!);
        observe(fresh.map(summarizeMsg));
        const p = fresh.find((x) => x.kind === "schedule_proposal");
        if (!p) return undefined;
        const n = slotActions(p).length;
        if (n !== 3) throw new FailFast(`${m}'s proposal has ${n} slot buttons (want 3). actions=${JSON.stringify(p.actions)}`);
        return p;
      });
    }
    return out as Record<"mem_lisa" | "mem_danny", Message>;
  });

  await t.step("family", "every proposed slot has correct local times and avoids Rose's nap and church", async () => {
    const slots = slotActions(proposals.mem_lisa).map((a) => a.payload.slot as Slot | undefined).filter(Boolean) as Slot[];
    if (!slots.length) { t.warn("slot payloads carry no Slot object (CCR-05); skipped time-zone checks"); return; }
    const problems = slots.flatMap((s) => checkSlot(s).problems);
    const unreadable = slots.flatMap((s) => checkSlot(s).unreadable);
    if (unreadable.length) t.warn(`localTimes not in "Sun 4:00 PM" form: ${unreadable.join(", ")}`);
    if (problems.length) throw new Error(problems.join(" | "));
  });

  // Both accept the same (first) slot.
  const chosen = slotActions(proposals.mem_lisa)[0]!;
  const chosenSlotId = slotIdOf(chosen.payload);
  const proposalId: string | undefined = chosen.payload.proposalId;

  await t.step("family", "Lisa and Danny can accept the same slot via POST /messages/:id/act", async () => {
    for (const m of ["mem_lisa", "mem_danny"] as const) {
      const btn = slotActions(proposals[m]).find((a) => slotIdOf(a.payload) === chosenSlotId);
      if (!btn) throw new Error(`${m}'s proposal has no button for slot ${chosenSlotId}; buttons=${JSON.stringify(proposals[m].actions)}`);
      await family.act(proposals[m].id, btn.action, btn.payload);
    }
  });

  const pending = await t.step("family", "the proposal moves to `awaiting_senior` and is listed in pending-senior", () =>
    waitFor("proposal awaiting Rose", async (observe) => {
      const list = await family.pendingSenior();
      observe(list.map((p) => ({ id: p.id, status: p.status, responses: p.responses })));
      return list.find((p) => (proposalId ? p.id === proposalId : p.slots.some((s) => s.id === chosenSlotId)));
    }));

  const slot = pending.slots.find((s) => s.id === chosenSlotId);
  const roseLocal = slot?.localTimes["sen_rose"];
  if (!roseLocal) {
    await t.step("family", "the accepted slot includes Rose's local time (localTimes.sen_rose)", async () => {
      throw new Error(`slot ${chosenSlotId} missing localTimes.sen_rose: ${JSON.stringify(slot)}`);
    });
  }

  await t.step("voice", "Rose confirms by voice; voice calls confirm_family_time", () =>
    voice.simulateInbound(confirmSlotScript(roseLocal!)));

  const scheduled = await t.step("family", "a ScheduledCall for this proposal appears in /schedule/:seniorId/upcoming", () =>
    waitFor("ScheduledCall", async (observe) => {
      const list = await family.upcoming();
      observe(list.map((c) => ({ id: c.id, proposalId: c.proposalId, startUtc: c.startUtc, status: c.status })));
      return list.find((c) => c.proposalId === pending.id);
    }));

  await t.step("family", "the ScheduledCall starts at the accepted slot and includes Lisa and Danny", async () => {
    if (slot && scheduled.startUtc !== slot.startUtc) throw new Error(`startUtc ${scheduled.startUtc} ≠ slot ${slot.startUtc}`);
    for (const m of ["mem_lisa", "mem_danny"]) if (!scheduled.memberIds.includes(m)) throw new Error(`memberIds missing ${m}: ${scheduled.memberIds}`);
  });

  await t.step("family", "fast-forward fires scheduled_call.due now", () =>
    t.proposed("CCR-02 (POST family /demo/fire-due)", () => family.fireDue(scheduled.id)));

  await t.step("voice", "voice placed an outbound scheduled_family_call for this ScheduledCall", () =>
    t.proposed("CCR-03 (GET voice /demo/calls)", () =>
      waitFor("outbound call for scheduled call", async (observe) => {
        const calls = await voice.calls();
        observe(calls);
        return calls.find((c) => c.scheduledCallId === scheduled.id && (c.purpose ?? c.kind) === "scheduled_family_call");
      }, { timeoutMs: 30_000 })));
});
