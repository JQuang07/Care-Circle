import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ApiError,
  assert,
  orderRequest,
  type Session,
  type Order,
  type Hold,
  type Circle,
  type Proposal,
  type Pending,
} from "./types.js";
import type { Dependencies } from "./dependencies.js";
import { MockReasoner, type Reasoner } from "./reasoner.js";
import { Store } from "./store.js";
// Only confirmation language is accepted. Unknown trailing words fail closed,
// so a leading yes cannot authorize an item, quantity, timing or recipient change.
export const affirmative = (text: string, allowed: string[] = []) => {
  const normalized = text.trim().toLowerCase().replace(/[’]/g, "'");
  if (
    /\b(no|not|wait|don't|hold on|actually|never|stop|cancel)\b/.test(
      normalized,
    )
  )
    return false;
  if (
    !/^(yes|yeah|go ahead|please do|that's right|okay|ok|sure|confirm)\b/.test(
      normalized,
    )
  )
    return false;
  // Exact phrases the offer itself used (e.g. the slot's "Sun 4:00 PM") may be echoed back.
  let rest = normalized;
  for (const phrase of allowed)
    if (phrase) rest = rest.split(phrase.toLowerCase()).join(" ");
  return (
    rest
      .replace(
        /\b(that's everything|that is everything|that's right|go ahead|please do|(order|send) (it|them)|place (the|my) order|with (the|my|that) order|(that )?sounds (lovely|good|great|perfect|wonderful|fine)|that works( for me)?|set it up|book it|(thank you|thanks)( (so|very) much)?|yes|yeah|okay|ok|sure|confirm|please|and)\b/g,
        "",
      )
      .replace(/[.,!\s]/g, "") === ""
  );
};
/** Rose steps out of a "keep this between us" span only by saying so. */
export const privateEnds = (text: string) =>
  /^(anyway|anyhow|moving on|on another note|enough about that|back to)\b|you can share (this|that)/i.test(
    text.trim(),
  );
/** "Kroger (demo)" → "Kroger": the mock's marker isn't something Rose should hear. */
export const storeLabel = (name?: string) =>
  name?.replace(/\s*\(demo\)\s*$/i, "").trim() || "the store";
/** Key-order independent JSON: Postgres jsonb does not keep key order. */
export const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  ) ?? "undefined";
export const negative = (text: string) =>
  /^(no|no thanks|cancel|never mind|nevermind|stop)[.!\s]*$/i.test(text.trim());
export class Engine {
  startVerification?: (
    s: Session,
    holdId: string,
    memberId: string,
  ) => Promise<{ callId: string }>;
  constructor(
    public store: Store,
    public deps: Dependencies,
    private reasoner: Reasoner,
  ) {}
  async create(seniorId: string, kind: Session["kind"] = "inbound") {
    const s: Session = {
      callId: `call_${randomUUID()}`,
      seniorId,
      kind,
      startedAt: new Date().toISOString(),
      transcript: [],
      privateSpans: [],
      latencies: [],
    };
    await this.store.save(s);
    return s;
  }
  add(s: Session, speaker: string, text: string) {
    const ms = Math.max(Date.now(), (s.lastTs || 0) + 1);
    s.lastTs = ms;
    const turn = { speaker, text, ts: new Date(ms).toISOString() };
    s.transcript.push(turn);
    return turn;
  }
  async say(s: Session, text: string) {
    this.add(s, "agent", text);
    await this.store.save(s);
    return text;
  }
  async begin(s: Session) {
    const proposals = await this.deps.call<Proposal[]>(
      "family",
      "GET",
      `/proposals/${s.seniorId}/pending-senior`,
    );
    const p = proposals.find((p) => p.status === "awaiting_senior");
    if (p?.slots[0]) return this.offerSchedule(s, p, p.slots[0].id);
    return this.say(
      s,
      "Hello. It’s Care Circle, your family’s helper. What can I help you with today?",
    );
  }
  delivered(s: Session) {
    if (s.pending) s.pendingDelivered = true;
    return this.store.save(s);
  }
  async turn(s: Session, text: string) {
    assert(!s.endedAt, "CALL_ENDED", "This call has ended.");
    if (s.privateStart && privateEnds(text)) {
      // The span ends with the agent's acknowledgement; this turn is shareable again.
      s.privateSpans.push({
        startTs: s.privateStart,
        endTs: s.transcript.at(-1)!.ts,
      });
      s.privateStart = undefined;
    }
    const turn = this.add(s, "senior", text);
    if (
      /keep this between us|keep (this|that) private|don'?t share this/i.test(
        text,
      )
    ) {
      // A privacy marker is not a change: an offer already read back stays pending.
      s.privateStart ||= turn.ts;
      return this.say(
        s,
        "I’ll keep this part private from your family. What would you like to tell me?",
      );
    }
    if (negative(text)) {
      s.pending = undefined;
      s.pendingDelivered = false;
      return this.say(s, "All right. I won’t go ahead with that.");
    }
    if (/say that again|repeat|didn'?t hear/i.test(text))
      return this.say(
        s,
        s.transcript.filter((t) => t.speaker === "agent").at(-1)?.text ||
          "What can I help you with?",
      );
    if (s.pending?.kind === "unmatched") {
      const order = s.pending.order;
      // No purchase authorization exists while missing items are unresolved.
      if (
        /^(skip( it| them| those)?|leave (it|them) out)[.!\s]*$/i.test(
          text.trim(),
        )
      ) {
        s.pending = undefined;
        s.pendingDelivered = false;
        const missing = order.fulfilment!.unmatchedItems.map((item) =>
          item.toLowerCase(),
        );
        const items = order.request.items.filter(
          (item) => !missing.includes(item.name.toLowerCase()),
        );
        if (!items.length)
          return this.say(
            s,
            "There are no items left. What would you like instead?",
          );
        const result = await this.tool(s, "place_order", {
          ...order.request,
          items,
        });
        return this.say(s, String((result as { speak: string }).speak));
      }
      if (affirmative(text)) return this.say(s, this.pendingSummary(s.pending));
      s.pending = undefined;
      s.pendingDelivered = false;
    }
    let held: Pending | undefined;
    if (s.pending) {
      if (affirmative(text, this.echoes(s.pending))) {
        if (!s.pendingDelivered)
          return this.say(
            s,
            "Let me finish the details first. " +
              this.pendingSummary(s.pending),
          );
        const pending = s.pending;
        s.pending = undefined;
        s.pendingDelivered = false;
        // Persist consumed authorization BEFORE crossing a mutation boundary.
        await this.store.save(s);
        if (pending.kind === "order") {
          const orders = await this.deps.call<Order[]>(
            "money",
            "GET",
            `/orders?seniorId=${s.seniorId}`,
          );
          const current = orders.find((o) => o.id === pending.order.id);
          assert(
            current?.status === "approved" &&
              !current.fraud.hardStop &&
              current.fraud.risk !== "high",
            "ORDER_NOT_APPROVED",
            "This order needs family review.",
          );
          assert(
            stable(current.request) === stable(pending.order.request) &&
              stable(current.fulfilment) === stable(pending.order.fulfilment),
            "ORDER_CHANGED",
            "Order details changed. Please request a fresh draft.",
          );
          const paid = await this.deps.call<Order>(
            "money",
            "POST",
            `/orders/${current.id}/confirm`,
            {},
          );
          assert(
            paid.status === "paid",
            "NOT_PAID",
            "Payment has not been confirmed.",
          );
          // Groceries: confirm the store and the items read back (the demo stops at DoorDash
          // checkout; the /stage card says DRY RUN, Rose hears the order confirmation).
          return this.say(
            s,
            paid.fulfilment
              ? `Done. Your groceries are ordered from ${storeLabel(paid.fulfilment.storeName)}: ${paid.request.items.map((i) => `${i.qty} ${i.name}`).join(", ")}, $${(paid.request.amountCents / 100).toFixed(2)}. I've let your family know. Is there anything else I can help with?`
              : "Your order is paid. Is there anything else I can help with?",
          );
        }
        if (pending.kind === "verification") {
          assert(
            this.startVerification,
            "NOT_CONFIGURED",
            "Verification is unavailable.",
          );
          await this.startVerification(s, pending.holdId, pending.memberId);
          return this.say(
            s,
            "I’m calling your family’s stored number so you can check together. Remember to ask unexpected callers for your family’s private code word.",
          );
        }
        const proposals = await this.deps.call<Proposal[]>(
          "family",
          "GET",
          `/proposals/${s.seniorId}/pending-senior`,
        );
        assert(
          proposals.some(
            (p) =>
              p.id === pending.proposalId &&
              p.status === "awaiting_senior" &&
              p.slots.some((slot) => slot.id === pending.slotId),
          ),
          "SLOT_UNAVAILABLE",
          "That time is no longer awaiting confirmation.",
        );
        await this.deps.call(
          "family",
          "POST",
          `/schedule/proposals/${pending.proposalId}/confirm-senior`,
          { slotId: pending.slotId },
        );
        return this.say(s, "Your family time is confirmed.");
      }
      // Not a confirmation. A question or small talk keeps the offer (re-read below);
      // anything that leads to a tool action is a change and invalidates it.
      held = s.pending;
      s.pending = undefined;
      s.pendingDelivered = false;
    }
    const results: { name: string; result: unknown }[] = [];
    for (let step = 0; step < 5; step++) {
      const decision = await this.reasoner.next(s, results, held);
      // A model rereading an old "keep this between us" must not restart a span she just
      // ended ("Anyway, …") or one already open; the regex above owns privacy markers.
      decision.actions = decision.actions.filter(
        (a) =>
          a.name !== "mark_private" || (!s.privateStart && !privateEnds(text)),
      );
      if (!decision.actions.length) {
        if (held && step === 0) {
          s.pending = held; // fresh playback required: pendingDelivered stays false
          const summary = this.pendingSummary(held);
          return this.say(
            s,
            decision.text ? `${decision.text} ${summary}` : summary,
          );
        }
        return this.say(s, decision.text || "Could you tell me a little more?");
      }
      for (const action of decision.actions) {
        let result: unknown;
        try {
          result = await this.tool(s, action.name, action.args);
        } catch (e) {
          // A model can fix bad arguments; a refusal is reported back, never bypassed.
          const recoverable =
            e instanceof z.ZodError ||
            (e instanceof ApiError && e.statusCode < 500);
          if (this.reasoner instanceof MockReasoner || !recoverable) throw e;
          result = {
            error: e instanceof ApiError ? `${e.code}: ${e.message}` : "Invalid tool arguments.",
          };
        }
        if (typeof result === "object" && result !== null && "speak" in result)
          return this.say(s, String(result.speak));
        results.push({ name: action.name, result });
      }
    }
    return this.say(
      s,
      "Let’s take that one step at a time. What would you like to do first?",
    );
  }
  pendingSummary(p: Pending) {
    const merchants: Record<string, string> = {
      mer_freshmart: "Kroger",
      mer_cornerrx: "CornerRx",
      mer_crumb: "Sweet Crumb Bakery",
      mer_ridemock: "RideMock",
    };
    if (p.kind === "unmatched")
      return `They didn't have ${p.order.fulfilment!.unmatchedItems.join(", ")}. Something else, or skip it?`;
    if (p.kind === "order") {
      const order = p.order;
      const source = order.fulfilment
        ? `${storeLabel(order.fulfilment.storeName)}${order.fulfilment.provider === "doordash_thirdparty" ? ", delivered by DoorDash" : ""}`
        : merchants[order.request.merchantId || ""] ||
          order.request.payeeDescription ||
          "the requested merchant";
      return `That’s ${order.request.items.map((i) => `${i.qty} ${i.name}`).join(", ")} from ${source}, $${(order.request.amountCents / 100).toFixed(2)}. Should I go ahead?`;
    }
    if (p.kind === "verification")
      return "Would you like me to call your family’s stored number to check together?";
    return p.label
      ? `Your family proposed ${p.label}. Does that work for you?`
      : "Does that family time work for you?";
  }
  echoes(p: Pending) {
    if (p.kind === "verification")
      // "Yes, please call Danny" answers the offer; it names only who was offered.
      return [p.name, "him", "her", "them"]
        .filter(Boolean)
        .flatMap((who) => [`call ${who}`, `check with ${who}`]);
    return p.kind === "schedule" && p.label ? [p.label] : [];
  }
  async offerSchedule(s: Session, p: Proposal, slotId: string) {
    const slot = p.slots.find((slot) => slot.id === slotId);
    assert(
      slot && p.status === "awaiting_senior",
      "SLOT_NOT_READY",
      "Family must agree to a slot first.",
    );
    const label = slot.localTimes[s.seniorId] || slot.startUtc;
    s.pending = { kind: "schedule", proposalId: p.id, slotId, label };
    s.pendingDelivered = false;
    return this.say(s, this.pendingSummary(s.pending));
  }
  async tool(
    s: Session,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      ["revise_mock_order", "repeat_mock_order"].includes(name) &&
      this.reasoner instanceof MockReasoner
    ) {
      if (s.privateStart)
        return {
          speak:
            "This part is private. Please start a new call to place an order.",
        };
      const orders = await this.deps.call<Order[]>(
        "money",
        "GET",
        `/orders?seniorId=${s.seniorId}`,
      );
      const previous = orders
        .filter(
          (o) =>
            o.id === s.lastOrderId &&
            o.seniorId === s.seniorId &&
            o.status === "approved",
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      assert(previous, "NO_DRAFT", "Please tell me the complete list again.");
      if (name === "repeat_mock_order") {
        const pending: Pending = previous.fulfilment?.unmatchedItems.length
          ? { kind: "unmatched", order: previous }
          : { kind: "order", order: previous };
        s.pending = pending;
        s.pendingDelivered = false;
        return { speak: this.pendingSummary(pending) };
      }
      const item = z.string().min(1).max(200).parse(args.item);
      return this.tool(s, "place_order", {
        ...previous.request,
        items: [...previous.request.items, { name: item, qty: 1 }],
      });
    }
    if (name === "mark_private") {
      s.privateStart ||=
        s.transcript.filter((t) => t.speaker === "senior").at(-1)?.ts ||
        new Date().toISOString();
      await this.store.save(s);
      return { speak: "I’ll keep this part private from your family." };
    }
    if (name === "get_order_status") {
      const orders = await this.deps.call<Order[]>(
        "money",
        "GET",
        "/orders?seniorId=" + s.seniorId,
      );
      const order = orders
        .filter((o) => o.seniorId === s.seniorId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!order) return { speak: "You don't have an order yet." };
      const delivery = order.fulfilment?.delivery;
      if (
        delivery?.status === "dry_run_complete" ||
        order.fulfilment?.provider === "mock"
      )
        return {
          speak: "This is a demo dry run. No real delivery has been placed.",
        };
      const descriptions: Record<string, string> = {
        picked_up: "Your order is out for delivery",
        placed: "Your delivery order has been placed",
        delivered: "Your order has been delivered",
        awaiting_live_checkout:
          "Your order needs a person's confirmation in the app before real delivery",
        cart_ready: "Your cart is ready for review",
        failed: "The delivery could not be completed",
      };
      if (delivery && descriptions[delivery.status])
        return {
          speak:
            descriptions[delivery.status] +
            (delivery.etaText &&
            ["placed", "picked_up"].includes(delivery.status)
              ? ", " + delivery.etaText
              : "") +
            ".",
        };
      const statuses: Record<Order["status"], string> = {
        approved: "Your order is ready for your confirmation.",
        paid: "Your order is paid. I don't have a delivery update yet.",
        held: "Your order is paused for family review.",
        cancelled: "Your order is cancelled.",
        draft: "Your order is still being prepared for review.",
      };
      return { speak: statuses[order.status] };
    }
    if (name === "check_budget")
      return this.deps.call("money", "GET", `/credentials/${s.seniorId}`);
    if (name === "get_family_context") {
      const [circle, rhythm] = await Promise.all([
        this.deps.call<Circle>("family", "GET", `/circle/${s.seniorId}`),
        this.deps.call("family", "GET", `/contact-rhythm/${s.seniorId}`),
      ]);
      return {
        senior: { id: circle.senior.id, name: circle.senior.name },
        members: circle.members.map(({ id, name, isVerifier }) => ({
          id,
          name,
          isVerifier,
        })),
        rhythm,
      };
    }
    if (name === "get_pending_proposals")
      return this.deps.call(
        "family",
        "GET",
        `/proposals/${s.seniorId}/pending-senior`,
      );
    // Private details must not reach any family-facing mutation or fraud notification.
    if (s.privateStart)
      return {
        speak:
          "This part is private. Let’s start a new call when you want to place an order or arrange family time.",
      };
    if (name === "place_order" || name === "precheck_purchase") {
      const req = orderRequest.parse({ ...args, seniorId: s.seniorId });
      if (req.type === "pharmacy_refill")
        return {
          speak:
            "I can’t check your existing prescriptions yet. Please contact your usual pharmacy or a family member.",
        };
      if (req.type === "gift") {
        const miaReason = s.transcript
          .filter((t) => t.speaker === "senior")
          .slice(-8)
          .map((t) => t.text)
          .reverse()
          .find((text) => /\bfor Mia\b|\bMia['’]s birthday\b/i.test(text));
        if (miaReason) {
          const circle = await this.deps.call<Circle>(
            "family",
            "GET",
            "/circle/" + s.seniorId,
          );
          const parent = circle.members.find(
            (m) =>
              m.id === "mem_lisa" &&
              (m.age === undefined || m.age >= 18) &&
              m.dependents?.some((d) => d.name === "Mia" && d.age < 18),
          );
          assert(
            parent,
            "PARENT_REQUIRED",
            "Mia's gift needs her parent in the circle.",
          );
          req.recipientMemberId = parent.id;
          req.context.statedReason = miaReason;
        }
      }
      req.context.transcriptExcerpt = s.transcript
        .filter((t) => t.speaker === "senior")
        .slice(-8)
        .map((t) => t.text)
        .join("\n")
        .slice(-12000);
      if (name === "precheck_purchase")
        return this.deps.call("money", "POST", "/fraud/assess", req);
      const order = await this.deps.call<Order>(
        "money",
        "POST",
        "/orders/draft",
        req,
      );
      assert(
        order.seniorId === s.seniorId,
        "WRONG_SENIOR",
        "Order belongs to another senior.",
      );
      s.lastOrderId = order.id;
      if (order.status === "held") {
        const circle = await this.deps.call<Circle>(
          "family",
          "GET",
          `/circle/${s.seniorId}`,
        );
        const member = circle.members.find(
          (m) =>
            m.id === order.fraud.suggestedVerifierId &&
            m.isVerifier &&
            (m.age === undefined || m.age >= 18),
        );
        if (order.holdId && member)
          s.pending = {
            kind: "verification",
            holdId: order.holdId,
            memberId: member.id,
            name: member.name,
          };
        s.pendingDelivered = false;
        return {
          speak: `${order.fraud.seniorFacingMessage} ${member ? `Would you like me to call ${member.name} on the family’s stored number?` : "A family member can help you check this in the app."} Remember to ask unexpected callers for your family’s private code word.`,
        };
      }
      assert(
        order.status === "approved" &&
          !order.fraud.hardStop &&
          order.fraud.risk !== "high",
        "NOT_APPROVED",
        "This order needs family review.",
      );
      const pending: Pending = order.fulfilment?.unmatchedItems.length
        ? { kind: "unmatched", order }
        : { kind: "order", order };
      s.pending = pending;
      s.pendingDelivered = false;
      return { speak: this.pendingSummary(pending) };
    }
    if (name === "start_verification_call") {
      const a = z
        .object({ holdId: z.string(), memberId: z.string() })
        .parse(args);
      await this.verificationContext(s.seniorId, a.holdId, a.memberId);
      s.pending = { kind: "verification", ...a };
      s.pendingDelivered = false;
      return { speak: this.pendingSummary(s.pending) };
    }
    if (name === "resolve_hold_verbal")
      throw new ApiError(
        403,
        "VERIFIER_REQUIRED",
        "Only the bound verifier callback may resolve a hold.",
      );
    if (name === "request_family_time") {
      const a = z
        .object({
          kind: z.enum(["video_call", "visit"]),
          who: z.array(z.string()).optional(),
          when: z.string().max(500).optional(),
          includeDependents: z.boolean().optional(),
        })
        .parse(args);
      const circle = await this.deps.call<Circle>(
        "family",
        "GET",
        `/circle/${s.seniorId}`,
      );
      assert(
        !a.who ||
          a.who.every((id) =>
            circle.members.some(
              (m) => m.id === id && (m.age === undefined || m.age >= 18),
            ),
          ),
        "UNKNOWN_MEMBER",
        "Only adult circle members can be contacted.",
      );
      await this.deps.call("family", "POST", "/schedule/request", {
        seniorId: s.seniorId,
        kind: a.kind,
        memberIds: a.who,
        includeDependents: a.includeDependents,
        initiatedBy: "senior",
        preferredWindow: a.when,
      });
      return {
        speak:
          "I’ve asked your family to find a time. I’ll confirm it with you after they reply.",
      };
    }
    if (name === "confirm_family_time") {
      const a = z
        .object({ proposalId: z.string(), slotId: z.string() })
        .parse(args);
      const proposals = await this.deps.call<Proposal[]>(
        "family",
        "GET",
        `/proposals/${s.seniorId}/pending-senior`,
      );
      const p = proposals.find((p) => p.id === a.proposalId);
      assert(
        p,
        "PROPOSAL_NOT_FOUND",
        "That proposal is not awaiting confirmation.",
      );
      // Avoid double appending: offerSchedule writes the canonical agent turn.
      const text = await this.offerSchedule(s, p, a.slotId);
      s.transcript.pop();
      return { speak: text };
    }
    throw new ApiError(400, "UNKNOWN_TOOL", "Unknown tool.");
  }
  async verificationContext(
    seniorId: string,
    holdId: string,
    memberId: string,
  ) {
    const [circle, holds, orders] = await Promise.all([
      this.deps.call<Circle>("family", "GET", `/circle/${seniorId}`),
      this.deps.call<Hold[]>("money", "GET", `/holds?seniorId=${seniorId}`),
      this.deps.call<Order[]>("money", "GET", `/orders?seniorId=${seniorId}`),
    ]);
    const member = circle.members.find(
      (m) =>
        m.id === memberId &&
        m.isVerifier &&
        (m.age === undefined || m.age >= 18),
    );
    const hold = holds.find(
      (h) => h.id === holdId && h.seniorId === seniorId && h.status === "open",
    );
    const order = orders.find(
      (o) => o.id === hold?.orderId && o.seniorId === seniorId,
    );
    assert(
      member && hold && order,
      "INVALID_VERIFICATION",
      "Open hold and stored adult verifier required.",
    );
    return { member, hold, order };
  }
  async resolveVerifier(s: Session, decision: "cancel" | "release") {
    const v = s.verification;
    assert(v, "VERIFIER_REQUIRED", "Verifier leg required.", 403);
    assert(!v.resolved, "ALREADY_RESOLVED", "Decision already processed.");
    const { order } = await this.verificationContext(
      s.seniorId,
      v.holdId,
      v.memberId,
    );
    assert(
      decision === "cancel" ||
        (order.fraud.risk !== "high" && !order.fraud.hardStop),
      "PASSKEY_REQUIRED",
      "A family member must approve this in the app.",
    );
    assert(!v.resolved, "ALREADY_RESOLVED", "Decision already processed.");
    v.resolved = true;
    await this.store.save(s);
    try {
      return await this.deps.call(
        "money",
        "POST",
        `/holds/${v.holdId}/resolve`,
        {
          decision,
          byMemberId: v.memberId,
          method: "verbal_on_verification_call",
        },
      );
    } catch (e) {
      /* Unknown outcome: do not replay a financial mutation. */ throw e;
    }
  }
  async end(s: Session) {
    if (!s.endedAt) {
      s.endedAt = new Date(
        Math.max(Date.now(), (s.lastTs || 0) + 1),
      ).toISOString();
      if (s.privateStart)
        s.privateSpans.push({ startTs: s.privateStart, endTs: s.endedAt });
      await this.store.save(s);
    }
    const {
      callId,
      seniorId,
      kind,
      startedAt,
      endedAt,
      transcript,
      privateSpans,
    } = s;
    await this.store.enqueue(`call-ended:${callId}`, {
      callId,
      seniorId,
      kind,
      startedAt,
      endedAt,
      transcript,
      privateSpans,
    });
  }
  private flushing = false;
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const [id, job] of this.store.jobs) {
        if (job.done || !id.startsWith("call-ended:")) continue;
        try {
          await this.deps.call(
            "family",
            "POST",
            "/webhooks/call-ended",
            job.payload,
          );
          await this.store.mark(id, true);
        } catch {
          await this.store.mark(id, false);
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
