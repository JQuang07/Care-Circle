import { beforeEach, describe, expect, it } from "vitest";
import type { CallEnded, Message, Order } from "../src/contracts-local.js";
import { scriptedMuse } from "../src/adapters/muse.js";
import { runPostCallPipeline } from "../src/domain/hooks.js";
import { leaksPrivate, stripPrivate } from "../src/domain/privacy.js";
import { hasGuilt } from "../src/domain/safety.js";
import { tick } from "../src/domain/jobs.js";
import { json, makeCtx, NOW, type TestCtx } from "./helpers.js";

const t = (sec: number) => new Date(Date.parse("2026-09-30T14:00:00Z") + sec * 1000).toISOString();

/** Rose's call: tomatoes + Buddy are public; the pawned ring is "between us"; a pill detail must be dropped. */
function roseCall(overrides: Partial<CallEnded> = {}): CallEnded {
  return {
    callId: "call_test_1", seniorId: "sen_rose", kind: "inbound",
    startedAt: t(0), endedAt: t(300),
    transcript: [
      { speaker: "agent", text: "Hi Rose! How's your week going?", ts: t(1) },
      { speaker: "senior", text: "Oh wonderful. My tomatoes came in, the ones we planted in May!", ts: t(10) },
      { speaker: "senior", text: "I'm worried about Buddy's vet visit on Friday.", ts: t(20) },
      { speaker: "senior", text: "Keep this between us, okay?", ts: t(30) },
      { speaker: "senior", text: "I pawned grandpa's sapphire ring at Goldman's to cover the roof.", ts: t(35) },
      { speaker: "agent", text: "Of course, that stays between us.", ts: t(40) },
      { speaker: "senior", text: "The new blood pressure pills make me dizzy.", ts: t(50) },
      { speaker: "senior", text: "Lisa never listens to me anyway, she's always too busy.", ts: t(60) },
      { speaker: "senior", text: "Anyway, I baked a peach pie for the church sale!", ts: t(70) },
    ],
    privateSpans: [{ startTs: t(29), endTs: t(41) }],
    ...overrides,
  };
}

const PRIVATE_WORDS = /\bpawn|sapphire|goldman|\broof\b|grandpa's ring|\bthe ring\b/i;

async function allMessages(ctx: TestCtx): Promise<Message[]> {
  return ctx.deps.store.messages.list();
}

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeCtx(); });

describe("privacy", () => {
  it("stripPrivate removes span turns and fails closed on bad timestamps", () => {
    const s = stripPrivate(roseCall());
    expect(s.publicTurns.map((x) => x.text).join(" ")).not.toMatch(PRIVATE_WORDS);
    expect(s.privateTurns).toHaveLength(3);
    const bad = stripPrivate({ transcript: [{ speaker: "senior", text: "secret", ts: "not-a-date" }], privateSpans: [{ startTs: t(0), endTs: t(1) }] });
    expect(bad.publicTurns).toHaveLength(0);
  });

  it("catches 'keep this between us' even when the voice agent missed the span", () => {
    const s = stripPrivate(roseCall({ privateSpans: [] }));
    expect(s.publicTurns.map((x) => x.text).join(" ")).not.toMatch(PRIVATE_WORDS);
  });

  it("leaksPrivate flags echoes of private content", () => {
    const s = stripPrivate(roseCall());
    expect(leaksPrivate("She mentioned grandpa's sapphire ring", s)).toBe(true);
    expect(leaksPrivate("Her tomatoes came in", s)).toBe(false);
  });

  it("DoD: a private span never reaches Muse, a hook, a nudge, or a briefing", async () => {
    // A hostile model that tries to leak everything it can.
    const muse = scriptedMuse((req) => req.name === "extract_hooks" ? {
      hooks: [
        { text: "She pawned grandpa's sapphire ring", forMemberId: "mem_lisa", nudgeText: "Ask about the ring at Goldman's!" },
        { text: "Her tomatoes came in", forMemberId: "mem_danny", nudgeText: "Rose's tomatoes came in, and she mentioned the roof and a ring. Call her!" },
      ],
    } : null);
    ctx = await makeCtx({ muse });
    const res = await runPostCallPipeline(ctx.deps, roseCall());

    // 1. The model never saw private text.
    expect(muse.calls).toHaveLength(1);
    expect(muse.calls[0].user).not.toMatch(PRIVATE_WORDS);
    // 2. Hooks + nudges are clean (the leaky hook is dropped, the leaky nudge replaced).
    expect(res.hooks.map((h) => h.text)).toEqual(["Her tomatoes came in"]);
    for (const h of res.hooks) expect(`${h.text} ${h.nudgeText}`).not.toMatch(PRIVATE_WORDS);
    // 3. Briefings built later from these hooks are clean too.
    const p = await json(ctx, "POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior" });
    const slot = p.body.slots[0];
    for (const m of p.body.memberIds) await json(ctx, "POST", `/schedule/proposals/${p.body.id}/respond`, { memberId: m, slotId: slot.id, accept: true });
    await json(ctx, "POST", `/schedule/proposals/${p.body.id}/confirm-senior`, { slotId: slot.id });
    ctx.clock.travelTo(new Date(Date.parse(slot.startUtc) - 59 * 60_000));
    await tick(ctx.deps);
    const msgs = await allMessages(ctx);
    expect(msgs.filter((m) => m.kind === "briefing")).toHaveLength(3);
    for (const m of msgs) expect(m.body).not.toMatch(PRIVATE_WORDS);
  });
});

describe("family code word", () => {
  it("is never written into a hook or an outbound message", async () => {
    const muse = scriptedMuse(() => ({
      hooks: [
        { text: "She saw a Blue Heron at the pond", forMemberId: "mem_mark", nudgeText: "Rose saw a blue heron! Call her?" },
        { text: "Her tomatoes came in", forMemberId: "mem_danny", nudgeText: "Rose's tomatoes came in. Remember, the code word is blue heron. Call her?" },
      ],
    }));
    ctx = await makeCtx({ muse });
    const res = await runPostCallPipeline(ctx.deps, roseCall());
    expect(res.hooks.map((h) => h.text)).toEqual(["Her tomatoes came in"]);
    for (const m of await ctx.deps.store.messages.list()) expect(m.body).not.toMatch(/blue\s+heron/i);
  });

  it("the all-clear reminds about the practice without saying the word", async () => {
    const { redactCodeWord, containsCodeWord } = await import("../src/domain/codeword.js");
    expect(containsCodeWord("the BLUE heron's nest")).toBe(true);
    expect(containsCodeWord("a blue bird and a grey heron")).toBe(false);
    expect(redactCodeWord("say blue heron now")).toBe("say [family code word] now");
  });
});

describe("hook extraction (fallback, Muse off)", () => {
  it("extracts specific hooks, drops health + family complaints, routes by relationship", async () => {
    const res = await runPostCallPipeline(ctx.deps, roseCall());
    const texts = res.hooks.map((h) => h.text);
    expect(texts.some((x) => /tomatoes came in/i.test(x))).toBe(true);
    expect(texts.some((x) => /worried about Buddy's vet visit/i.test(x))).toBe(true);
    for (const x of texts) {
      expect(x).not.toMatch(/pill|dizzy|blood pressure/i);
      expect(x).not.toMatch(/never listens|too busy/i);
      expect(x).not.toMatch(PRIVATE_WORDS);
    }
    const tomato = res.hooks.find((h) => /tomato/i.test(h.text))!;
    expect(tomato.forMemberId).toBe("mem_danny"); // Danny helped plant the tomatoes
    expect(tomato.text).toMatch(/^Her tomatoes came in/);
    const buddy = res.hooks.find((h) => /Buddy/.test(h.text))!;
    expect(buddy.forMemberId).toBe("mem_lisa");
    for (const h of res.hooks) {
      expect(h.id).toMatch(/^hook_/);
      expect(hasGuilt(h.nudgeText)).toBe(false);
      expect(h.nudgeText).toMatch(/call/i);
    }
  });

  it("skips verification calls entirely", async () => {
    const res = await runPostCallPipeline(ctx.deps, roseCall({ kind: "verification" }));
    expect(res.hooks).toEqual([]);
  });
});

describe("nudges", () => {
  it("replaces guilt-trip nudges from the model", async () => {
    const muse = scriptedMuse(() => ({
      hooks: [{ text: "Her tomatoes came in", forMemberId: "mem_danny", nudgeText: "You haven't called Grandma in weeks. She's lonely!" }],
    }));
    ctx = await makeCtx({ muse });
    const res = await runPostCallPipeline(ctx.deps, roseCall());
    expect(res.hooks[0].nudgeText).not.toMatch(/haven't called|weeks|lonely/i);
    expect(res.hooks[0].nudgeText).toMatch(/tomatoes came in/);
  });

  it("drops model hooks about health or aimed at non-members", async () => {
    const muse = scriptedMuse(() => ({
      hooks: [
        { text: "Her new pills make her dizzy", forMemberId: "mem_lisa", nudgeText: "Ask about her pills" },
        { text: "Her tomatoes came in", forMemberId: "Mia", nudgeText: "Tell Mia!" },
        { text: "She baked a peach pie for the church sale", forMemberId: "mem_lisa", nudgeText: "Rose baked a peach pie for the church sale. Give her a call and hear how it went?" },
      ],
    }));
    ctx = await makeCtx({ muse });
    const res = await runPostCallPipeline(ctx.deps, roseCall());
    expect(res.hooks.map((h) => h.text)).toEqual(["She baked a peach pie for the church sale"]);
    expect(res.dropped).toBe(2);
  });

  it("rate limit: at most 1 nudge per member per local day", async () => {
    const r1 = await runPostCallPipeline(ctx.deps, roseCall());
    const r2 = await runPostCallPipeline(ctx.deps, roseCall({ callId: "call_test_2" }));
    expect(r1.nudgesSent).toBeGreaterThan(0);
    expect(r2.nudgesSent).toBe(0);
    for (const id of ["mem_lisa", "mem_danny", "mem_mark"]) {
      const nudges = (await ctx.deps.store.messages.list({ toMemberId: id, kind: "nudge" }));
      expect(nudges.length).toBeLessThanOrEqual(1);
    }
    // Next day (member-local), nudges flow again.
    ctx.clock.advance(24 * 3600_000);
    const r3 = await runPostCallPipeline(ctx.deps, roseCall({ callId: "call_test_3" }));
    expect(r3.nudgesSent).toBeGreaterThan(0);
  });

  it("webhook path: call-ended → nudges land in the WhatsApp inbox", async () => {
    expect((await json(ctx, "POST", "/webhooks/call-ended", roseCall())).status).toBe(200);
    await ctx.app.flushJobs();
    const danny = await json<Message[]>(ctx, "GET", "/messages?memberId=mem_danny");
    const nudge = danny.body.find((m) => m.kind === "nudge")!;
    expect(nudge.body).toMatch(/tomatoes/);
    expect(nudge.actions?.map((a) => a.action)).toEqual(["call_senior", "schedule_request"]);
  });
});

function groceryOrder(id = "ord_g1"): Order {
  return {
    id, seniorId: "sen_rose", status: "paid", createdAt: NOW, receiptUrl: "https://receipts.test/ord_g1",
    request: {
      seniorId: "sen_rose", type: "groceries", merchantId: "mer_freshmart", amountCents: 4218,
      items: [{ name: "Milk", qty: 1 }, { name: "Eggs", qty: 1 }, { name: "Bread", qty: 1 }, { name: "Peaches", qty: 4 }],
      context: { transcriptExcerpt: "Could you order my usual groceries?" },
    },
    fraud: { risk: "low", score: 3, hardStop: false, signals: [], recommendedAction: "proceed", seniorFacingMessage: "", familyFacingSummary: "" },
  };
}

describe("order-paid → connection", () => {
  it("groceries → add_to_order to every member (coming-soon add, voice note), receipts to funders; idempotent", async () => {
    await json(ctx, "POST", "/webhooks/order-paid", groceryOrder());
    await json(ctx, "POST", "/webhooks/order-paid", groceryOrder()); // retry
    await ctx.app.flushJobs();
    for (const id of ["mem_lisa", "mem_danny", "mem_mark"]) {
      const inbox = (await json<Message[]>(ctx, "GET", `/messages?memberId=${id}`)).body;
      const add = inbox.filter((m) => m.kind === "add_to_order");
      expect(add).toHaveLength(1);
      expect(add[0].body).toMatch(/FreshMart/);
      expect(add[0].actions).toEqual([
        { label: "Add something (coming soon)", action: "add_item", payload: { orderId: "ord_g1", comingSoon: true } },
        { label: "Record a voice note for delivery", action: "record_voice_note", payload: { orderId: "ord_g1" } },
      ]);
    }
    const lisaReceipts = (await ctx.deps.store.messages.list({ toMemberId: "mem_lisa", kind: "receipt" }));
    expect(lisaReceipts).toHaveLength(1);
    expect(lisaReceipts[0]).toMatchObject({ mediaUrl: "https://receipts.test/ord_g1" });
    expect(lisaReceipts[0].body).toMatch(/\$42\.18/);
    expect(await ctx.deps.store.messages.list({ toMemberId: "mem_danny", kind: "receipt" })).toHaveLength(0);
  });

  it("'Add something' says coming soon; voice notes are stored against the order", async () => {
    await json(ctx, "POST", "/webhooks/order-paid", groceryOrder());
    await ctx.app.flushJobs();
    const msg = (await ctx.deps.store.messages.list({ toMemberId: "mem_lisa", kind: "add_to_order" }))[0];
    const add = await json(ctx, "POST", `/messages/${msg.id}/act`, { action: "add_item" });
    expect(add.body).toMatchObject({ ok: false, comingSoon: true });

    const noUrl = await json(ctx, "POST", `/messages/${msg.id}/act`, { action: "record_voice_note" });
    expect(noUrl.body).toMatchObject({ ok: true, next: "record", orderId: "ord_g1" });
    const rec = await json(ctx, "POST", `/messages/${msg.id}/act`, { action: "record_voice_note", payload: { voiceNoteUrl: "https://vn.test/lisa.webm", orderId: "ord_HIJACK" } });
    expect(rec.status).toBe(200);
    expect(rec.body.voiceNote).toMatchObject({ orderId: "ord_g1", memberId: "mem_lisa", url: "https://vn.test/lisa.webm" });

    // Danny sends his as a reply instead of a button.
    await json(ctx, "POST", "/messages/reply", { fromMemberId: "mem_danny", voiceNoteUrl: "https://vn.test/danny.webm" });
    const notes = await json(ctx, "GET", "/orders/ord_g1/voice-notes");
    expect(notes.body.map((n: any) => [n.memberName, n.url])).toEqual([["Lisa", "https://vn.test/lisa.webm"], ["Danny", "https://vn.test/danny.webm"]]);
    expect((await json(ctx, "GET", "/moments/sen_rose")).body.voiceNotes).toBe(2);
  });

  it("gift orders count as moments", async () => {
    const gift = groceryOrder("ord_gift");
    gift.request.type = "gift";
    gift.request.recipientMemberId = "mem_lisa";
    await json(ctx, "POST", "/webhooks/order-paid", gift);
    await ctx.app.flushJobs();
    expect((await json(ctx, "GET", "/moments/sen_rose")).body.gifts).toBe(1);
    expect(await ctx.deps.store.messages.list({ kind: "add_to_order" })).toHaveLength(0);
  });
});

describe("messages API", () => {
  it("rejects unknown actions and actions not on the message", async () => {
    await json(ctx, "POST", "/webhooks/order-paid", groceryOrder());
    await ctx.app.flushJobs();
    const msg = (await ctx.deps.store.messages.list({ toMemberId: "mem_lisa", kind: "add_to_order" }))[0];
    expect((await json(ctx, "POST", `/messages/${msg.id}/act`, { action: "fraud_cancel", payload: { holdId: "hold_x" } })).status).toBe(400);
    expect((await json(ctx, "POST", `/messages/msg_nope/act`, { action: "add_item" })).status).toBe(404);
  });

  it("reply: 'set up a call with Mom' becomes a member-initiated proposal", async () => {
    const r = await json(ctx, "POST", "/messages/reply", { fromMemberId: "mem_lisa", body: "Can you set up a call with Mom this weekend? Mia wants to show her the drawing." });
    expect(r.status).toBe(200);
    const proposals = await ctx.deps.store.proposals.list({ seniorId: "sen_rose" });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ initiatedBy: "member", memberIds: ["mem_lisa"], includesDependents: ["Mia"] });
    const inbox = (await json<Message[]>(ctx, "GET", "/messages?memberId=mem_lisa")).body;
    expect(inbox.map((m) => m.kind)).toEqual(["text", "schedule_proposal"]);
  });
});
