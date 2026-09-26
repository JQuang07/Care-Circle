import { beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { Message, Proposal, ScheduledCall } from "../src/contracts-local.js";
import { tick } from "../src/domain/jobs.js";
import { withinWeekly, parseDays, hm } from "../src/domain/time.js";
import { json, makeCtx, type TestCtx } from "./helpers.js";

const ET = "America/New_York";
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeCtx(); });

async function request(body: Record<string, unknown> = {}) {
  return json<Proposal & { error?: { code: string } }>(ctx, "POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "member", ...body });
}

async function setAvailability(memberId: string, blocks: { days: string; start: string; end: string }[]) {
  await ctx.deps.store.availability.put({ id: memberId, blocks, updatedAt: ctx.clock.now().toISOString() });
}

describe("no common slot", () => {
  it("proposes the next best slots and asks who can flex", async () => {
    // Mark is only free London early mornings, when Rose is asleep or at church.
    await setAvailability("mem_mark", [{ days: "daily", start: "06:00", end: "08:00" }]);
    const r = await request();
    expect(r.status).toBe(200);
    const p = r.body;
    expect(p.slots).toHaveLength(3);
    for (const s of p.slots) expect(s.reason).toMatch(/Mark .* would need to flex/);
    const inbox = (await json<Message[]>(ctx, "GET", "/messages?memberId=mem_mark")).body;
    expect(inbox.at(-1)!.body).toMatch(/no time this week that works for everyone.*Mark, could you flex/s);
    // Rose's constraints are never relaxed, even for flex slots.
    for (const s of p.slots) {
      const et = DateTime.fromISO(s.startUtc, { zone: ET });
      const mins = et.hour * 60 + et.minute;
      expect(mins).toBeGreaterThanOrEqual(10 * 60);
      expect(mins >= 12 * 60 + 30 && mins < 15 * 60).toBe(false); // a 30-min call can't touch the 1–3pm nap
      expect(mins + 30).toBeLessThanOrEqual(19 * 60);
    }
    // If Mark flexes and everyone accepts, it proceeds as usual.
    for (const m of p.memberIds) await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: m, slotId: p.slots[0].id, accept: true });
    expect((await json(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id })).status).toBe(200);
  });

  it("422 NO_SLOTS when nobody can make any time", async () => {
    for (const m of ["mem_lisa", "mem_danny", "mem_mark"]) await setAvailability(m, [{ days: "daily", start: "02:00", end: "03:00" }]);
    const r = await request();
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe("NO_SLOTS");
  });
});

describe("declines", () => {
  it("everyone declining every slot → a fresh round with new times (atomic, no stale-slot crash)", async () => {
    const p = (await request()).body;
    // Nobody was named, so a slot dies once 2 of 3 decline it (D10). Lisa declines every slot first,
    // so Danny's decline-all kills the slots one by one mid-way.
    for (const s of p.slots) await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: s.id, accept: false });
    const msg = (await ctx.deps.store.messages.list({ toMemberId: "mem_danny", kind: "schedule_proposal" }))[0];
    const r = await json<Proposal>(ctx, "POST", `/messages/${msg.id}/act`, { action: "schedule_decline_all" });
    expect(r.status).toBe(200);
    const next = r.body;
    expect(next.status).toBe("proposed");
    expect(next.responses).toEqual([]);
    expect(next.slots).toHaveLength(3);
    const oldStarts = new Set(p.slots.map((s) => s.startUtc));
    for (const s of next.slots) expect(oldStarts.has(s.startUtc)).toBe(false);
    const latest = (await ctx.deps.store.messages.list({ toMemberId: "mem_mark", kind: "schedule_proposal" })).at(-1)!;
    expect(latest.body).toMatch(/new options/);
    // A tap on an old button is a friendly 409, not a crash.
    const stale = await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_mark", slotId: p.slots[0].id, accept: true });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("SLOT_EXPIRED");
  });

  it("after 3 rounds of declines, asks the family for a time instead of looping", async () => {
    const p = (await request({ memberIds: ["mem_lisa"] })).body;
    for (let round = 0; round < 3; round++) {
      const cur = (await ctx.deps.store.proposals.get(p.id))!;
      await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: cur.slots[0].id, accept: false });
      await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: cur.slots[1].id, accept: false });
      await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: cur.slots[2].id, accept: false });
    }
    const inbox = (await json<Message[]>(ctx, "GET", "/messages?memberId=mem_lisa")).body;
    expect(inbox.filter((m) => m.kind === "schedule_proposal")).toHaveLength(3);
    expect(inbox.at(-1)!.body).toMatch(/Reply with a day and time/);
  });

  it("declining the agreed slot after awaiting_senior drops it back to proposed", async () => {
    const p = (await request({ memberIds: ["mem_lisa", "mem_danny"] })).body;
    const s = p.slots[0].id;
    await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: s, accept: true });
    const a = await json<Proposal>(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_danny", slotId: s, accept: true });
    expect(a.body.status).toBe("awaiting_senior");
    const b = await json<Proposal>(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_danny", slotId: s, accept: false });
    expect(b.body.status).toBe("proposed");
    expect((await json(ctx, "GET", "/proposals/sen_rose/pending-senior")).body).toEqual([]);
  });

  it("confirm-senior rejects a slot whose time has passed", async () => {
    const p = (await request({ memberIds: ["mem_lisa"] })).body;
    await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: p.slots[0].id, accept: true });
    ctx.clock.travelTo(new Date(Date.parse(p.slots[0].startUtc) + 60_000));
    const r = await json(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("SLOT_INVALID");
  });
});

describe("time-zone boundaries", () => {
  it("availability windows chain across midnight", () => {
    const w = [
      { days: parseDays("daily"), start: hm("23:00"), end: 24 * 60 },
      { days: parseDays("daily"), start: hm("00:00"), end: hm("01:00") },
    ];
    const s = DateTime.fromISO("2026-10-03T23:30", { zone: "Europe/London" }).toMillis();
    expect(withinWeekly({ start: s, end: s + 60 * 60_000 }, "Europe/London", w)).toBe(true);
    expect(withinWeekly({ start: s, end: s + 120 * 60_000 }, "Europe/London", w)).toBe(false);
  });

  it("a slot that is late evening for Mark can straddle his midnight", async () => {
    // Mark is a night owl this week: 23:00–01:00 London. Rose 6:30pm ET = 23:30 BST.
    await setAvailability("mem_mark", [{ days: "daily", start: "23:00", end: "24:00" }, { days: "daily", start: "00:00", end: "01:00" }]);
    const p = (await request({ memberIds: ["mem_mark"] })).body;
    expect(p.slots.length).toBeGreaterThan(0);
    for (const s of p.slots) {
      expect(s.localTimes.sen_rose).toMatch(/(6:00|6:30) PM$/);
      expect(s.localTimes.mem_mark).toMatch(/11:(00|30) PM$/);
    }
  });
});

describe("DST", () => {
  // UK falls back Sun Oct 25 2026; US falls back Sun Nov 1 2026. For that week London is only 4h ahead of NY.
  it("Mark's local time shifts correctly across the UK/US DST gap", async () => {
    ctx = await makeCtx({ now: "2026-10-21T15:00:00Z" });
    const p = (await request({ preferredWindow: "sunday 4pm" })).body;
    const oct25 = p.slots.find((s) => s.startUtc.startsWith("2026-10-25"));
    expect(oct25).toBeDefined();
    expect(oct25!.localTimes.sen_rose).toBe("Sun 4:00 PM");
    expect(oct25!.localTimes.mem_mark).toBe("Sun 8:00 PM"); // not 9pm: London is on GMT, NY still on EDT
    expect(oct25!.startUtc).toBe("2026-10-25T20:00:00.000Z");
  });

  it("Rose's routine holds on US DST day (Nov 1), in local wall-clock time", async () => {
    ctx = await makeCtx({ now: "2026-10-29T15:00:00Z" });
    const p = (await request({ preferredWindow: "sunday" })).body;
    const nov1 = p.slots.filter((s) => s.startUtc.startsWith("2026-11-01"));
    expect(nov1.length).toBeGreaterThan(0);
    for (const s of nov1) {
      const et = DateTime.fromISO(s.startUtc, { zone: ET });
      const mins = et.hour * 60 + et.minute;
      expect(mins >= 12 * 60 && mins < 13 * 60 || mins >= 15 * 60).toBe(true); // after church, not in nap
      expect(mins + 30).toBeLessThanOrEqual(19 * 60);
    }
    const four = nov1.find((s) => s.localTimes.sen_rose === "Sun 4:00 PM");
    if (four) {
      expect(four.startUtc).toBe("2026-11-01T21:00:00.000Z");
      expect(four.localTimes.mem_mark).toBe("Sun 9:00 PM");
    }
  });

  it("a weekly call keeps its local wall-clock time across DST", async () => {
    ctx = await makeCtx({ now: "2026-10-21T15:00:00Z" });
    const p = (await request({ preferredWindow: "sunday 4pm" })).body;
    const slot = p.slots.find((s) => s.startUtc === "2026-10-25T20:00:00.000Z")!;
    for (const m of p.memberIds) await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: m, slotId: slot.id, accept: true });
    const sc = (await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: slot.id })).body;
    ctx.clock.travelTo(new Date(sc.startUtc));
    await tick(ctx.deps);
    await json(ctx, "POST", "/webhooks/call-ended", { callId: "c1", seniorId: "sen_rose", kind: "scheduled_family_call", startedAt: sc.startUtc, endedAt: "2026-10-25T20:40:00Z", transcript: [], privateSpans: [] });
    await ctx.app.flushJobs();
    const offer = (await ctx.deps.store.messages.list({ toMemberId: "mem_lisa" })).find((m) => m.actions?.some((a) => a.action === "make_weekly"))!;
    await json(ctx, "POST", `/messages/${offer.id}/act`, { action: "make_weekly" });
    const next = (await ctx.deps.store.scheduledCalls.list({ status: "scheduled" }))[0];
    expect(next.startUtc).toBe("2026-11-01T21:00:00.000Z"); // 4pm EST, one hour later in UTC
    expect(DateTime.fromISO(next.startUtc, { zone: ET }).toFormat("ccc h:mm a")).toBe("Sun 4:00 PM");
  });
});

describe("demo helpers", () => {
  it("/demo/reset re-seeds and resets the clock; /demo/clock reports virtual time", async () => {
    await request();
    ctx.clock.travelTo(new Date("2026-12-25T12:00:00Z"));
    expect((await json(ctx, "GET", "/demo/clock")).body.nowUtc).toBe("2026-12-25T12:00:00.000Z");
    const r = await json(ctx, "POST", "/demo/reset");
    expect(r.body).toMatchObject({ ok: true });
    expect(await ctx.deps.store.proposals.list()).toEqual([]);
    expect((await json(ctx, "GET", "/demo/clock")).body.nowUtc).not.toBe("2026-12-25T12:00:00.000Z");
    expect((await json(ctx, "POST", "/demo/reset", undefined, {})).status).toBe(401);
  });
});
