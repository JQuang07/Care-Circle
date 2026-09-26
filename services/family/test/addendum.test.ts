import { beforeEach, describe, expect, it } from "vitest";
import type { ContactRhythm, Proposal, ScheduledCall } from "../src/contracts-local.js";
import { newId } from "../src/ids.js";
import { json, makeCtx, type TestCtx } from "./helpers.js";

// Addendum D6 / D7 / D11 / D12 (integration v2, task 4).
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeCtx(); });

describe("D6 + D7: circle and rhythm shapes", () => {
  it("everAskedForMoney is a boolean (false for everyone in the seed)", async () => {
    const r = await json<ContactRhythm>(ctx, "GET", "/contact-rhythm/sen_rose");
    expect(r.body.perMember).toHaveLength(3);
    for (const m of r.body.perMember) expect(m.everAskedForMoney).toBe(false);
  });

  it("Mia is seeded with a birthday, is not a member, and /circle carries seniorHints", async () => {
    const r = await json(ctx, "GET", "/circle/sen_rose");
    const lisa = r.body.members.find((m: any) => m.id === "mem_lisa");
    expect(lisa.dependents).toEqual([{ name: "Mia", age: 9, schoolHours: "08:00-15:30 mon-fri", birthday: "10-14" }]);
    expect(r.body.members.map((m: any) => m.name)).not.toContain("Mia");
    expect(r.body.seniorHints).toEqual([]);
  });
});

describe("D11: additive endpoints and fields", () => {
  it("GET /schedule/proposals/:id returns the Proposal (404 when unknown)", async () => {
    const p = (await json<Proposal>(ctx, "POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior" })).body;
    const r = await json<Proposal>(ctx, "GET", `/schedule/proposals/${p.id}`);
    expect(r.body).toEqual(p);
    expect((await json(ctx, "GET", "/schedule/proposals/prop_nope")).status).toBe(404);
  });

  it("call.ended with scheduledCallId closes that call even when the start time is far off", async () => {
    const p = (await json<Proposal>(ctx, "POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior", memberIds: ["mem_lisa"] })).body;
    await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: p.slots[0].id, accept: true });
    const sc = (await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id })).body;
    const r = await json(ctx, "POST", "/webhooks/call-ended", {
      callId: "call_x", seniorId: "sen_rose", kind: "scheduled_family_call", scheduledCallId: sc.id,
      startedAt: "2026-09-30T15:00:00Z", endedAt: "2026-09-30T15:20:00Z", transcript: [], privateSpans: [],
    });
    expect(r.status).toBe(200);
    await ctx.app.flushJobs();
    expect((await ctx.deps.store.scheduledCalls.get(sc.id))!.status).toBe("done");
  });
});

describe("D12: /moments?week= is an ISO week in Rose's time zone", () => {
  // NOW is Wed Sep 30 2026 11:00 ET, so the current week is 2026-W40 (Mon Sep 28 → Mon Oct 5, ET).
  async function voiceNoteAt(at: string) {
    await ctx.deps.store.moments.put({ id: newId("evt"), seniorId: "sen_rose", type: "voice_note", at });
  }

  it("defaults to the current calendar week, not the rolling last 7 days", async () => {
    await voiceNoteAt("2026-09-28T04:30:00Z"); // Mon 00:30 ET: this week
    await voiceNoteAt("2026-09-28T03:30:00Z"); // Sun 23:30 ET: last week, though within 7 days
    expect((await json(ctx, "GET", "/moments/sen_rose")).body.voiceNotes).toBe(1);
    expect((await json(ctx, "GET", "/moments/sen_rose?week=2026-W40")).body.voiceNotes).toBe(1);
    expect((await json(ctx, "GET", "/moments/sen_rose?week=2026-10-01")).body.voiceNotes).toBe(1);
    expect((await json(ctx, "GET", "/moments/sen_rose?week=2026-W39")).body.voiceNotes).toBe(1);
    expect((await json(ctx, "GET", "/moments/sen_rose?week=last7")).body.voiceNotes).toBe(2);
  });
});
