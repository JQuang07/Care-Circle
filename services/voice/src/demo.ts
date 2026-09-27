import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribe, type Audio } from "./stt.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Dependencies } from "./dependencies.js";
import { Engine, affirmative } from "./engine.js";
import type { Store } from "./store.js";
import {
  FallbackReasoner,
  MockReasoner,
  MuseReasoner,
  type Reasoner,
} from "./reasoner.js";
import {
  ApiError,
  assert,
  id,
  type Circle,
  type Hold,
  type Order,
  type Proposal,
  type Session,
} from "./types.js";

/**
 * The verifier asks to cancel. Only a negated "cancel" blocks it, so "That wasn't me,
 * please cancel it. Don't buy any gift cards." still cancels. Cancel is the safe direction
 * and needs no passkey (D8); a release still needs its own confirmation.
 */
export const wantsCancel = (text: string) => {
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  return (
    /\bcancel\b/.test(lower) &&
    !/\b(don't|do not|not|never|shouldn't|no need to)\s+(\w+\s+)?cancel/.test(lower)
  );
};
export type DemoEvent ={ type: string; summary: string; data?: unknown };
const $ = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Wraps dependencies so a demo turn can report what it changed in the other services. */
export class EventRecorder implements Dependencies {
  private sink = new AsyncLocalStorage<DemoEvent[]>();
  constructor(public inner: Dependencies) {}
  emit(e: DemoEvent) {
    this.sink.getStore()?.push(e);
  }
  collect<T>(fn: () => Promise<T>) {
    const events: DemoEvent[] = [];
    return this.sink.run(events, async () => ({ result: await fn(), events }));
  }
  async call<T = unknown>(
    service: "money" | "family" | "delivery",
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const result = await this.inner.call<T>(service, method, path, body);
    if (method === "POST" && this.sink.getStore())
      await this.describe(service, path, body, result).catch(() => undefined);
    return result;
  }
  private async describe(
    service: string,
    path: string,
    body: unknown,
    result: unknown,
  ) {
    if (service === "money" && path === "/orders/draft") {
      const o = result as Order;
      if (o.status === "held")
        return this.emit({
          type: "hold.placed",
          summary: `Hold placed: ${o.fraud.risk} risk${o.fraud.typology ? ` (${o.fraud.typology.replace(/_/g, " ")})` : ""}, ${$(o.request.amountCents)}`,
          data: {
            orderId: o.id,
            holdId: o.holdId,
            risk: o.fraud.risk,
            typology: o.fraud.typology,
            suggestedVerifierId: o.fraud.suggestedVerifierId,
          },
        });
      return this.emit({
        type: "order.drafted",
        summary: `Order read back: ${$(o.request.amountCents)}${o.fulfilment ? ` at ${o.fulfilment.storeName}` : ""} (${o.fraud.risk} risk)`,
        data: { orderId: o.id, risk: o.fraud.risk, fulfilment: o.fulfilment },
      });
    }
    if (service === "money" && /^\/orders\/[^/]+\/confirm$/.test(path)) {
      let o = result as Order;
      this.emit({
        type: "order.paid",
        summary: `Order paid: ${$(o.request.amountCents)}`,
        data: { orderId: o.id, receiptUrl: o.receiptUrl },
      });
      if (!o.fulfilment) return;
      // Money asks delivery for the cart right after payment; give it a moment.
      for (let i = 0; i < 10 && !o.fulfilment?.delivery; i++) {
        await new Promise((r) => setTimeout(r, 300));
        o = await this.inner.call<Order>("money", "GET", `/orders/${o.id}`);
      }
      const d = o.fulfilment?.delivery;
      if (!d) return;
      const cart = await this.inner
        .call<{
          cartTotalCents: number;
          storeName: string;
          provider: string;
          status: string;
        }>("delivery", "GET", `/orders/${d.deliveryId}`)
        .catch(() => undefined);
      const who =
        (cart?.provider || o.fulfilment!.provider) === "doordash_thirdparty"
          ? "DoorDash"
          : "Mock delivery";
      return this.emit({
        type: `delivery.${d.status}`,
        summary:
          d.status === "dry_run_complete"
            ? `${who} DRY RUN cart ${cart ? $(cart.cartTotalCents) : ""} at ${cart?.storeName || o.fulfilment!.storeName}`
            : `${who} delivery ${d.status}${d.failureReason ? `: ${d.failureReason}` : ""}`,
        data: { ...d, cart },
      });
    }
    if (service === "money" && /^\/holds\/[^/]+\/resolve$/.test(path)) {
      const h = result as Hold;
      return this.emit({
        type: h.status === "cancelled" ? "hold.cancelled" : `hold.${h.status}`,
        summary: `Hold ${h.status} by ${h.resolution?.byMemberId ?? "family"}`,
        data: h,
      });
    }
    if (service === "family" && path === "/schedule/request") {
      const p = result as Proposal;
      return this.emit({
        type: "proposal.sent",
        summary: `Proposal sent to ${(p.memberIds || []).join(", ")} (${p.slots.length} slots)`,
        data: p,
      });
    }
    if (service === "family" && path.endsWith("/confirm-senior")) {
      const call = result as { id: string; startUtc: string };
      return this.emit({
        type: "call.scheduled",
        summary: `Family call scheduled for ${call.startUtc}`,
        data: call,
      });
    }
    void body;
  }
}

export function makeReasoner(c: Config, deps: Dependencies): Reasoner {
  if (c.reasoner !== "muse" || !c.metaKey) return new MockReasoner();
  const cache = new Map<string, { at: number; text: string }>();
  // "My usual groceries" comes from her real order history, never from the model.
  const usual = async (seniorId: string) => {
    const orders = await deps
      .call<Order[]>("money", "GET", `/orders?seniorId=${seniorId}`)
      .catch(() => [] as Order[]);
    const last = orders
      .filter((o) => o.request.type === "groceries" && o.status === "paid")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return last
      ? ` Her usual groceries (last paid grocery order): ${last.request.items.map((i) => `${i.qty} ${i.name}`).join(", ")}. Use these items when she asks for her usual groceries.`
      : "";
  };
  const describe = async (seniorId: string) => {
    const hit = cache.get(seniorId);
    if (hit && Date.now() - hit.at < 60_000) return hit.text;
    const circle = await deps.call<Circle>("family", "GET", `/circle/${seniorId}`);
    const text =
      `${circle.senior.name} (${circle.senior.id}). Members: ` +
      circle.members
        .map(
          (m) =>
            `${m.name} (${m.id}${m.isVerifier ? ", verifier" : ""}${m.dependents?.length ? `; children: ${m.dependents.map((d) => `${d.name}, ${d.age}`).join("; ")}` : ""})`,
        )
        .join(", ") +
      "." +
      (await usual(seniorId));
    cache.set(seniorId, { at: Date.now(), text });
    return text;
  };
  return new FallbackReasoner(new MuseReasoner(c, describe));
}

const converseBody = z
  .object({
    sessionId: id("call").optional(),
    seniorId: id("sen"),
    text: z.string().trim().min(1).max(4000),
    speaker: z.union([z.literal("senior"), id("mem")]).optional(),
  })
  .strict();
export type ConverseInput = z.infer<typeof converseBody>;

export async function registerConverse(
  app: FastifyInstance,
  c: Config,
  engine: Engine,
  store: Store,
  recorder: EventRecorder,
  reasoner: Reasoner,
) {
  const agentTurns = (s: Session, from: number) =>
    s.transcript
      .slice(from)
      .filter((t) => t.speaker === "agent")
      .map((t) => t.text)
      .join(" ");

  async function verifierTurn(parent: Session, memberId: string, text: string) {
    const v = [...store.sessions.values()].find(
      (v) =>
        !v.endedAt &&
        v.verification?.memberId === memberId &&
        (v.callId === parent.callId ||
          v.verification.parentCallId === parent.callId),
    );
    assert(
      v,
      "VERIFIER_REQUIRED",
      "Start the verification call before the family member speaks.",
    );
    const from = v.transcript.length;
    engine.add(v, memberId, text);
    const d = v.verification!;
    if (wantsCancel(text)) {
      // D8: cancelling is always allowed and needs no passkey; it is the safe direction.
      await engine.resolveVerifier(v, "cancel");
      await engine.say(v, "Thank you. The purchase is cancelled and nothing was paid.");
      await engine.end(v);
      if (!parent.endedAt && parent.callId !== v.callId)
        await engine.say(
          parent,
          "Your family asked me to cancel that payment, so no money was sent. Thank you for checking with them.",
        );
    } else if (affirmative(text) && d.decision) {
      await engine.resolveVerifier(v, d.decision);
      await engine.say(v, "Your decision is recorded.");
      await engine.end(v);
    } else if (/^(please )?release\b/i.test(text.trim())) {
      d.decision = "release";
      await engine.say(v, "You want to release the held order. Is that right?");
    } else
      await engine.say(
        v,
        "Please say cancel or release, then confirm your decision.",
      );
    return { session: v, reply: agentTurns(v, from) };
  }

  async function converse(b: ConverseInput) {
    assert(c.mock, "DEMO_DISABLED", "Demo turns are available only in MOCK=1.", 403);
    const { result, events } = await recorder.collect(async () => {
      let s = b.sessionId ? store.sessions.get(b.sessionId) : undefined;
      if (b.sessionId)
        assert(
          s && s.seniorId === b.seniorId,
          "NOT_FOUND",
          "Session not found.",
          404,
        );
      s ||= await engine.create(b.seniorId);
      if (b.speaker && b.speaker !== "senior") {
        const r = await verifierTurn(s, b.speaker, b.text);
        return { sessionId: s.callId, verificationSessionId: r.session.callId, reply: r.reply };
      }
      const from = s.transcript.length;
      try {
        await engine.turn(s, b.text);
      } catch (e) {
        if (!(e instanceof ApiError) || e.statusCode >= 500) throw e;
        recorder.emit({ type: "error", summary: `${e.code}: ${e.message}` });
        await engine.say(
          s,
          "I'm sorry, I couldn't finish that just now. Could you tell me again?",
        );
      }
      await engine.delivered(s);
      return { sessionId: s.callId, reply: agentTurns(s, from) };
    });
    const by =
      reasoner instanceof FallbackReasoner ? reasoner.last : "mock";
    return { ...result, reasonedBy: by, events };
  }

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  // Recorded clip → speech-to-text → the same turn as /demo/converse.
  app.post("/demo/audio-turn", async (request) => {
    assert(c.mock, "DEMO_DISABLED", "Demo turns are available only in MOCK=1.", 403);
    const fields: Record<string, string> = {};
    let audio: Audio | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file")
        audio = { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype };
      else fields[part.fieldname] = String(part.value);
    }
    assert(audio?.buffer.length, "AUDIO_REQUIRED", "Send the clip as the 'file' field.", 400);
    const t = await transcribe(c, audio!, fields.sidecar);
    // Keep the last upload for diagnosis ("didn't catch that"): <tmp>/care-circle-last-audio.*
    try {
      const base = join(tmpdir(), "care-circle-last-audio");
      writeFileSync(`${base}.${/wav/i.test(audio!.mimetype || audio!.filename || "") ? "wav" : "bin"}`, audio!.buffer);
      writeFileSync(`${base}.json`, JSON.stringify({ at: new Date().toISOString(), bytes: audio!.buffer.length, filename: audio!.filename, mimetype: audio!.mimetype, ...t }, null, 1));
    } catch { /* diagnostics only */ }
    console.log(`[voice] audio-turn ${audio!.buffer.length} B → ${t.transcribedBy}: "${t.transcript.slice(0, 80)}"`);
    const base = converseBody.omit({ text: true }).parse({
      sessionId: fields.sessionId || undefined,
      seniorId: fields.seniorId,
      speaker: fields.speaker || undefined,
    });
    if (!t.transcript)
      return {
        sessionId: base.sessionId,
        transcript: "",
        transcribedBy: t.transcribedBy,
        reply: "I'm sorry, I didn't catch that. Could you say it again?",
        events: [],
      };
    const r = await converse({ ...base, text: t.transcript });
    return { ...r, transcript: t.transcript, transcribedBy: t.transcribedBy, cached: !!t.cached };
  });
  app.post("/demo/converse", async (request) =>
    converse(converseBody.parse(request.body)),
  );
  app.post("/demo/converse/:sessionId/end", async (request) => {
    assert(c.mock, "DEMO_DISABLED", "Demo turns are available only in MOCK=1.", 403);
    const { sessionId } = z
      .object({ sessionId: id("call") })
      .parse(request.params);
    const s = store.sessions.get(sessionId);
    assert(s, "NOT_FOUND", "Session not found.", 404);
    for (const v of store.sessions.values())
      if (v.verification?.parentCallId === s.callId) await engine.end(v);
    await engine.end(s);
    await engine.flush();
    return { ok: true, callId: s.callId };
  });
  return converse;
}
