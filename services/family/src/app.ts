import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import type { CallEnded, Order } from "./contracts-local.js";
import { AppError, badRequest, type Deps } from "./deps.js";
import { actOnMessage } from "./domain/actions.js";
import { getCircle, seedAll } from "./domain/circle.js";
import { handleFraudHold, handleFraudResolved } from "./domain/fraud.js";
import { runPostCallPipeline } from "./domain/hooks.js";
import { fireDue, handleScheduledCallEnded, runRhythmJob, tick } from "./domain/jobs.js";
import { listMessages } from "./domain/messages.js";
import { computeMoments } from "./domain/moments.js";
import { handleOrderPaid, voiceNotesForOrder } from "./domain/orders.js";
import { handleReply } from "./domain/reply.js";
import { computeContactRhythm } from "./domain/rhythm.js";
import {
  confirmSenior, getScheduledCall, pendingSenior, requestSchedule, respondToProposal, toProposal, upcoming,
} from "./domain/scheduling/proposals.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Resolves when all async webhook work queued so far has finished (tests, demo). */
    flushJobs(): Promise<void>;
  }
}

const ALWAYS_SECRET = [/^\/webhooks\//, /^\/circle\//, /^\/jobs\//, /^\/demo\//];

function secretOk(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  // Be lenient with callers: an empty body with content-type JSON means {}.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = String(body ?? "").trim();
    if (!text) return done(null, {});
    try { done(null, JSON.parse(text)); } catch (err) { (err as any).statusCode = 400; done(err as Error, undefined); }
  });

  const pending = new Set<Promise<unknown>>();
  app.decorate("flushJobs", async () => { while (pending.size) await Promise.allSettled([...pending]); });
  /** CONTRACTS 禮5: receivers return 200 quickly and process async. */
  const background = (name: string, fn: () => Promise<unknown>) => {
    const p = (async () => {
      try { await fn(); } catch (err) { deps.log.error({ err: String(err), stack: (err as Error)?.stack, job: name }, "webhook processing failed"); }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
  };

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === "OPTIONS" || req.url === "/health") return;
    const path = req.url.split("?")[0];
    const needs = deps.cfg.requireSecretEverywhere || ALWAYS_SECRET.some((re) => re.test(path));
    if (needs && !secretOk(req.headers["x-cc-secret"], deps.cfg.internalSecret)) {
      reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "missing or invalid X-CC-Secret" } });
    }
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err.validation || err.statusCode === 400 || err.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: err.message } });
    }
    deps.log.error({ err: String(err), stack: err?.stack }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error" } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: `${req.method} ${req.url} not found` } }));

  // ---- CONTRACTS 禮4 ----
  app.get("/health", async () => ({ ok: true, service: "family", mock: deps.cfg.mock }));

  app.get<{ Params: { seniorId: string } }>("/circle/:seniorId", async (req) => {
    const circle = await getCircle(deps, req.params.seniorId);
    // Additive (CCR-5): things for the voice agent to mention on Rose's next call.
    const seniorHints = (await deps.store.seniorHints.list({ seniorId: req.params.seniorId })).map((h) => ({ text: h.text, createdAt: h.createdAt }));
    return { ...circle, seniorHints };
  });

  app.get<{ Params: { seniorId: string } }>("/contact-rhythm/:seniorId", async (req) => computeContactRhythm(deps, req.params.seniorId));

  app.post<{ Body: any }>("/schedule/request", async (req) => requestSchedule(deps, (req.body as any) ?? {}));
  app.post<{ Params: { id: string }; Body: any }>("/schedule/proposals/:id/respond", async (req) => respondToProposal(deps, req.params.id, (req.body as any)));
  app.post<{ Params: { id: string }; Body: any }>("/schedule/proposals/:id/confirm-senior", async (req) => confirmSenior(deps, req.params.id, (req.body as any)));
  app.get<{ Params: { seniorId: string } }>("/schedule/:seniorId/upcoming", async (req) => upcoming(deps, req.params.seniorId));
  app.get<{ Params: { seniorId: string } }>("/proposals/:seniorId/pending-senior", async (req) => pendingSenior(deps, req.params.seniorId));

  app.get<{ Querystring: { memberId?: string } }>("/messages", async (req) => listMessages(deps, req.query.memberId ?? ""));
  app.post<{ Params: { id: string }; Body: any }>("/messages/:id/act", async (req) => actOnMessage(deps, req.params.id, (req.body as any)));
  app.post<{ Body: any }>("/messages/reply", async (req) => handleReply(deps, (req.body as any)));

  app.get<{ Params: { seniorId: string }; Querystring: { week?: string } }>("/moments/:seniorId", async (req) => computeMoments(deps, req.params.seniorId, req.query.week));

  // ---- CONTRACTS 禮5 webhooks ----
  app.post<{ Body: CallEnded }>("/webhooks/call-ended", async (req) => {
    const call = (req.body as any);
    if (!call?.callId || !call.seniorId || !Array.isArray(call.transcript)) throw badRequest("expected CallEnded");
    background("call-ended", async () => {
      if (call.kind === "scheduled_family_call") await handleScheduledCallEnded(deps, call);
      await runPostCallPipeline(deps, call);
    });
    return { ok: true };
  });
  app.post<{ Body: Order }>("/webhooks/order-paid", async (req) => {
    if (!(req.body as any)?.id || !(req.body as any).request) throw badRequest("expected Order");
    background("order-paid", () => handleOrderPaid(deps, (req.body as any)));
    return { ok: true };
  });
  app.post<{ Body: any }>("/webhooks/fraud-hold", async (req) => {
    if (!(req.body as any)?.order?.id || !(req.body as any).hold?.id) throw badRequest("expected { order, hold }");
    background("fraud-hold", () => handleFraudHold(deps, (req.body as any)));
    return { ok: true };
  });
  app.post<{ Body: any }>("/webhooks/fraud-resolved", async (req) => {
    if (!(req.body as any)?.order?.id || !(req.body as any).hold?.id) throw badRequest("expected { order, hold }");
    background("fraud-resolved", () => handleFraudResolved(deps, (req.body as any)));
    return { ok: true };
  });

  // ---- Additions (requested in status/AGENT-3.md CCRs) ----
  app.get<{ Params: { id: string } }>("/schedule/proposals/:id", async (req) => {
    const p = await deps.store.proposals.get(req.params.id);
    if (!p) throw new AppError(404, "NOT_FOUND", `proposal ${req.params.id} not found`);
    return toProposal(p);
  });
  /** Join credentials for the family video room (Agent 4's /call/:scheduledCallId page). */
  app.get<{ Params: { id: string }; Querystring: { memberId?: string } }>("/schedule/calls/:id/join", async (req) => {
    const sc = await getScheduledCall(deps, req.params.id);
    const memberId = req.query.memberId ?? "";
    if (!sc.memberIds.includes(memberId)) throw new AppError(403, "NOT_INVITED", `${memberId} is not on this call`);
    if (!sc.roomName) throw badRequest("this is a visit, not a video call", "NO_ROOM");
    const circle = await getCircle(deps, sc.seniorId);
    const name = circle.members.find((m) => m.id === memberId)?.name ?? memberId;
    return { serverUrl: deps.rooms.serverUrl, roomName: sc.roomName, identity: memberId, token: await deps.rooms.joinToken(sc.roomName, memberId, name) };
  });
  app.get<{ Params: { orderId: string } }>("/orders/:orderId/voice-notes", async (req) => voiceNotesForOrder(deps, req.params.orderId));

  app.post("/jobs/tick", async () => tick(deps));
  app.post<{ Body: { seniorId?: string } }>("/jobs/rhythm", async (req) => ({ proposalIds: await runRhythmJob(deps, (req.body as any)?.seniorId ?? "sen_rose") }));
  app.post("/demo/reset", async () => {
    deps.clock.reset();
    return { ok: true, ...(await seedAll(deps)) };
  });
  app.get("/demo/clock", async () => ({ nowUtc: deps.clock.now().toISOString() }));
  /** Fast-forward: { nowUtc } or { to: "next_call", minutesBefore?: number }. Runs a scheduler tick right away. */
  app.post<{ Body: { nowUtc?: string; to?: string; minutesBefore?: number } }>("/demo/time-travel", async (req) => {
    let target: number;
    if (req.body?.to === "next_call") {
      const next = (await deps.store.scheduledCalls.list()).filter((c) => c.status === "scheduled").sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0];
      if (!next) throw new AppError(404, "NO_UPCOMING_CALL", "no scheduled call to fast-forward to");
      target = Date.parse(next.startUtc) - (req.body.minutesBefore ?? 0) * 60_000;
    } else {
      target = Date.parse(req.body?.nowUtc ?? "");
      if (Number.isNaN(target)) throw badRequest("nowUtc (ISO) or to:\"next_call\" required");
    }
    deps.clock.travelTo(new Date(target));
    const ran = await tick(deps);
    return { nowUtc: deps.clock.now().toISOString(), tick: ran };
  });

  /** D2: fire scheduled_call.due for one call right now (demo "ring Rose" button). Re-firing is allowed. */
  app.post<{ Body: { scheduledCallId?: string } }>("/demo/fire-due", async (req) => {
    const sc = await getScheduledCall(deps, (req.body as any)?.scheduledCallId ?? "");
    if (sc.kind !== "video_call") throw badRequest("visits have no phone leg", "NO_PHONE_LEG");
    if (sc.status === "done" || sc.status === "missed") throw new AppError(409, "CALL_OVER", `scheduled call is ${sc.status}`);
    try {
      await fireDue(deps, sc);
    } catch (err) {
      throw new AppError(502, "VOICE_UNAVAILABLE", `voice rejected scheduled_call.due: ${String(err)}`);
    }
    return { ok: true };
  });

  return app;
}
