import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { createApp } from "../src/app.js";
import { MockDependencies } from "../src/dependencies.js";
import { affirmative, stable } from "../src/engine.js";
const secret = "test-secret-at-least-24-characters";
const settings = (env: Record<string, string> = {}) =>
  config({ MOCK: "1", MOCK_DEPENDENCIES: "1", CC_INTERNAL_SECRET: secret, ...env });
const headers = { "x-cc-secret": secret };

test("reasoner: MOCK=1 does not force the mock reasoner; the key picks Muse", () => {
  assert.equal(settings().reasoner, "mock");
  assert.equal(settings({ META_API_KEY: "k" }).reasoner, "muse");
  assert.equal(settings({ META_API_KEY: "k", VOICE_REASONER: "mock" }).reasoner, "mock");
});

test("stable comparison ignores jsonb key order but not values", () => {
  assert.equal(stable({ a: 1, b: { c: 2, d: 3 } }), stable({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(stable({ a: 1 }), stable({ a: 2 }));
});

test("offer echoes confirm; changes and negations still fail closed (D16)", () => {
  assert.ok(affirmative("Yes, please call Danny.", ["call danny"]));
  assert.ok(affirmative("Yes, that sounds lovely."));
  assert.ok(!affirmative("Yes, please call Mark.", ["call danny"]));
  assert.ok(!affirmative("Yes, but add eggs"));
  assert.ok(!affirmative("Yes, wait, don't call Danny.", ["call danny"]));
});

test("converse keeps a session across turns and reports events", async (t) => {
  const deps = new MockDependencies();
  const { app } = await createApp(settings(), { deps });
  t.after(() => app.close());
  const turn = (body: object) =>
    app.inject({ method: "POST", url: "/demo/converse", headers, payload: { seniorId: "sen_rose", ...body } });
  const a = await turn({ text: "I need groceries" });
  assert.equal(a.statusCode, 200, a.body);
  const { sessionId } = a.json();
  assert.match(a.json().reply, /Should I go ahead/);
  assert.ok(a.json().events.some((e: { type: string }) => e.type === "order.drafted"));
  const b = await turn({ sessionId, text: "Yes, that's everything. Please go ahead and order it." });
  assert.equal(b.json().sessionId, sessionId);
  assert.ok(b.json().events.some((e: { type: string }) => e.type === "order.paid"));
  assert.equal(deps.orders[0]?.status, "paid");
  const end = await app.inject({ method: "POST", url: `/demo/converse/${sessionId}/end`, headers, payload: {} });
  assert.equal(end.statusCode, 200);
  assert.equal(deps.events.length, 1); // call.ended reached family
});

test("verifier leg: only the called member can cancel, in one turn (D8)", async (t) => {
  const deps = new MockDependencies();
  const { app } = await createApp(settings(), { deps });
  t.after(() => app.close());
  const turn = (body: object) =>
    app.inject({ method: "POST", url: "/demo/converse", headers, payload: { seniorId: "sen_rose", ...body } });
  const a = await turn({ text: "Buy $500 gift cards, don't tell anyone" });
  const { sessionId } = a.json();
  assert.ok(a.json().events.some((e: { type: string }) => e.type === "hold.placed"));
  // Before the call is placed, a member turn is refused.
  assert.equal((await turn({ sessionId, speaker: "mem_danny", text: "Cancel it" })).statusCode, 409);
  const b = await turn({ sessionId, text: "Yes, please call Danny." });
  assert.ok(b.json().events.some((e: { type: string }) => e.type === "verification.started"));
  // Another member is not the bound verifier.
  assert.equal((await turn({ sessionId, speaker: "mem_mark", text: "Cancel it" })).statusCode, 409);
  const c = await turn({ sessionId, speaker: "mem_danny", text: "That wasn't me. Please cancel it." });
  assert.equal(c.statusCode, 200, c.body);
  assert.ok(c.json().events.some((e: { type: string }) => e.type === "hold.cancelled"));
  assert.equal(deps.holds[0]?.status, "cancelled");
});
