import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import twilio from "twilio";
import { setImmediate } from "node:timers/promises";
import { config } from "../src/config.js";
import { createApp } from "../src/app.js";
import { MockDependencies } from "../src/dependencies.js";
import { MockReasoner } from "../src/reasoner.js";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { media } from "../src/media.js";
import type WebSocket from "ws";
const c = config({
  MOCK: "1",
  MOCK_DEPENDENCIES: "1",
  CC_INTERNAL_SECRET: "test-secret-at-least-24-characters",
});
const live = {
  ...c,
  mock: false,
  publicUrl: "https://test.example",
  twilioSid: "AC" + "a".repeat(32),
  twilioToken: "test-auth-token",
  twilioNumber: "+15555550100",
  allowlist: ["+1555010000"],
};
test("Twilio requires a valid signature even with internal secret", async (t) => {
  const { app } = await createApp(live, {
    deps: new MockDependencies(),
    reasoner: new MockReasoner(),
  });
  t.after(() => app.close());
  const result = await app.inject({
    method: "POST",
    url: "/twilio/voice",
    headers: { "x-cc-secret": c.secret },
    payload: { From: "+1555010000", CallSid: "CA" + "b".repeat(32) },
  });
  assert.equal(result.statusCode, 403);
});
test("signed inbound call binds a stream token and escapes TwiML parameters", async (t) => {
  const { app, store } = await createApp(live, {
    deps: new MockDependencies(),
    reasoner: new MockReasoner(),
  });
  t.after(() => app.close());
  const body = { From: "+1555010000", CallSid: "CA" + "b".repeat(32) };
  const signature = twilio.getExpectedTwilioSignature(
    live.twilioToken,
    live.publicUrl + "/twilio/voice",
    body,
  );
  const result = await app.inject({
    method: "POST",
    url: "/twilio/voice",
    headers: {
      "x-twilio-signature": signature,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams(body).toString(),
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.match(result.body, /wss:\/\/test.example\/twilio\/stream/);
  assert.equal([...store.sessions.values()][0]?.twilioSid, body.CallSid);
  assert.match(result.body, /<Parameter name="token"/);
});
test("signed unknown caller remains rejected", async (t) => {
  const { app } = await createApp(live, {
    deps: new MockDependencies(),
    reasoner: new MockReasoner(),
  });
  t.after(() => app.close());
  const body = { From: "+15555559999", CallSid: "CA" + "b".repeat(32) };
  const result = await app.inject({
    method: "POST",
    url: "/twilio/voice",
    headers: {
      "x-twilio-signature": twilio.getExpectedTwilioSignature(
        live.twilioToken,
        live.publicUrl + "/twilio/voice",
        body,
      ),
    },
    payload: body,
  });
  assert.equal(result.statusCode, 403);
});
class Socket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await setImmediate();
  }
  assert.fail("Timed out waiting for media event");
}
test("normal speech after completed playback preserves confirmation; interrupted playback does not", async (t) => {
  const store = new Store();
  const deps = new MockDependencies();
  const engine = new Engine(store, deps, new MockReasoner());
  const s = await engine.create("sen_rose");
  s.twilioSid = "CA-demo";
  s.streamToken = "stream-token";
  const socket = new Socket();
  t.after(() => socket.close());
  let onText!: (text: string) => void, onSpeech!: () => void;
  media(socket as unknown as WebSocket, c, engine, {
    listen: (_c, text, speech) => {
      onText = text;
      onSpeech = speech;
      return { send() {}, close() {} };
    },
    synthesize: async function* () {
      yield Buffer.alloc(160, 255);
    },
  });
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: {
          streamSid: "MZ-demo",
          callSid: s.twilioSid,
          customParameters: { callId: s.callId, token: s.streamToken },
        },
      }),
    ),
  );
  const marks = () => socket.sent.filter((e) => e.event === "mark");
  await until(() => marks().length === 1);
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ event: "mark", mark: marks().at(-1).mark })),
  );
  onSpeech();
  onText("I need groceries");
  await until(() => marks().length === 2);
  // Interrupt the order summary before acknowledging playback. The old mark must not grant consent.
  onSpeech();
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ event: "mark", mark: marks().at(-1).mark })),
  );
  onText("yes");
  await until(() => marks().length === 3);
  assert.equal(deps.orders[0]?.status, "approved");
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ event: "mark", mark: marks().at(-1).mark })),
  );
  await until(() => s.pendingDelivered === true);
  onSpeech();
  onText("yes");
  await until(() => deps.orders[0]?.status === "paid");
});
test("unbound media start is rejected before STT opens", async () => {
  const socket = new Socket();
  const engine = new Engine(
    new Store(),
    new MockDependencies(),
    new MockReasoner(),
  );
  let opened = false;
  media(socket as unknown as WebSocket, c, engine, {
    listen: () => {
      opened = true;
      return { send() {}, close() {} };
    },
    synthesize: async function* () {},
  });
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        event: "start",
        start: { customParameters: { callId: "call_fake" } },
      }),
    ),
  );
  assert.equal(opened, false);
  assert.equal(socket.readyState, 3);
});
