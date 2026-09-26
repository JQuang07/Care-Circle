import { beforeEach, describe, expect, it } from "vitest";
import type { Message, Proposal, ScheduledCall } from "../src/contracts-local.js";
import { json, makeCtx, type TestCtx } from "./helpers.js";

// D10 · who must accept a schedule proposal.
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeCtx(); });

async function request(body: Record<string, unknown> = {}): Promise<Proposal> {
  const r = await json<Proposal>(ctx, "POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior", ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

const respond = (p: Proposal, memberId: string, slotId: string, accept = true) =>
  json<Proposal>(ctx, "POST", `/schedule/proposals/${p.id}/respond`, { memberId, slotId, accept });

describe("D10: nobody named → everyone invited, 2 agreeing on a slot is enough", () => {
  it("Lisa + Danny accept, Mark never answers → awaiting_senior; Mark still gets the join link", async () => {
    const p = await request({ includeDependents: true });
    expect(p.memberIds.sort()).toEqual(["mem_danny", "mem_lisa", "mem_mark"]);
    const s = p.slots[0].id;

    expect((await respond(p, "mem_lisa", s)).body.status).toBe("proposed");
    expect((await respond(p, "mem_danny", s)).body.status).toBe("awaiting_senior");
    const pending = (await json<Proposal[]>(ctx, "GET", "/proposals/sen_rose/pending-senior")).body;
    expect(pending.map((x) => x.id)).toEqual([p.id]);

    const markInbox = (await json<Message[]>(ctx, "GET", "/messages?memberId=mem_mark")).body;
    expect(markInbox.some((m) => /Lisa and Danny are in for .*still invited/.test(m.body))).toBe(true);

    const sc = await json<ScheduledCall>(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: s });
    expect(sc.status).toBe(200);
    expect(sc.body.memberIds.sort()).toEqual(["mem_danny", "mem_lisa", "mem_mark"]);
    const join = (await json<Message[]>(ctx, "GET", "/messages?memberId=mem_mark")).body
      .flatMap((m) => m.actions ?? []).find((a) => a.payload?.scheduledCallId === sc.body.id);
    expect(join?.payload.url).toBe(`http://web.test/call/${sc.body.id}?member=mem_mark`);
  });

  it("one acceptance is not enough, and accepts on different slots don't combine", async () => {
    const p = await request();
    expect((await respond(p, "mem_lisa", p.slots[0].id)).body.status).toBe("proposed");
    expect((await respond(p, "mem_danny", p.slots[1].id)).body.status).toBe("proposed");
    const r = await json(ctx, "POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: p.slots[0].id });
    expect(r.status).toBe(409);
  });

  it("one decline doesn't sink a slot the other two agree on", async () => {
    const p = await request();
    const s = p.slots[0].id;
    await respond(p, "mem_mark", s, false);
    await respond(p, "mem_lisa", s);
    expect((await respond(p, "mem_danny", s)).body.status).toBe("awaiting_senior");
  });

  it("\"everyone\" counts as naming nobody", async () => {
    const p = await request({ memberIds: ["everyone"] });
    await respond(p, "mem_lisa", p.slots[0].id);
    expect((await respond(p, "mem_mark", p.slots[0].id)).body.status).toBe("awaiting_senior");
  });
});

describe("D10: named members → all of them must accept the same slot", () => {
  it("waits for every named member", async () => {
    const p = await request({ memberIds: ["mem_lisa", "mem_danny", "mem_mark"] });
    const s = p.slots[0].id;
    await respond(p, "mem_lisa", s);
    expect((await respond(p, "mem_danny", s)).body.status).toBe("proposed");
    expect((await respond(p, "mem_mark", s)).body.status).toBe("awaiting_senior");
  });

  it("names resolve too (\"Lisa\", \"Danny\")", async () => {
    const p = await request({ memberIds: ["Lisa", "Danny"] });
    expect(p.memberIds).toEqual(["mem_lisa", "mem_danny"]);
    await respond(p, "mem_lisa", p.slots[0].id);
    expect((await respond(p, "mem_danny", p.slots[0].id)).body.status).toBe("awaiting_senior");
  });
});
