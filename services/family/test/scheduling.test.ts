import { beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { Message, Order, Proposal, ScheduledCall } from "../src/contracts-local.js";
import { scriptedMuse } from "../src/adapters/muse.js";
import { fakeMoney, httpVoiceClient } from "../src/adapters/services.js";
import { getCircle } from "../src/domain/circle.js";
import { sendMessage } from "../src/domain/messages.js";
import { runRhythmJob, tick } from "../src/domain/jobs.js";
import { buildConstraints, checkSlot } from "../src/domain/scheduling/constraints.js";
import { json, makeCtx, NOW, type TestCtx } from "./helpers.js";

const ET = "America/New_York";
const MIN = 60_000;
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeCtx(); });

async function request(body: Record<string, unknown> = {}): Promise<Proposal> {
  const r = await json<Proposal>(ctx, "POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior", ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

async function acceptAll(p: Proposal, slotId = p.slots[0].id): Promise<Proposal> {
  let last: any;
  for (const m of p.memberIds) last = (await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: m, slotId, accept: true })).body;
  return last;
}

async function constraintsFor(p: Proposal) {
  const { senior, members } = await getCircle(ctx.deps, "sen_rose");
  return buildConstraints(ctx.deps, { senior, members, memberIds: p.memberIds, includeDependents: p.includesDependents.length > 0, kind: p.kind, now: ctx.clock.now() });
}

async function expectAllSlotsValid(p: Proposal) {
  const c = await constraintsFor(p);
  for (const s of p.slots) {
    expect(checkSlot(c, { start: Date.parse(s.startUtc), end: Date.parse(s.endUtc) }, ctx.clock.now().getTime()), s.startUtc).toEqual([]);
  }
}

describe("DoD: request → 3 valid slots → accepts → Rose confirms → room → scheduled_call.due", () => {
  it("runs end to end", async () => {
    const p = await request({ includeDependents: true });
    expect(p.slots).toHaveLength(3);
    await expectAllSlotsValid(p);
    for (const s of p.slots) {
      expect(s.reason).toMatch(/works for everyone/);
      expect(s.reason).toMatch(/Mia's out of school/);
    }
    // Every member got a schedule_proposal with one button per slot (+ "none of these").
    for (const m of p.memberIds) {
      const inbox = (await json<Message[]>(ctx, "GET", `/messages?memberId=${m}`)).body;
      const prop = inbox.find((x) => x.kind === "schedule_proposal")!;
      expect(prop.actions!.filter((a) => a.action === "accept_slot").map((a) => a.payload)).toEqual(p.slots.map((s) => ({ proposalId: p.id, slotId: s.id, slot: s })));
      expect(prop.actions!.at(-1)).toMatchObject({ action: "decline_all", payload: { proposalId: p.id } });
      expect(prop.actions!.map((a) => a.label).slice(0, 3)).toEqual(p.slots.map((s) => s.localTimes[m]));
    }

    // Accept via the WhatsApp buttons (Agent 4's path), not the raw endpoint.
    const slot = p.slots.find((s) => DateTime.fromISO(s.startUtc, { zone: ET }).weekday === 7) ?? p.slots[0];
    for (const m of p.memberIds) {
      const msg = (await ctx.deps.store.messages.list({ toMemberId: m, kind: "schedule_proposal" }))[0];
      const r = await json(ctx, "POST", `/messages/${msg.id}/act`, { action: "accept_slot", payload: { slotId: slot.id } });
      expect(r.status).toBe(200);
    }
    const pending = (await json<Proposal[]>(ctx, "GET", "/proposals/sen_rose/pending-senior")).body;
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("awaiting_senior");
    expect(pending[0].slots[0].id).toBe(slot.id); // agreed slot first for the voice agent

    const sc = (await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: slot.id })).body;
    expect(sc.status).toBe("scheduled");
    expect(sc.seniorJoin).toBe("phone_dialout");
    expect(ctx.rooms.created).toEqual([sc.roomName]);
    // Idempotent retry from the voice agent.
    expect((await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: slot.id })).body.id).toBe(sc.id);
    const join = await json(ctx, "GET", `/schedule/calls/${sc.id}/join?memberId=mem_mark`);
    expect(join.body).toEqual({ serverUrl: "ws://fake-livekit", roomName: sc.roomName, identity: "mem_mark", token: `fake.${sc.roomName}.mem_mark` });
    expect((await json(ctx, "GET", `/schedule/calls/${sc.id}/join?memberId=mem_nobody`)).status).toBe(403);

    const start = Date.parse(sc.startUtc);
    ctx.clock.travelTo(new Date(start - 61 * MIN));
    expect(await tick(ctx.deps)).toMatchObject({ briefings: 0, reminders: 0, due: 0 });
    ctx.clock.travelTo(new Date(start - 60 * MIN));
    expect((await tick(ctx.deps)).briefings).toBe(1);
    ctx.clock.travelTo(new Date(start - 30 * MIN));
    expect((await tick(ctx.deps)).reminders).toBe(1);
    expect(ctx.voice.events.map((e) => e.phase)).toEqual(["reminder"]);
    ctx.clock.travelTo(new Date(start));
    expect((await tick(ctx.deps)).due).toBe(1);
    expect(ctx.voice.events.map((e) => e.phase)).toEqual(["reminder", "due"]);
    expect(ctx.voice.events[1].call).toMatchObject({ id: sc.id, roomName: sc.roomName, status: "ringing" });
    // Nothing fires twice.
    expect(await tick(ctx.deps)).toMatchObject({ briefings: 0, reminders: 0, due: 0 });
    const up = (await json<ScheduledCall[]>(ctx, "GET", "/schedule/sen_rose/upcoming")).body;
    expect(up[0].status).toBe("ringing");
    // Briefings went to each member with local time + a host note for exactly one of them.
    const briefings = await ctx.deps.store.messages.list({ kind: "briefing" });
    expect(briefings.map((b) => b.toMemberId).sort()).toEqual([...p.memberIds].sort());
    expect(briefings.filter((b) => /You're hosting/.test(b.body))).toHaveLength(1);
  });

  it("/demo/time-travel to the next call fires due right away", async () => {
    const p = await request();
    await acceptAll(p);
    await json(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id });
    const r = await json(ctx, "POST", "/demo/time-travel", { to: "next_call" });
    expect(r.body.tick).toMatchObject({ due: 1, briefings: 1 });
    expect(ctx.voice.events.map((e) => e.phase)).toEqual(["due"]);
  });

  it("D2: /demo/fire-due fires scheduled_call.due now and sets ringing (secret required)", async () => {
    const p = await request();
    await acceptAll(p);
    const sc = (await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id })).body;
    expect((await json(ctx, "POST", "/demo/fire-due", { scheduledCallId: sc.id }, {})).status).toBe(401);
    expect((await json(ctx, "POST", "/demo/fire-due", { scheduledCallId: "sch_nope" })).status).toBe(404);
    const r = await json(ctx, "POST", "/demo/fire-due", { scheduledCallId: sc.id });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(ctx.voice.events).toHaveLength(1);
    expect(ctx.voice.events[0]).toMatchObject({ phase: "due", call: { id: sc.id, status: "ringing" } });
    expect((await ctx.deps.store.scheduledCalls.get(sc.id))!.status).toBe("ringing");
    // The scheduler won't fire it a second time when real time reaches T-0.
    ctx.clock.travelTo(new Date(Date.parse(sc.startUtc) + MIN));
    expect((await tick(ctx.deps)).due).toBe(0);
  });

  it("D4: the HTTP voice client sends phase in the body and keeps the X-CC-Phase header", async () => {
    const Fastify = (await import("fastify")).default;
    const seen: { body: any; header: unknown }[] = [];
    const fakeVoice = Fastify();
    fakeVoice.post("/webhooks/scheduled-call-due", async (req) => { seen.push({ body: req.body, header: req.headers["x-cc-phase"] }); return { ok: true }; });
    const url = await fakeVoice.listen({ port: 0, host: "127.0.0.1" });
    try {
      const client = httpVoiceClient({ ...ctx.deps.cfg, voiceUrl: url });
      const sc = { id: "sch_1", proposalId: "prop_1", seniorId: "sen_rose", memberIds: ["mem_lisa"], startUtc: NOW, roomName: "r", roomJoinUrl: "http://web.test/call/sch_1", seniorJoin: "phone_dialout", status: "scheduled" } as const;
      await client.scheduledCallDue({ ...sc, memberIds: [...sc.memberIds] }, "reminder");
      expect(seen).toEqual([{ body: { ...sc, phase: "reminder" }, header: "reminder" }]);
    } finally {
      await fakeVoice.close();
    }
  });
});

describe("DoD: hard constraints are enforced in code", () => {
  it("Muse can't propose a slot during a nap (or church, or outside Rose's window)", async () => {
    const napSunday = DateTime.fromISO("2026-10-04T13:30", { zone: ET }).toUTC().toISO()!;
    const church = DateTime.fromISO("2026-10-04T10:00", { zone: ET }).toUTC().toISO()!;
    const lateNight = DateTime.fromISO("2026-10-03T20:00", { zone: ET }).toUTC().toISO()!;
    const good = DateTime.fromISO("2026-10-04T16:00", { zone: ET }).toUTC().toISO()!;
    const muse = scriptedMuse((req) => req.name === "rank_slots" ? {
      picks: [
        { startUtc: napSunday, reason: "Sunday 1:30pm is perfect!" },
        { startUtc: church, reason: "Sunday 10am before lunch." },
        { startUtc: lateNight, reason: "Saturday 8pm." },
        { startUtc: good, reason: "Sunday 4pm works for everyone, including Mark at 9pm in London." },
      ],
    } : null);
    ctx = await makeCtx({ muse });
    const p = await request();
    expect(muse.calls.map((c) => c.name)).toEqual(["rank_slots"]);
    const starts = p.slots.map((s) => s.startUtc);
    expect(starts).not.toContain(napSunday);
    expect(starts).not.toContain(church);
    expect(starts).not.toContain(lateNight);
    expect(starts).toContain(good);
    expect(p.slots.find((s) => s.startUtc === good)!.reason).toBe("Sunday 4pm works for everyone, including Mark at 9pm in London.");
    expect(p.slots).toHaveLength(3); // topped up from code-validated candidates
    await expectAllSlotsValid(p);

    const c = await constraintsFor(p);
    const nap = Date.parse(napSunday);
    expect(checkSlot(c, { start: nap, end: nap + 30 * MIN })).toContain("senior_routine:nap");
  });

  it("every slot sits in 10:00–19:00 ET, avoids nap + church, across many start times", async () => {
    for (let h = 0; h < 7 * 24; h += 13) {
      ctx = await makeCtx({ now: new Date(Date.parse("2026-09-28T04:00:00Z") + h * 3600_000).toISOString() });
      const p = await request({ includeDependents: true });
      for (const s of p.slots) {
        const a = DateTime.fromISO(s.startUtc, { zone: ET });
        const b = DateTime.fromISO(s.endUtc, { zone: ET });
        expect(a.hour * 60 + a.minute).toBeGreaterThanOrEqual(600);
        expect(b.hour * 60 + b.minute).toBeLessThanOrEqual(19 * 60);
        const overlaps = (s1: number, e1: number) => a.hour * 60 + a.minute < e1 && s1 < b.hour * 60 + b.minute;
        expect(overlaps(13 * 60, 15 * 60)).toBe(false);
        if (a.weekday === 7) expect(overlaps(9 * 60 + 30, 12 * 60)).toBe(false);
        // Mia: never during school (Mon–Fri 08:00–15:30 Chicago)
        const ch = DateTime.fromISO(s.startUtc, { zone: "America/Chicago" });
        if (ch.weekday <= 5) expect(ch.hour * 60 + ch.minute >= 15 * 60 + 30 || ch.hour < 8).toBe(true);
      }
      await expectAllSlotsValid(p);
    }
  });

  it("blocks Rose's booked rides (from money orders)", async () => {
    const pickup = DateTime.fromISO("2026-10-04T16:15", { zone: ET }).toUTC().toISO()!;
    const ride = { id: "ord_ride", seniorId: "sen_rose", status: "paid", createdAt: "2026-09-29T12:00:00Z",
      request: { seniorId: "sen_rose", type: "ride", items: [{ name: "Ride to the library", qty: 1 }], amountCents: 1800, pickupAt: pickup, context: { transcriptExcerpt: "" } },
      fraud: {} } as unknown as Order;
    ctx = await makeCtx({ money: fakeMoney({ orders: [ride] }) });
    const p = await request({ preferredWindow: "sunday afternoon" });
    for (const s of p.slots) {
      const a = Date.parse(s.startUtc), b = Date.parse(s.endUtc);
      expect(a < Date.parse(pickup) + 120 * MIN && Date.parse(pickup) - 30 * MIN < b, s.startUtc).toBe(false);
    }
  });

  it("confirm-senior refuses slots the family hasn't all accepted", async () => {
    const p = await request();
    await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_lisa", slotId: p.slots[0].id, accept: true });
    const r = await json(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("NOT_AWAITING_SENIOR");
    expect((await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: "mem_intruder", slotId: p.slots[0].id, accept: true })).status).toBe(403);
  });
});

describe("dependents", () => {
  it("DoD: no message is ever addressed to a dependent", async () => {
    await expect(sendMessage(ctx.deps, { toMemberId: "Mia", kind: "text", body: "hi" })).rejects.toMatchObject({ code: "NOT_A_MEMBER" });
    // Mia-centric flows: every message lands with a real member.
    const p = await request({ memberIds: ["Mia", "mem_danny"], initiatedBy: "member" });
    expect(p.memberIds.sort()).toEqual(["mem_danny", "mem_lisa"]);
    expect(p.includesDependents).toEqual(["Mia"]);
    await json(ctx, "POST", "/messages/reply", { fromMemberId: "mem_lisa", body: "set up a video call with mom so Mia can say hi" });
    await acceptAll(p);
    await json(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id });
    await json(ctx, "POST", "/demo/time-travel", { to: "next_call", minutesBefore: 60 });
    const memberIds = new Set(["mem_lisa", "mem_danny", "mem_mark"]);
    const all = await ctx.deps.store.messages.list();
    expect(all.length).toBeGreaterThan(5);
    for (const m of all) expect(memberIds.has(m.toMemberId), m.toMemberId).toBe(true);
    expect((await json(ctx, "GET", "/messages?memberId=Mia")).status).toBe(404);
  });

  it("including dependents pulls in their parent", async () => {
    const p = await request({ memberIds: ["mem_danny"], includeDependents: true });
    expect(p.memberIds).toEqual(["mem_danny", "mem_lisa"]);
    expect(p.includesDependents).toEqual(["Mia"]);
  });
});

describe("local times + time zones", () => {
  it("fills localTimes for Rose and every member (Sunday 4pm ET = 9pm London)", async () => {
    const p = await request({ preferredWindow: "sunday 4pm" });
    const sun = p.slots.find((s) => s.localTimes.sen_rose === "Sun 4:00 PM")!;
    expect(sun.localTimes).toEqual({ sen_rose: "Sun 4:00 PM", mem_lisa: "Sun 3:00 PM", mem_danny: "Sun 2:00 PM", mem_mark: "Sun 9:00 PM" });
    expect(sun.reason).toMatch(/Mark at 9pm in London/);
  });
});

describe("after the call", () => {
  async function scheduleAndRing() {
    const p = await request({ preferredWindow: "sunday 4pm" });
    const slot = p.slots.find((s) => s.localTimes.sen_rose === "Sun 4:00 PM") ?? p.slots[0];
    await acceptAll(p, slot.id);
    const sc = (await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: slot.id })).body;
    ctx.clock.travelTo(new Date(sc.startUtc));
    await tick(ctx.deps);
    return sc;
  }

  it("call.ended → done, logged as contact + moment, weekly offer → recurring with rotated host", async () => {
    const sc = await scheduleAndRing();
    const endedAt = new Date(Date.parse(sc.startUtc) + 40 * MIN).toISOString();
    await json(ctx, "POST", "/webhooks/call-ended", {
      callId: "call_fam", seniorId: "sen_rose", kind: "scheduled_family_call", startedAt: sc.startUtc, endedAt,
      transcript: [{ speaker: "senior", text: "Oh it was so good to see you all. My tomatoes came in!", ts: sc.startUtc }], privateSpans: [],
    });
    await ctx.app.flushJobs();
    ctx.clock.travelTo(new Date(endedAt));
    const first = (await ctx.deps.store.scheduledCalls.get(sc.id))!;
    expect(first.status).toBe("done");
    const rhythm = (await json(ctx, "GET", "/contact-rhythm/sen_rose")).body;
    for (const pm of rhythm.perMember) expect(pm.lastContactAt).toBe(sc.startUtc);
    expect((await json(ctx, "GET", "/moments/sen_rose")).body.calls).toBeGreaterThanOrEqual(3);

    const offer = (await ctx.deps.store.messages.list({ toMemberId: "mem_mark" })).find((m) => m.actions?.some((a) => a.action === "make_weekly"))!;
    expect(offer.body).toMatch(/weekly Sunday call/);
    const r = await json(ctx, "POST", `/messages/${offer.id}/act`, { action: "make_weekly" });
    expect(r.body.ok).toBe(true);
    const all = (await ctx.deps.store.scheduledCalls.list({ proposalId: sc.proposalId })).sort((a, b) => a.startUtc.localeCompare(b.startUtc));
    expect(all).toHaveLength(2);
    expect(all[0].recurring).toBe("weekly");
    expect(all[1]).toMatchObject({ recurring: "weekly", status: "scheduled" });
    expect(DateTime.fromISO(all[1].startUtc, { zone: ET }).toFormat("ccc h:mm a")).toBe("Sun 4:00 PM");
    expect(all[1].hostMemberId).not.toBe(all[0].hostMemberId);
    expect(ctx.rooms.created).toHaveLength(2);
  });

  it("host rotation is fair across siblings over several weeks", async () => {
    let sc = await scheduleAndRing();
    const hosts: string[] = [(await ctx.deps.store.scheduledCalls.get(sc.id))!.hostMemberId!];
    await ctx.deps.store.scheduledCalls.put({ ...(await ctx.deps.store.scheduledCalls.get(sc.id))!, recurring: "weekly" });
    for (let week = 0; week < 5; week++) {
      await json(ctx, "POST", "/webhooks/call-ended", {
        callId: `call_w${week}`, seniorId: "sen_rose", kind: "scheduled_family_call", startedAt: sc.startUtc,
        endedAt: new Date(Date.parse(sc.startUtc) + 30 * MIN).toISOString(), transcript: [], privateSpans: [],
      });
      await ctx.app.flushJobs();
      const next = (await ctx.deps.store.scheduledCalls.list({ status: "scheduled" }))[0];
      hosts.push(next.hostMemberId!);
      ctx.clock.travelTo(new Date(next.startUtc));
      await tick(ctx.deps);
      sc = next;
    }
    const counts = hosts.reduce<Record<string, number>>((m, h) => ({ ...m, [h]: (m[h] ?? 0) + 1 }), {});
    expect(Object.keys(counts).sort()).toEqual(["mem_danny", "mem_lisa", "mem_mark"]);
    expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1);
  });

  it("marks a call missed when nobody ends it", async () => {
    const sc = await scheduleAndRing();
    ctx.clock.travelTo(new Date(Date.parse(sc.startUtc) + 91 * MIN));
    expect((await tick(ctx.deps)).missed).toBe(1);
    expect((await ctx.deps.store.scheduledCalls.get(sc.id))!.status).toBe("missed");
  });
});

describe("visits", () => {
  it("same flow, no phone leg, and a groceries hook for Rose's next call", async () => {
    const p = await request({ kind: "visit", memberIds: ["mem_lisa"], initiatedBy: "member", preferredWindow: "saturday" });
    expect(p.kind).toBe("visit");
    const s = p.slots[0];
    expect(Date.parse(s.endUtc) - Date.parse(s.startUtc)).toBe(120 * MIN);
    await acceptAll(p);
    const sc = (await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: s.id })).body;
    expect(ctx.rooms.created).toEqual([]);
    const circle = (await json(ctx, "GET", "/circle/sen_rose")).body;
    expect(circle.seniorHints[0].text).toMatch(/^Lisa is visiting \w{3}\. Want groceries for lunch\?$/);
    ctx.clock.travelTo(new Date(sc.startUtc));
    await tick(ctx.deps);
    expect(ctx.voice.events).toEqual([]);
  });
});

describe("ai_rhythm", () => {
  it("Danny's Sunday call missed twice → suggestion to Danny (never Rose, no guilt), once", async () => {
    // Now = Tuesday Oct 13; remove Danny's calls on Oct 4 and Oct 11.
    ctx = await makeCtx({ now: "2026-10-13T15:00:00Z" });
    const danny = await ctx.deps.store.calls.list({ memberId: "mem_danny" });
    for (const c of danny.filter((x) => x.startedAt >= "2026-10-04")) await ctx.deps.store.calls.delete(c.id);
    const created = await runRhythmJob(ctx.deps, "sen_rose");
    expect(created).toHaveLength(1);
    const p = (await ctx.deps.store.proposals.get(created[0]))!;
    expect(p).toMatchObject({ initiatedBy: "ai_rhythm", memberIds: ["mem_danny"] });
    const msg = (await ctx.deps.store.messages.list({ toMemberId: "mem_danny", kind: "schedule_proposal" }))[0];
    expect(msg.body).toMatch(/^Want to set up a video call with Rose\?/);
    expect(msg.body).not.toMatch(/haven't|missed|weeks|lonely|been a while/i);
    expect(p.slots.some((s) => s.localTimes.sen_rose.startsWith("Sun"))).toBe(true);
    // Idempotent: a second daily run doesn't pile on.
    expect(await runRhythmJob(ctx.deps, "sen_rose")).toEqual([]);
  });

  it("does nothing when the rhythm is intact", async () => {
    expect(await runRhythmJob(ctx.deps, "sen_rose")).toEqual([]);
  });
});
