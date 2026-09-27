import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { transcribe } from "../src/stt.js";
const c = config({ MOCK: "1", CC_INTERNAL_SECRET: "test-secret-at-least-24-characters" });

test("STT never fails the turn: no provider keys → sidecar text, speaker marker stripped", async () => {
  const t = await transcribe(c, { buffer: Buffer.from("not audio 1") }, "mem_danny: Please cancel it.\n");
  assert.deepEqual(t, { transcript: "Please cancel it.", transcribedBy: "sidecar" });
  const none = await transcribe(c, { buffer: Buffer.from("not audio 2") });
  assert.equal(none.transcribedBy, "none");
});
