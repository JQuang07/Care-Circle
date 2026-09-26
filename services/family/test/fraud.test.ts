import { beforeEach, describe, expect, it } from "vitest";
import type { ContactRhythm, Hold, Member, Message, Order } from "../src/contracts-local.js";
import { fakeMoney } from "../src/adapters/services.js";
import { json, makeCtx, type TestCtx } from "./helpers.js";

const SUMMARY = "Rose was asked for $500 in gift cards by someone claiming to be Danny, with 'don't tell your mom' language. Danny last called Sunday and has never asked for money. We paused it and called Danny.";

function scam(): { order: Order; hold: Hold } {
  const order: Order = {
    id: "ord_scam", seniorId: "sen_rose", status: "held", createdAt: "2026-09-29T15:00:00Z", holdId: "hold_scam",
    request: {
      seniorId: "sen_rose", type: "gift", payeeDescription: "Target gift cards", amountCents: 50000,
      items: [{ name: "Target gift card", qty: 5, priceCents: 10000 }],
      context: { transcriptExcerpt: "My grandson called, he's in trouble and needs $500 in gift cards. He said not to tell his mom.", claimedRelative: "my grandson", urgencyOrSecrecy: true },
    },
    fraud: {
      risk: "high", score: 95, hardStop: true, typology: "grandparent_impostor", recommendedAction: "hold", suggestedVerifierId: "mem_danny",
      signals: [{ layer: 1, code: "GIFT_CARD_NON_MEMBER", description: "Gift cards to a non-circle recipient", weight: 40 }],
      seniorFacingMessage: "This looks like a trick a lot of people get calls about. Let's check with Danny first.",
      familyFacingSummary: SUMMARY,
    },
  };
  const hold: Hold = { id: "hold_scam", orderId: "ord_scam", seniorId: "sen_rose", status: "open", createdAt: "2026-09-29T15:00:01Z", coolingOffUntil: "2026-09-30T15:00:01Z" };
  return { order, hold };
}

let ctx: TestCtx;
let money: ReturnType<typeof fakeMoney>;
beforeEach(async () => {
  const s = scam();
  money = fakeMoney({ holds: [structuredClone(s.hold)], orders: [structuredClone(s.order)] });
  ctx = await makeCtx({ money });
});

async function card(memberId: string): Promise<Message | undefined> {
  return (await json<Message[]>(ctx, "GET", `/messages?memberId=${memberId}`)).body.find((m) => m.kind === "fraud_card");
}

describe("fraud cards", () => {
  it("fraud-hold → a fraud_card to every verifier (Lisa, Danny), not Mark; idempotent", async () => {
    await json(ctx, "POST", "/webhooks/fraud-hold", scam());
    await json(ctx, "POST", "/webhooks/fraud-hold", scam());
    await ctx.app.flushJobs();
    for (const id of ["mem_lisa", "mem_danny"]) {
      const inbox = (await json<Message[]>(ctx, "GET", `/messages?memberId=${id}`)).body.filter((m) => m.kind === "fraud_card");
      expect(inbox).toHaveLength(1);
      expect(inbox[0].body).toContain(SUMMARY);
      expect(inbox[0].actions!.map((a) => a.label)).toEqual(["I'm calling her", "Cancel it", "Approve in app (passkey)"]);
    }
    expect((await card("mem_danny"))!.body).toMatch(/calling you now/); // suggested verifier
    expect(await card("mem_mark")).toBeUndefined();
  });

  it("buttons call Agent 2: cancel; approve needs a passkey; 'I'm calling her' tells the other verifier", async () => {
    await json(ctx, "POST", "/webhooks/fraud-hold", scam());
    await ctx.app.flushJobs();
    const lisa = (await card("mem_lisa"))!;

    const calling = await json(ctx, "POST", `/messages/${lisa.id}/act`, { action: "fraud_calling" });
    expect(calling.body).toEqual({ ok: true, dial: "+1555010000" });
    expect((await json<Message[]>(ctx, "GET", "/messages?memberId=mem_danny")).body.some((m) => /Lisa is calling Rose/.test(m.body))).toBe(true);

    const noKey = await json(ctx, "POST", `/messages/${lisa.id}/act`, { action: "fraud_approve_passkey" });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe("PASSKEY_REQUIRED");
    expect(money.resolutions).toEqual([]);

    const cancel = await json(ctx, "POST", `/messages/${lisa.id}/act`, { action: "fraud_cancel", payload: { holdId: "hold_OTHER" } });
    expect(cancel.status).toBe(200);
    expect(cancel.body.hold.status).toBe("cancelled");
    expect(money.resolutions).toEqual([{ holdId: "hold_scam", decision: "cancel", byMemberId: "mem_lisa", method: "passkey_web" }]);
  });

  it("approve with a passkey assertion releases via passkey_web", async () => {
    await json(ctx, "POST", "/webhooks/fraud-hold", scam());
    await ctx.app.flushJobs();
    const danny = (await card("mem_danny"))!;
    const r = await json(ctx, "POST", `/messages/${danny.id}/act`, { action: "fraud_approve_passkey", payload: { passkeyAssertion: { id: "cred1", sig: "abc" } } });
    expect(r.status).toBe(200);
    expect(money.resolutions[0]).toMatchObject({ decision: "release", method: "passkey_web", byMemberId: "mem_danny", passkeyAssertion: { id: "cred1", sig: "abc" } });
  });

  it("money errors surface with the contract error shape", async () => {
    money.holds.length = 0;
    await json(ctx, "POST", "/webhooks/fraud-hold", scam());
    await ctx.app.flushJobs();
    const r = await json(ctx, "POST", `/messages/${(await card("mem_lisa"))!.id}/act`, { action: "fraud_cancel" });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });

  it("fraud-resolved → all-clear to the whole circle + code-word practice (never the word); moments count it", async () => {
    const { order } = scam();
    money.holds[0].status = "cancelled";
    money.holds[0].resolution = { decision: "cancel", byMemberId: "mem_danny", method: "verbal_on_verification_call", at: "2026-09-30T14:00:00Z" };
    await json(ctx, "POST", "/webhooks/fraud-resolved", { order: { ...order, status: "cancelled" }, hold: money.holds[0] });
    await ctx.app.flushJobs();
    for (const id of ["mem_lisa", "mem_danny", "mem_mark"]) {
      const clear = (await json<Message[]>(ctx, "GET", `/messages?memberId=${id}`)).body.find((m) => /All clear/.test(m.body))!;
      expect(clear.body).toMatch(/stopped by Danny and nothing was paid/);
      expect(clear.body).toMatch(/family code word/);
      expect(clear.body).not.toMatch(/blue\s*heron/i);
    }
    const moments = (await json(ctx, "GET", "/moments/sen_rose")).body;
    expect(moments).toMatchObject({ scamsStopped: 1, savedCents: 50000 });
  });

  it("moments fall back to locally seen holds when money is down", async () => {
    const { order, hold } = scam();
    ctx.deps.money = { ...money, listHolds: async () => { throw new Error("down"); }, listOrders: async () => { throw new Error("down"); } };
    await json(ctx, "POST", "/webhooks/fraud-resolved", { order, hold: { ...hold, status: "cancelled" } });
    await ctx.app.flushJobs();
    expect((await json(ctx, "GET", "/moments/sen_rose")).body).toMatchObject({ scamsStopped: 1, savedCents: 50000 });
  });
});

/**
 * Agent 2's layer 4, exactly as specified in agent-2-money-fraud.md, fed by our real endpoints:
 * - claimed relative not in circle → +15
 * - in circle but everAskedForMoney false (and not mentioned anywhere) → +15 and suggestedVerifierId = that member
 * - otherwise suggestedVerifierId = most recently contacted verifier
 */
function layer4(claimed: string, circle: { members: Member[] }, rhythm: ContactRhythm) {
  const c = claimed.toLowerCase();
  const member = circle.members.find((m) => c.includes(m.name.toLowerCase()) || c.includes(m.relation.toLowerCase()));
  const verifiers = circle.members.filter((m) => m.isVerifier).map((m) => rhythm.perMember.find((p) => p.memberId === m.id)!);
  const mostRecent = [...verifiers].sort((a, b) => (b.lastContactAt ?? "").localeCompare(a.lastContactAt ?? ""))[0].memberId;
  if (!member) return { weight: 15, suggestedVerifierId: mostRecent, member: undefined };
  const pm = rhythm.perMember.find((p) => p.memberId === member.id)!;
  if (pm.everAskedForMoney === false) return { weight: 15, suggestedVerifierId: member.id, member: pm };
  return { weight: 0, suggestedVerifierId: mostRecent, member: pm };
}

describe("DoD: /contact-rhythm feeds Agent 2's layer 4 in the scam scenario", () => {
  it("'my grandson' → Danny: in circle, never asked for money, called Sunday → +15, verify with Danny", async () => {
    // Tuesday after a Sunday call: "Danny talks to Rose every Sunday and called 2 days ago."
    ctx = await makeCtx({ now: "2026-09-29T15:00:00Z" });
    const circle = (await json(ctx, "GET", "/circle/sen_rose")).body;
    const rhythm = (await json<ContactRhythm>(ctx, "GET", "/contact-rhythm/sen_rose")).body;
    const res = layer4("my grandson", circle, rhythm);
    expect(res).toMatchObject({ weight: 15, suggestedVerifierId: "mem_danny" });
    expect(res.member!.usualPattern).toBe("Sundays ~4pm");
    const daysAgo = (Date.parse("2026-09-29T15:00:00Z") - Date.parse(res.member!.lastContactAt!)) / 86_400_000;
    expect(daysAgo).toBeGreaterThan(1.5);
    expect(daysAgo).toBeLessThan(2.5);
    expect(rhythm.perMember.every((p) => p.everAskedForMoney === false)).toBe(true);
    // The fraud_card copy Agent 2 would write is truthful against our data.
    expect(SUMMARY).toMatch(/Danny last called Sunday/);
    expect(new Date(res.member!.lastContactAt!).getUTCDay()).toBe(0);
  });

  it("stranger ('a man named Kevin') → not in circle → +15, verifier = most recently contacted", async () => {
    ctx = await makeCtx({ now: "2026-09-29T15:00:00Z" });
    const circle = (await json(ctx, "GET", "/circle/sen_rose")).body;
    const rhythm = (await json<ContactRhythm>(ctx, "GET", "/contact-rhythm/sen_rose")).body;
    const res = layer4("a man named Kevin", circle, rhythm);
    expect(res.weight).toBe(15);
    expect(res.suggestedVerifierId).toBe("mem_danny"); // Danny (Sun) is more recent than Lisa (Wed)
  });
});
