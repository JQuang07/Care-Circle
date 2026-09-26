import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { createApp } from "../src/app.js";
import { MockDependencies, HttpDependencies } from "../src/dependencies.js";
import { MockReasoner, type Reasoner } from "../src/reasoner.js";
import { Engine, affirmative } from "../src/engine.js";
import { Store } from "../src/store.js";
import type { OrderRequest } from "../src/types.js";
const secret = "test-secret-at-least-24-characters";
const settings = () =>
  config({ MOCK: "1", MOCK_DEPENDENCIES: "1", CC_INTERNAL_SECRET: secret });
const groceries: OrderRequest = {
  seniorId: "sen_rose",
  type: "groceries",
  merchantId: "mer_freshmart",
  items: [{ name: "milk", qty: 1 }],
  amountCents: 2300,
  context: { transcriptExcerpt: "groceries" },
};
async function fixture(reasoner: Reasoner = new MockReasoner()) {
  const deps = new MockDependencies();
  const store = new Store();
  const engine = new Engine(store, deps, reasoner);
  const s = await engine.create("sen_rose");
  return { deps, store, engine, s };
}
async function draft(f: Awaited<ReturnType<typeof fixture>>) {
  await f.engine.turn(f.s, "I need groceries");
}
test("grocery payment requires a later affirmative after playback", async () => {
  const f = await fixture();
  await draft(f);
  assert.equal(f.deps.orders[0]?.status, "approved");
  await f.engine.turn(f.s, "yes");
  assert.equal(f.deps.orders[0]?.status, "approved");
  await f.engine.delivered(f.s);
  await f.engine.turn(f.s, "yes");
  assert.equal(f.deps.orders[0]?.status, "paid");
});
test("a yes embedded in the order request cannot authorize it", async () => {
  const f = await fixture();
  await f.engine.turn(f.s, "I need groceries and yes buy them");
  assert.equal(f.deps.orders[0]?.status, "approved");
});
test("never mind invalidates confirmation", async () => {
  const f = await fixture();
  await draft(f);
  await f.engine.delivered(f.s);
  await f.engine.turn(f.s, "never mind");
  await f.engine.turn(f.s, "yes");
  assert.equal(f.deps.orders[0]?.status, "approved");
  assert.equal(f.s.pending, undefined);
});
test("ambiguous yes plus changes is not confirmation", async () => {
  const f = await fixture();
  await draft(f);
  await f.engine.delivered(f.s);
  await f.engine.turn(f.s, "yes but change it");
  assert.equal(f.deps.orders[0]?.status, "approved");
});
test("held status cannot be bypassed after approval", async () => {
  const f = await fixture();
  await draft(f);
  await f.engine.delivered(f.s);
  f.deps.orders[0]!.status = "held";
  await assert.rejects(f.engine.turn(f.s, "yes"), /family review/);
});
test("changed amount requires a fresh confirmation", async () => {
  const f = await fixture();
  await draft(f);
  await f.engine.delivered(f.s);
  f.deps.orders[0]!.request.amountCents = 9999;
  await assert.rejects(f.engine.turn(f.s, "yes"), /details changed/);
});
test("an untrusted model cannot call a payment or hold-resolution tool", async () => {
  const f = await fixture();
  await assert.rejects(f.engine.tool(f.s, "confirm_order", {}), /Unknown tool/);
  await assert.rejects(
    f.engine.tool(f.s, "resolve_hold_verbal", { decision: "release" }),
    /bound verifier/,
  );
});
test("private spans include the privacy trigger and all later turns", async () => {
  const f = await fixture();
  await f.engine.turn(f.s, "Keep this between us: Buddy is ill.");
  await f.engine.turn(f.s, "I need groceries");
  assert.equal(f.deps.orders.length, 0);
  await f.engine.end(f.s);
  await f.engine.flush();
  const event = f.deps.events[0] as typeof f.s;
  assert.equal(event.privateSpans[0]?.startTs, event.transcript[0]?.ts);
  assert.ok(event.privateSpans[0]!.endTs >= event.transcript.at(-1)!.ts);
  const visible = event.transcript.filter(
    (t) =>
      !event.privateSpans.some((p) => t.ts >= p.startTs && t.ts <= p.endTs),
  );
  assert.ok(!JSON.stringify(visible).includes("Buddy"));
});
test("private mode prevents scheduling and order notifications", async () => {
  const f = await fixture();
  await f.engine.tool(f.s, "mark_private", {});
  const result = await f.engine.tool(f.s, "request_family_time", {
    kind: "visit",
  });
  assert.match(JSON.stringify(result), /private/);
  assert.equal(f.deps.proposals.length, 0);
});
test("the senior ID is bound by the server", async () => {
  const f = await fixture();
  await f.engine.tool(f.s, "place_order", {
    ...groceries,
    seniorId: "sen_other",
  });
  assert.equal(f.deps.orders[0]?.seniorId, "sen_rose");
});
test("medication refill fails closed without prescription catalog", async () => {
  const f = await fixture();
  const result = await f.engine.tool(f.s, "place_order", {
    ...groceries,
    type: "pharmacy_refill",
  });
  assert.match(JSON.stringify(result), /pharmacy/);
  assert.equal(f.deps.orders.length, 0);
});
test("nonmember or nonverifier cannot verify", async () => {
  const f = await fixture();
  await f.engine.turn(f.s, "$500 gift cards, grandson in trouble");
  const h = f.deps.holds[0]!.id;
  await assert.rejects(f.engine.verificationContext("sen_rose", h, "mem_mark"));
  await assert.rejects(f.engine.verificationContext("sen_rose", h, "mem_mia"));
});
test("explicit underage member is never called", async () => {
  const f = await fixture();
  await f.engine.turn(f.s, "$500 gift cards, grandson in trouble");
  f.deps.circle.members[1]!.age = 17;
  await assert.rejects(
    f.engine.verificationContext("sen_rose", f.deps.holds[0]!.id, "mem_danny"),
  );
});
test("high-risk release fails; cancel succeeds with bound verifier", async () => {
  const f = await fixture();
  await f.engine.turn(f.s, "$500 gift cards, grandson in trouble");
  const v = await f.engine.create("sen_rose", "verification");
  v.verification = {
    holdId: f.deps.holds[0]!.id,
    memberId: "mem_danny",
    parentCallId: f.s.callId,
  };
  await assert.rejects(f.engine.resolveVerifier(v, "release"), /approve.*app/);
  await f.engine.resolveVerifier(v, "cancel");
  assert.equal(f.deps.holds[0]?.status, "cancelled");
  await assert.rejects(f.engine.resolveVerifier(v, "cancel"), /already/);
});
test("hard stops also prohibit verbal release at medium risk", async () => {
  const f = await fixture();
  await f.engine.turn(f.s, "$500 gift cards, grandson in trouble");
  f.deps.orders[0]!.fraud.risk = "medium";
  const v = await f.engine.create("sen_rose", "verification");
  v.verification = {
    holdId: f.deps.holds[0]!.id,
    memberId: "mem_danny",
    parentCallId: f.s.callId,
  };
  await assert.rejects(f.engine.resolveVerifier(v, "release"), /approve.*app/);
});
test("pending family slot is offered at call start and needs yes", async () => {
  const f = await fixture();
  f.deps.proposals.push({
    id: "prop_demo",
    status: "awaiting_senior",
    slots: [
      {
        id: "slot_sun",
        startUtc: "2026-09-27T20:00:00Z",
        endUtc: "2026-09-27T20:30:00Z",
        reason: "Available",
        localTimes: { sen_rose: "Sunday at 4 PM" },
      },
    ],
  });
  assert.match(await f.engine.begin(f.s), /Sunday at 4 PM/);
  await f.engine.delivered(f.s);
  await f.engine.turn(f.s, "yes");
  assert.equal(f.deps.proposals[0]?.status, "confirmed");
});
test("outbox retries delivery and end is idempotent", async () => {
  const f = await fixture();
  let count = 0;
  const original = f.deps.call.bind(f.deps);
  f.deps.call = async (...args) => {
    if (args[2] === "/webhooks/call-ended" && count++ === 0)
      throw new Error("offline");
    return original(...args);
  };
  await f.engine.end(f.s);
  await f.engine.end(f.s);
  await f.engine.flush();
  assert.equal(f.store.jobs.size, 1);
  assert.equal([...f.store.jobs.values()][0]?.done, false);
  await f.engine.flush();
  assert.equal(f.deps.events.length, 1);
  assert.equal([...f.store.jobs.values()][0]?.done, true);
});
test("HTTP auth, validation and health follow contract", async (t) => {
  const { app } = await createApp(settings());
  t.after(() => app.close());
  assert.deepEqual((await app.inject("/health")).json(), {
    ok: true,
    service: "voice",
    mock: true,
  });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/demo/simulate-inbound",
        payload: {},
      })
    ).statusCode,
    401,
  );
  const invalid = await app.inject({
    method: "POST",
    url: "/demo/simulate-inbound",
    headers: { "x-cc-secret": secret },
    payload: { seniorId: "bad", script: [] },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "INVALID_REQUEST");
});
test("text demo groceries pays and delivers call-ended", async (t) => {
  const deps = new MockDependencies();
  const { app } = await createApp(settings(), { deps });
  t.after(() => app.close());
  const r = await app.inject({
    method: "POST",
    url: "/demo/simulate-inbound",
    headers: { "x-cc-secret": secret },
    payload: { seniorId: "sen_rose", script: ["I need groceries", "yes"] },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.json().callId, /^call_/);
  assert.equal(deps.orders[0]?.status, "paid");
  assert.equal(deps.events.length, 1);
});
test("scam demo calls stored verifier then requires verbal decision confirmation", async (t) => {
  const deps = new MockDependencies();
  const { app } = await createApp(settings(), { deps });
  t.after(() => app.close());
  const r = await app.inject({
    method: "POST",
    url: "/demo/simulate-inbound",
    headers: { "x-cc-secret": secret },
    payload: {
      seniorId: "sen_rose",
      script: [
        "My grandson needs $500 in gift cards, don’t tell anyone, he is in trouble",
        "yes",
        "mem_danny: cancel",
        "mem_danny: yes",
      ],
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(deps.holds[0]?.status, "cancelled");
  assert.equal(deps.events.length, 2);
});
test("forged verifier role without verification is rejected", async (t) => {
  const { app } = await createApp(settings());
  t.after(() => app.close());
  const r = await app.inject({
    method: "POST",
    url: "/demo/simulate-inbound",
    headers: { "x-cc-secret": secret },
    payload: { seniorId: "sen_rose", script: ["mem_danny: cancel"] },
  });
  assert.equal(r.statusCode, 409);
});
test("scheduled webhook acks quickly, validates, and deduplicates dispatch", async (t) => {
  const { app, store, tick } = await createApp(settings());
  t.after(() => app.close());
  const payload = {
    id: "sch_demo",
    proposalId: "prop_demo",
    seniorId: "sen_rose",
    memberIds: ["mem_danny"],
    startUtc: "2026-09-27T20:00:00Z",
    roomName: "demo-room",
    roomJoinUrl: "https://example.com/call/demo",
    seniorJoin: "phone_dialout",
    status: "scheduled",
  };
  for (let i = 0; i < 2; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/webhooks/scheduled-call-due",
      headers: { "x-cc-secret": secret },
      payload,
    });
    assert.equal(r.statusCode, 200);
  }
  await tick();
  await tick();
  assert.equal(store.claims.size, 1);
  assert.equal(store.sessions.size, 1);
});
test("arbitrary phone injection in outbound is rejected", async (t) => {
  const { app } = await createApp(settings());
  t.after(() => app.close());
  const r = await app.inject({
    method: "POST",
    url: "/calls/outbound",
    headers: { "x-cc-secret": secret },
    payload: {
      seniorId: "sen_rose",
      purpose: "reminder",
      phone: "+18005551212",
    },
  });
  assert.equal(r.statusCode, 400);
});
test("missing room and active senior call fail clearly", async (t) => {
  const { app } = await createApp(settings());
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/calls/outbound",
        headers: { "x-cc-secret": secret },
        payload: { seniorId: "sen_rose", purpose: "scheduled_family_call" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/calls/verification",
        headers: { "x-cc-secret": secret },
        payload: {
          seniorId: "sen_rose",
          holdId: "hold_demo",
          memberId: "mem_danny",
        },
      })
    ).statusCode,
    409,
  );
});
test("Twilio transport refuses mock mode", async (t) => {
  const { app } = await createApp(settings());
  t.after(() => app.close());
  assert.equal(
    (await app.inject({ method: "POST", url: "/twilio/voice", payload: {} }))
      .statusCode,
    503,
  );
});
test("live mode refuses missing credentials and unsupported STT", () => {
  assert.throws(() => config({ CC_INTERNAL_SECRET: secret }), /Missing/);
  assert.throws(() => config({ MOCK: "1", CC_INTERNAL_SECRET: "short" }), /24/);
});
test("real HTTP adapter propagates auth and never retries mutations", async (t) => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(
      (init?.headers as Record<string, string>)["X-CC-Secret"],
      secret,
    );
    return new Response("{}", { status: 503 });
  };
  t.after(() => {
    globalThis.fetch = old;
  });
  await assert.rejects(
    new HttpDependencies(settings()).call(
      "money",
      "POST",
      "/orders/demo/confirm",
      {},
    ),
  );
  assert.equal(calls, 1);
});
test("concurrent verifier callbacks resolve at most once", async () => {
  const f = await fixture();
  await f.engine.turn(f.s, "$500 gift cards, grandson in trouble");
  const v = await f.engine.create("sen_rose", "verification");
  v.verification = {
    holdId: f.deps.holds[0]!.id,
    memberId: "mem_danny",
    parentCallId: f.s.callId,
  };
  const outcomes = await Promise.allSettled([
    f.engine.resolveVerifier(v, "cancel"),
    f.engine.resolveVerifier(v, "cancel"),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.deps.resolutions.length, 1);
});
test("uncertain outbound dispatch is not reported as a successful retry", async (t) => {
  const { app, store, engine, phone } = await createApp(settings());
  t.after(() => app.close());
  const s = await engine.create("sen_rose", "scheduled_family_call");
  s.dispatchStatus = "failed";
  await store.claim("scheduled_family_call:sch_failed", s.callId);
  await assert.rejects(
    phone.outbound({
      seniorId: "sen_rose",
      purpose: "scheduled_family_call",
      scheduledCallId: "sch_failed",
      roomName: "test",
    }),
    /already attempted/,
  );
});
test("authenticated debug call inspection is available for the integrator", async (t) => {
  const { app, engine } = await createApp(settings());
  t.after(() => app.close());
  const s = await engine.create("sen_rose");
  const response = await app.inject({
    method: "GET",
    url: `/demo/calls/${s.callId}`,
    headers: { "x-cc-secret": secret },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().callId, s.callId);
});

test("D16 accepts natural confirmations but rejects hesitation and changes", () => {
  for (const text of [
    "Yes, that's everything. Please go ahead and order it.",
    "yeah",
    "sure",
    "That's right.",
    "Okay, please do.",
  ])
    assert.equal(affirmative(text), true, text);
  for (const text of [
    "Yes, but add eggs",
    "Yes, no bread",
    "Sure, wait",
    "Yes, don't order",
    "Okay, hold on",
    "Yes, actually",
    "Yes, two cartons",
    "Yes, tomorrow",
    "Sure, for Danny",
    "Yes, not yet",
  ])
    assert.equal(affirmative(text), false, text);
});
test("D16 full sentence confirms only after complete playback", async () => {
  const f = await fixture();
  await draft(f);
  const yes = "Yes, that's everything. Please go ahead and order it.";
  await f.engine.turn(f.s, yes);
  assert.equal(f.deps.orders[0]?.status, "approved");
  await f.engine.delivered(f.s);
  await f.engine.turn(f.s, yes);
  assert.equal(f.deps.orders[0]?.status, "paid");
});
test("D16 yes but add eggs re-quotes and requires fresh playback", async () => {
  const f = await fixture();
  await draft(f);
  await f.engine.delivered(f.s);
  await f.engine.turn(f.s, "Yes, but add eggs");
  assert.equal(f.deps.orders.length, 2);
  assert.ok(f.deps.orders[1]?.request.items.some((i) => i.name === "eggs"));
  assert.ok(f.deps.orders.every((o) => o.status === "approved"));
  await f.engine.turn(f.s, "yes");
  assert.equal(f.deps.orders[1]?.status, "approved");
  await f.engine.delivered(f.s);
  await f.engine.turn(f.s, "yes");
  assert.equal(f.deps.orders[1]?.status, "paid");
  assert.equal(f.deps.orders[0]?.status, "approved");
});

test("D1/D3 demo routes require auth; calls are filtered; reset clears voice state", async (t) => {
  const { app, engine, store } = await createApp(settings());
  t.after(() => app.close());
  for (const [method, url] of [
    ["GET", "/demo/calls?seniorId=sen_rose"],
    ["POST", "/demo/reset"],
    ["POST", "/demo/simulate-verification"],
  ] as const)
    assert.equal((await app.inject({ method, url })).statusCode, 401);
  const s = await engine.create("sen_rose");
  await engine.create("sen_other");
  await store.enqueue("due:sch_demo", {});
  await store.claim("demo", s.callId);
  const calls = (
    await app.inject({
      url: "/demo/calls?seniorId=sen_rose",
      headers: { "x-cc-secret": secret },
    })
  ).json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].callId, s.callId);
  assert.equal(calls[0].transcript, undefined);
  const reset = await app.inject({
    method: "POST",
    url: "/demo/reset",
    headers: { "x-cc-secret": secret },
  });
  assert.deepEqual(reset.json(), { ok: true });
  assert.equal(store.sessions.size + store.jobs.size + store.claims.size, 0);
});
test("D3 simulation binds member, uses verbal resolution and rejects high-risk release", async (t) => {
  const deps = new MockDependencies();
  const { app, engine } = await createApp(settings(), { deps });
  t.after(() => app.close());
  const s = await engine.create("sen_rose");
  await engine.turn(s, "$500 gift cards, grandson in trouble");
  const payload = {
    seniorId: "sen_rose",
    holdId: deps.holds[0]!.id,
    memberId: "mem_danny",
    script: [
      { speaker: "member", text: "cancel" },
      { speaker: "senior", text: "yes" },
    ],
  };
  const post = (body: unknown) =>
    app.inject({
      method: "POST",
      url: "/demo/simulate-verification",
      headers: { "x-cc-secret": secret },
      payload: body as object,
    });
  assert.equal(
    (await post({ ...payload, memberId: "mem_mia" })).statusCode,
    409,
  );
  assert.equal((await post(payload)).statusCode, 200);
  assert.equal(deps.holds[0]!.status, "open");
  assert.equal(
    (
      await post({
        ...payload,
        script: [
          { speaker: "member", text: "release" },
          { speaker: "member", text: "yes" },
        ],
      })
    ).statusCode,
    409,
  );
  const response = await post({
    ...payload,
    script: [
      { speaker: "member", text: "cancel" },
      { speaker: "member", text: "yes" },
    ],
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(deps.holds[0]!.status, "cancelled");
  assert.deepEqual(deps.resolutions[0], {
    decision: "cancel",
    byMemberId: "mem_danny",
    method: "verbal_on_verification_call",
  });
});

test("D4 body phase wins over header and reminders do not consume due dispatch", async (t) => {
  const { app, store, tick } = await createApp(settings());
  t.after(() => app.close());
  const payload = {
    id: "sch_phase",
    proposalId: "prop_demo",
    seniorId: "sen_rose",
    memberIds: ["mem_danny"],
    startUtc: "2026-09-27T20:00:00Z",
    roomName: "demo-room",
    roomJoinUrl: "https://example.com/call/demo",
    seniorJoin: "phone_dialout",
    status: "scheduled",
  };
  const post = (body: object, phase: string) =>
    app.inject({
      method: "POST",
      url: "/webhooks/scheduled-call-due",
      headers: { "x-cc-secret": secret, "x-cc-phase": phase },
      payload: body,
    });
  assert.equal(
    (await post({ ...payload, phase: "reminder" }, "due")).statusCode,
    200,
  );
  await tick();
  assert.equal([...store.sessions.values()][0]?.purpose, "reminder");
  assert.equal((await post(payload, "reminder")).statusCode, 200);
  await tick();
  assert.equal(store.sessions.size, 1);
  assert.equal(
    (await post({ ...payload, phase: "due" }, "reminder")).statusCode,
    200,
  );
  await tick();
  assert.equal(store.sessions.size, 2);
  assert.ok(
    [...store.sessions.values()].some(
      (s) => s.purpose === "scheduled_family_call",
    ),
  );
  assert.equal(
    (await post({ ...payload, phase: "invalid" }, "due")).statusCode,
    400,
  );
});
