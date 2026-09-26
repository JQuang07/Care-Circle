import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import twilio from "twilio";
import { WebhookReceiver } from "livekit-server-sdk";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import type { Config } from "./config.js";
import { Store } from "./store.js";
import { Engine, affirmative } from "./engine.js";
import { Telephony } from "./telephony.js";
import {
  MockDependencies,
  HttpDependencies,
  type Dependencies,
} from "./dependencies.js";
import { MuseReasoner, MockReasoner, type Reasoner } from "./reasoner.js";
import { ApiError, assert, id, scheduledCall, type Circle } from "./types.js";
import { media } from "./media.js";
const outboundBody = z
  .object({
    seniorId: id("sen"),
    purpose: z.enum(["scheduled_family_call", "reminder"]),
    scheduledCallId: id("sch").optional(),
    roomName: z.string().min(1).max(200).optional(),
  })
  .strict();
export async function createApp(
  c: Config,
  options: { deps?: Dependencies; reasoner?: Reasoner; store?: Store } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const store = options.store || new Store(c.databaseUrl);
  await store.init();
  const deps =
    options.deps ||
    (c.mockDependencies ? new MockDependencies() : new HttpDependencies(c));
  const engine = new Engine(
    store,
    deps,
    options.reasoner || (c.mock ? new MockReasoner() : new MuseReasoner(c)),
  );
  for (const session of store.sessions.values())
    if (session.endedAt && session.purpose !== "reminder")
      await engine.end(session);
  const phone = new Telephony(c, engine);
  engine.startVerification = (s, h, m) => phone.verify(s, h, m);
  await app.register(formbody);
  await app.register(websocket, { options: { maxPayload: 65536 } });
  app.addContentTypeParser(
    "application/webhook+json",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = err instanceof ZodError ? 400 : err.statusCode || 500;
    reply.code(status).send({
      error: {
        code:
          err instanceof ApiError
            ? err.code
            : status === 400
              ? "INVALID_REQUEST"
              : "INTERNAL_ERROR",
        message:
          status >= 500
            ? "The action could not be completed. Check service configuration and dependencies."
            : err instanceof ZodError
              ? "Request body is invalid."
              : err.message,
      },
    });
  });
  app.addHook("preValidation", async (request) => {
    if (request.url === "/health" || request.url === "/livekit/events") return;
    if (request.url.startsWith("/twilio/")) {
      if (c.mock)
        throw new ApiError(
          503,
          "LIVE_MODE_REQUIRED",
          "Twilio transport is disabled in MOCK=1.",
        );
      const signature = request.headers["x-twilio-signature"];
      const valid =
        typeof signature === "string" &&
        twilio.validateRequest(
          c.twilioToken!,
          signature,
          c.publicUrl + request.url,
          request.method === "POST"
            ? (request.body as Record<string, string>) || {}
            : {},
        );
      assert(valid, "INVALID_SIGNATURE", "Invalid Twilio signature.", 403);
      return;
    }
    const secret = request.headers["x-cc-secret"];
    assert(
      typeof secret === "string" &&
        Buffer.byteLength(secret) === Buffer.byteLength(c.secret) &&
        timingSafeEqual(Buffer.from(secret), Buffer.from(c.secret)),
      "UNAUTHORIZED",
      "Internal authentication required.",
      401,
    );
  });
  app.get("/health", async () => ({
    ok: true,
    service: "voice",
    mock: c.mock,
  }));
  app.post("/demo/simulate-inbound", async (request) => {
    assert(
      c.mock,
      "DEMO_DISABLED",
      "Text simulation is available only in MOCK=1.",
      403,
    );
    const body = z
      .object({
        seniorId: id("sen"),
        script: z.array(z.string().min(1).max(4000)).min(1).max(50),
      })
      .strict()
      .parse(request.body);
    const s = await engine.create(body.seniorId);
    try {
      await engine.begin(s);
      await engine.delivered(s);
      for (const line of body.script) {
        // Explicit mock-only role marker; never accepted from the real senior audio stream.
        const verifier = /^(mem_[\w-]+):\s*(.+)$/.exec(line);
        if (verifier) {
          const v = [...store.sessions.values()].find(
            (v) =>
              v.verification?.parentCallId === s.callId &&
              v.verification.memberId === verifier[1],
          );
          assert(
            v,
            "VERIFIER_REQUIRED",
            "Start verification before the mock verifier speaks.",
          );
          const text = verifier[2]!;
          engine.add(v, verifier[1]!, text);
          if (affirmative(text) && v.verification?.decision) {
            await engine.resolveVerifier(v, v.verification.decision);
            await engine.say(v, "Your decision is recorded.");
            await engine.end(v);
          } else if (/^(cancel|release)[.!\s]*$/i.test(text)) {
            v.verification!.decision = text.toLowerCase().startsWith("cancel")
              ? "cancel"
              : "release";
            await engine.say(
              v,
              `You want to ${v.verification!.decision} the held order. Is that right?`,
            );
          } else
            await engine.say(
              v,
              "Please say cancel or release, then confirm your decision.",
            );
        } else {
          await engine.turn(s, line);
          await engine.delivered(s);
        }
      }
    } finally {
      await engine.end(s);
      await engine.flush();
    }
    return { callId: s.callId };
  });
  app.get("/demo/calls", async (request) => {
    const { seniorId } = z.object({ seniorId: id("sen") }).parse(request.query);
    return [...store.sessions.values()]
      .filter((s) => s.seniorId === seniorId)
      .map(({ callId, kind, purpose, scheduledCallId, startedAt }) => ({
        callId,
        kind,
        purpose,
        scheduledCallId,
        startedAt,
      }));
  });
  app.post("/demo/reset", async () => {
    assert(c.mock, "DEMO_DISABLED", "Reset is available only in MOCK=1.", 403);
    assert(!ticking, "RESET_BUSY", "Wait for pending dispatch to finish.");
    await store.reset();
    return { ok: true };
  });
  app.post("/demo/simulate-verification", async (request) => {
    assert(
      c.mock,
      "DEMO_DISABLED",
      "Text simulation is available only in MOCK=1.",
      403,
    );
    const body = z
      .object({
        seniorId: id("sen"),
        holdId: id("hold"),
        memberId: id("mem"),
        script: z
          .array(
            z
              .object({
                speaker: z.enum(["senior", "member"]),
                text: z.string().min(1).max(4000),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict()
      .parse(request.body);
    await engine.verificationContext(body.seniorId, body.holdId, body.memberId);
    const parent = await engine.create(body.seniorId);
    let verifier: typeof parent | undefined;
    try {
      const { callId } = await phone.verify(parent, body.holdId, body.memberId);
      verifier = store.sessions.get(callId)!;
      for (const line of body.script) {
        if (line.speaker === "senior") {
          engine.add(verifier, "senior", line.text);
          continue; // A senior's words can never authorize the member's decision.
        }
        engine.add(verifier, body.memberId, line.text);
        const v = verifier.verification!;
        if (affirmative(line.text) && v.decision) {
          await engine.resolveVerifier(verifier, v.decision);
          await engine.say(verifier, "Your decision is recorded.");
          break;
        }
        v.decision =
          /^(please )?cancel( it| the (held )?(order|purchase))?[.!\s]*$/i.test(
            line.text,
          )
            ? "cancel"
            : /^(please )?release( it| the (held )?(order|purchase))?[.!\s]*$/i.test(
                  line.text,
                )
              ? "release"
              : undefined;
        await engine.say(
          verifier,
          v.decision
            ? `You want to ${v.decision} the held order. Is that right?`
            : "Please say cancel or release, then confirm your decision.",
        );
      }
      return { callId };
    } finally {
      if (verifier) await engine.end(verifier);
      await engine.end(parent);
      await engine.flush();
    }
  });
  app.get("/demo/calls/:callId", async (request) => {
    assert(
      c.mock,
      "DEMO_DISABLED",
      "Debug transcripts are available only in mock mode.",
      403,
    );
    const { callId } = z.object({ callId: id("call") }).parse(request.params);
    const s = store.sessions.get(callId);
    assert(s, "NOT_FOUND", "Call not found.", 404);
    return s;
  });
  app.post("/calls/verification", async (request) => {
    const b = z
      .object({ seniorId: id("sen"), holdId: id("hold"), memberId: id("mem") })
      .strict()
      .parse(request.body);
    const parent = [...store.sessions.values()].find(
      (s) => s.seniorId === b.seniorId && s.kind === "inbound" && !s.endedAt,
    );
    assert(parent, "ACTIVE_CALL_REQUIRED", "No active senior call.");
    return phone.verify(parent, b.holdId, b.memberId);
  });
  app.post("/calls/outbound", async (request) =>
    phone.outbound(outboundBody.parse(request.body)),
  );
  app.post("/webhooks/scheduled-call-due", async (request) => {
    const call = scheduledCall.parse(request.body);
    await store.enqueue(`due:${call.id}`, call);
    return { ok: true };
  });
  app.post("/twilio/voice", async (request, reply) => {
    const body = z
      .object({
        CallSid: z.string().regex(/^CA[0-9a-f]{32}$/i),
        From: z.string(),
      })
      .passthrough()
      .parse(request.body);
    const prior = [...store.sessions.values()].find(
      (s) => s.twilioSid === body.CallSid,
    );
    assert(!prior, "CALL_ALREADY_STARTED", "This call has already started.");
    let seniorId: string | undefined;
    for (const candidate of c.seniorIds) {
      const circle = await deps.call<Circle>(
        "family",
        "GET",
        `/circle/${candidate}`,
      );
      if (circle.senior.id === candidate && circle.senior.phone === body.From) {
        seniorId = candidate;
        break;
      }
    }
    assert(seniorId, "UNKNOWN_CALLER", "Caller is not enrolled.", 403);
    phone.allowed(body.From);
    const s = await engine.create(seniorId);
    s.twilioSid = body.CallSid;
    s.streamToken = randomBytes(24).toString("hex");
    await store.save(s);
    const response = new twilio.twiml.VoiceResponse();
    const stream = response.connect().stream({
      url: c.publicUrl!.replace(/^https:/, "wss:") + "/twilio/stream",
      statusCallback: c.publicUrl + "/twilio/stream-status",
    });
    stream.parameter({ name: "callId", value: s.callId });
    stream.parameter({ name: "token", value: s.streamToken });
    response.hangup();
    return reply.type("text/xml").send(response.toString());
  });
  app.get("/twilio/stream", { websocket: true }, (socket) =>
    media(socket, c, engine),
  );
  app.post("/livekit/events", async (request) => {
    assert(
      !c.mock && c.livekitKey && c.livekitSecret,
      "LIVEKIT_NOT_CONFIGURED",
      "LiveKit callbacks unavailable.",
      503,
    );
    assert(
      typeof request.body === "string" &&
        typeof request.headers.authorization === "string",
      "INVALID_SIGNATURE",
      "Signed raw LiveKit event required.",
      403,
    );
    let event;
    try {
      event = await new WebhookReceiver(c.livekitKey, c.livekitSecret).receive(
        request.body,
        request.headers.authorization,
      );
    } catch {
      throw new ApiError(
        403,
        "INVALID_SIGNATURE",
        "Invalid LiveKit event signature.",
      );
    }
    if (event.event === "participant_left") {
      const s = store.sessions.get(event.participant?.identity || "");
      if (s?.transport === "livekit-sip") await engine.end(s);
    }
    return { ok: true };
  });
  app.post("/twilio/stream-status", async () => ({ ok: true }));
  app.post("/twilio/status", async (request) => {
    const b = z
      .object({ CallSid: z.string(), CallStatus: z.string() })
      .passthrough()
      .parse(request.body);
    const s = [...store.sessions.values()].find(
      (s) => s.twilioSid === b.CallSid,
    );
    if (
      s &&
      ["completed", "busy", "failed", "no-answer", "canceled"].includes(
        b.CallStatus,
      )
    ) {
      if (s.purpose === "reminder") {
        s.endedAt = new Date().toISOString();
        await store.save(s);
      } else await engine.end(s);
      if (s.verification && !s.verification.resolved)
        await phone.finishVerification(
          s,
          "We couldn’t complete the check. The purchase will stay paused.",
        );
    }
    return { ok: true };
  });
  app.post("/twilio/verification/:callId/decision", async (request, reply) => {
    const { callId } = z.object({ callId: id("call") }).parse(request.params);
    const b = z
      .object({ CallSid: z.string(), SpeechResult: z.string().optional() })
      .passthrough()
      .parse(request.body);
    const s = store.sessions.get(callId);
    assert(
      s?.verification && s.twilioSid === b.CallSid && !s.endedAt,
      "VERIFIER_REQUIRED",
      "Unrecognized verifier leg.",
      403,
    );
    const response = new twilio.twiml.VoiceResponse();
    const text = b.SpeechResult?.trim() || "";
    if (text) engine.add(s, s.verification.memberId, text);
    if (affirmative(text) && s.verification.decision) {
      try {
        await engine.resolveVerifier(s, s.verification.decision);
        response.say("Your decision is recorded. Thank you.");
        await phone.finishVerification(
          s,
          s.verification.decision === "cancel"
            ? "The held purchase is cancelled."
            : "Your family checked the request. Please use the app to review next steps.",
        );
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "PASSKEY_REQUIRED")) throw e;
        response.say(
          "This purchase needs approval in the app. It will stay paused.",
        );
        await phone.finishVerification(
          s,
          "The purchase will stay paused until your family reviews it in the app.",
        );
      }
      response.hangup();
      await engine.store.save(s);
      return reply.type("text/xml").send(response.toString());
    }
    s.verification.decision = /^cancel[.!\s]*$/i.test(text)
      ? "cancel"
      : /^release[.!\s]*$/i.test(text)
        ? "release"
        : undefined;
    const prompt = s.verification.decision
      ? `You want to ${s.verification.decision} the held order. Is that right?`
      : "Please say cancel or release for the held purchase.";
    engine.add(s, "agent", prompt);
    await store.save(s);
    response
      .gather({
        input: ["speech"],
        action: `${c.publicUrl}/twilio/verification/${callId}/decision`,
        method: "POST",
        speechTimeout: "auto",
        timeout: 8,
        actionOnEmptyResult: false,
      })
      .say(prompt);
    response.say(
      "The purchase will stay paused. Your family can review it in the app.",
    );
    response.hangup();
    return reply.type("text/xml").send(response.toString());
  });
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await engine.flush();
      for (const [key, job] of store.jobs) {
        if (job.done || job.attempts >= 5 || !key.startsWith("due:")) continue;
        try {
          const call = scheduledCall.parse(job.payload);
          await phone.outbound({
            seniorId: call.seniorId,
            purpose: "scheduled_family_call",
            scheduledCallId: call.id,
            roomName: call.roomName,
          });
          await store.mark(key, true);
        } catch {
          console.error("Scheduled call dispatch needs attention:", key);
          await store.mark(
            key,
            false,
          ); /* Retry dispatch only if it has not already been claimed. */
        }
      }
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => void tick().catch(() => {}), 5000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await store.close();
  });
  return { app, engine, phone, store, tick };
}
