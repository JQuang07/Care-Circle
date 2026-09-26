import { describe, expect, it, beforeEach } from "vitest";
import { json, makeCtx, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeCtx(); });

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe("health + auth", () => {
  it("GET /health", async () => {
    const r = await json(ctx, "GET", "/health", undefined, {});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, service: "family", mock: false });
  });

  it("webhooks and /circle require X-CC-Secret", async () => {
    expect((await json(ctx, "GET", "/circle/sen_rose", undefined, {})).status).toBe(401);
    expect((await json(ctx, "POST", "/webhooks/order-paid", {}, { "x-cc-secret": "nope" })).status).toBe(401);
    const r = await json(ctx, "GET", "/circle/sen_rose");
    expect(r.status).toBe(200);
  });

  it("errors use the contract shape", async () => {
    const r = await json(ctx, "GET", "/contact-rhythm/sen_nobody");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "NOT_FOUND", message: expect.any(String) } });
  });
});

describe("GET /circle/:seniorId", () => {
  it("returns the seeded circle with phones and fixed IDs", async () => {
    const { body } = await json(ctx, "GET", "/circle/sen_rose");
    expect(body.senior).toMatchObject({ id: "sen_rose", name: "Rose", tz: "America/New_York", phone: "+1555010000" });
    expect(body.senior.routine).toHaveLength(2);
    expect(body.members.map((m: any) => m.id)).toEqual(["mem_lisa", "mem_danny", "mem_mark"]);
    expect(body.members[0].dependents[0]).toEqual({ name: "Mia", age: 9, schoolHours: "08:00-15:30 mon-fri" });
    expect(body.members.find((m: any) => m.id === "mem_mark").isVerifier).toBe(false);
  });
});

describe("GET /contact-rhythm/:seniorId", () => {
  it("is realistic: Danny Sundays ~4pm, Lisa midweek, Mark rarely", async () => {
    const { status, body } = await json(ctx, "GET", "/contact-rhythm/sen_rose");
    expect(status).toBe(200);
    expect(body.seniorId).toBe("sen_rose");
    const by = Object.fromEntries(body.perMember.map((p: any) => [p.memberId, p]));
    expect(Object.keys(by)).toEqual(["mem_lisa", "mem_danny", "mem_mark"]);
    for (const p of body.perMember) {
      expect(p.everAskedForMoney).toBe(false);
      expect(p.lastContactAt).toMatch(ISO);
      expect(typeof p.callsLast30d).toBe("number");
    }
    expect(by.mem_danny.usualPattern).toBe("Sundays ~4pm");
    // Danny called this past Sunday (Sep 27), ~4pm ET.
    expect(by.mem_danny.lastContactAt.slice(0, 10)).toBe("2026-09-27");
    expect(by.mem_danny.callsLast30d).toBeGreaterThanOrEqual(3);
    expect(by.mem_lisa.usualPattern).toMatch(/^Midweek, usually Wednesdays ~7pm$/);
    expect(by.mem_lisa.callsLast30d).toBeGreaterThanOrEqual(4);
    expect(by.mem_mark.usualPattern).toMatch(/once a month/i);
    expect(by.mem_mark.callsLast30d).toBeLessThanOrEqual(1);
  });
});

describe("scheduling endpoints (shape)", () => {
  it("request → respond → confirm → upcoming / pending", async () => {
    const req = await json(ctx, "POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior", includeDependents: true });
    expect(req.status).toBe(200);
    const p = req.body;
    expect(p.id).toMatch(/^prop_/);
    expect(p).toMatchObject({ seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior", status: "proposed", responses: [] });
    expect(p.memberIds).toEqual(["mem_lisa", "mem_danny", "mem_mark"]);
    expect(p.includesDependents).toEqual(["Mia"]);
    expect(p.slots).toHaveLength(3);
    for (const s of p.slots) {
      expect(s.id).toMatch(/^slot_/);
      expect(s.startUtc).toMatch(ISO);
      expect(s.endUtc).toMatch(ISO);
      expect(s.reason.length).toBeGreaterThan(10);
      expect(Object.keys(s.localTimes).sort()).toEqual(["mem_danny", "mem_lisa", "mem_mark", "sen_rose"]);
      expect(s.localTimes.sen_rose).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} (AM|PM)$/);
    }
    const slot = p.slots[0];
    let last: any;
    for (const m of p.memberIds) {
      last = await json(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId: m, slotId: slot.id, accept: true });
      expect(last.status).toBe(200);
    }
    expect(last.body.status).toBe("awaiting_senior");
    const pending = await json(ctx, "GET", "/proposals/sen_rose/pending-senior");
    expect(pending.body.map((x: any) => x.id)).toEqual([p.id]);

    const conf = await json(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: slot.id });
    expect(conf.status).toBe(200);
    expect(conf.body).toEqual({
      id: expect.stringMatching(/^sch_/), proposalId: p.id, seniorId: "sen_rose", memberIds: p.memberIds,
      startUtc: slot.startUtc, roomName: expect.stringMatching(/^cc-/), roomJoinUrl: expect.stringContaining("/call/"),
      seniorJoin: "phone_dialout", status: "scheduled",
    });
    const up = await json(ctx, "GET", "/schedule/sen_rose/upcoming");
    expect(up.body).toHaveLength(1);
    expect((await json(ctx, "GET", "/proposals/sen_rose/pending-senior")).body).toEqual([]);
  });

  it("validates bodies", async () => {
    expect((await json(ctx, "POST", "/schedule/request", { kind: "video_call" })).status).toBe(400);
    expect((await json(ctx, "POST", "/schedule/proposals/prop_nope/respond", { memberId: "mem_lisa", slotId: "x", accept: true })).status).toBe(404);
  });
});

describe("messages", () => {
  it("GET /messages requires a real member", async () => {
    expect((await json(ctx, "GET", "/messages?memberId=mem_lisa")).body).toEqual([]);
    expect((await json(ctx, "GET", "/messages?memberId=Mia")).status).toBe(404);
    expect((await json(ctx, "GET", "/messages")).status).toBe(400);
  });

  it("POST /messages/reply stores an inbound message", async () => {
    const r = await json(ctx, "POST", "/messages/reply", { fromMemberId: "mem_mark", body: "Lovely, thanks!" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: expect.stringMatching(/^msg_/), toMemberId: "mem_mark", fromMemberId: "mem_mark", direction: "in", kind: "text", body: "Lovely, thanks!" });
  });
});

describe("moments + webhooks", () => {
  it("GET /moments returns the contract keys", async () => {
    const r = await json(ctx, "GET", "/moments/sen_rose");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["addedItems", "calls", "gifts", "savedCents", "scamsStopped", "voiceNotes"]);
    expect(r.body.calls).toBeGreaterThanOrEqual(1);
    // Calendar week of Sep 21: Danny Sun 27, Lisa Wed 23 (+ maybe a lunch call).
    const wk = await json(ctx, "GET", "/moments/sen_rose?week=2026-09-23");
    expect(wk.body.calls).toBeGreaterThanOrEqual(2);
    expect((await json(ctx, "GET", "/moments/sen_rose?week=garbage")).status).toBe(400);
  });

  it("webhooks ack fast with 200 and reject garbage with 400", async () => {
    for (const path of ["call-ended", "order-paid", "fraud-hold", "fraud-resolved"]) {
      expect((await json(ctx, "POST", `/webhooks/${path}`, { nope: true })).status).toBe(400);
    }
    const r = await json(ctx, "POST", "/webhooks/call-ended", {
      callId: "call_1", seniorId: "sen_rose", kind: "inbound", startedAt: "2026-09-30T14:00:00Z", endedAt: "2026-09-30T14:10:00Z",
      transcript: [], privateSpans: [],
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});
