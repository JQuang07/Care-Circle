/**
 * TESTS THE TESTS. An in-memory stand-in for voice, money, family, and delivery that follows
 * CONTRACTS.md plus CONTRACTS-ADDENDUM.md, so `pnpm e2e:selftest` can prove each scenario
 * CAN pass before we blame a real service. It is not a reference implementation:
 * keyword matching stands in for Muse, and nothing here is used by the product.
 * Runs on 5001–5004 so it never collides with the real services on 4001–4004.
 */
import Fastify, { type FastifyInstance } from "fastify";
import type {
  DeliveryOrder, DeliveryStatus, Hold, Message, Order, OrderRequest, Proposal, ScheduledCall, SimulateVerificationRequest, Slot,
} from "@care-circle/contracts";

const PORTS = { voice: 5001, money: 5002, family: 5003, delivery: 5004 };
/** Mutation testing: FAKE_BUG plants one known bug so selftest can prove the suite catches it. */
const BUG = process.env.FAKE_BUG ?? "";
let seq = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;
const now = () => new Date().toISOString();

// ── money ──────────────────────────────────────────────────────────────────
const orders: Order[] = [];
const holds: Hold[] = [];

function assess(req: OrderRequest): Order["fraud"] {
  const text = req.context.transcriptExcerpt.toLowerCase();
  const giftCard = /gift card/.test(text);
  const nonMember = giftCard && !req.recipientMemberId;
  const secrecy = /not to tell|don't tell|keep it secret/.test(text);
  if ((nonMember || secrecy) && BUG !== "scam-paid") {
    const signals = [
      ...(nonMember ? [{ layer: 1 as const, code: "GIFT_CARD_NONMEMBER", description: "Gift cards for someone outside the circle", weight: 40 }] : []),
      ...(secrecy ? [{ layer: 1 as const, code: "SECRECY_LANGUAGE", description: "Asked to keep it secret", weight: 25 }] : []),
      { layer: 2 as const, code: "TYPOLOGY", description: "Matches a known scam script", weight: 20 },
      { layer: 3 as const, code: "AMOUNT_ANOMALY", description: "Far above Rose's median order", weight: 7 },
      { layer: 4 as const, code: "NOT_IN_FAMILY_CHANNELS", description: "No family channel mentions this", weight: 5 },
    ];
    return {
      risk: "high", score: Math.min(100, signals.reduce((a, s) => a + s.weight, 0)), hardStop: true,
      typology: /medicare|government/.test(text) ? "government_impostor" : "grandparent_impostor", signals,
      recommendedAction: "hold", suggestedVerifierId: "mem_danny",
      seniorFacingMessage: "This looks like a trick a lot of people get calls about. Let's check with Danny first.",
      familyFacingSummary: "Someone asked Rose for gift cards and to keep it quiet, so we paused it.",
    };
  }
  return { risk: "low", score: 3, hardStop: false, signals: [], recommendedAction: "proceed", seniorFacingMessage: "", familyFacingSummary: "" };
}

function placeOrder(req: OrderRequest): Order {
  const fraud = assess(req);
  const o: Order = { id: id("ord"), seniorId: req.seniorId, request: req, status: fraud.hardStop ? "held" : "approved", fraud, createdAt: now() };
  orders.push(o);
  if (o.status === "held") {
    const h: Hold = { id: id("hold"), orderId: o.id, seniorId: o.seniorId, status: "open", createdAt: now(), coolingOffUntil: new Date(Date.now() + 864e5).toISOString() };
    holds.push(h);
    o.holdId = h.id;
    family.onHold(o, h);
  } else {
    o.status = "paid";
    o.receiptUrl = `https://receipts.example/${o.id}`;
    family.onPaid(o);
    if (o.request.type === "groceries") delivery.fulfil(o);
  }
  return o;
}

/** A scam order that lands late, stamped before the current scenario began (the E2E 4 regression). */
function strayLateScam() {
  const req: OrderRequest = { seniorId: "sen_rose", type: "gift", payeeDescription: "Gift cards", amountCents: 50000,
    items: [{ name: "Gift card", qty: 1 }], context: { transcriptExcerpt: "gift cards, don't tell his mom" } };
  orders.push({ id: id("ord"), seniorId: "sen_rose", request: req, status: "held", fraud: assess(req),
    createdAt: new Date(Date.now() - 60_000).toISOString() });
}

// ── delivery (D14, mock provider) ──────────────────────────────────────────
const deliveries: DeliveryOrder[] = [];
const delivery = {
  fulfil(o: Order) {
    const d: DeliveryOrder = { deliveryId: id("del"), orderId: o.id, seniorId: o.seniorId, quoteId: id("q"), provider: "mock",
      status: "dry_run_complete", cartTotalCents: o.request.amountCents, approvedAmountCents: o.request.amountCents,
      storeName: "FreshMart (mock)", etaText: "about 45 minutes", createdAt: now(), updatedAt: now() };
    deliveries.push(d);
    o.fulfilment = { provider: "mock", storeName: d.storeName, quoteId: d.quoteId, unmatchedItems: [],
      delivery: { deliveryId: d.deliveryId, status: d.status, etaText: d.etaText } };
  },
  advance(d: DeliveryOrder, to: DeliveryStatus) {
    d.status = to;
    d.updatedAt = now();
    // delivery-status event → money + family
    const o = orders.find((x) => x.id === d.orderId);
    if (o?.fulfilment?.delivery && BUG !== "no-delivery-event") o.fulfilment.delivery.status = to;
    if (to === "delivered" && BUG !== "no-delivery-event") say("mem_lisa", "text", "Rose's groceries arrived.");
  },
};

// ── family ─────────────────────────────────────────────────────────────────
const messages: Message[] = [];
const proposals: Proposal[] = [];
const scheduled: ScheduledCall[] = [];
let scamsStopped = 0;
let savedCents = 0;
const lastPublicDetail: string[] = [];

const say = (to: string, kind: Message["kind"], body: string, actions?: Message["actions"]) =>
  messages.push({ id: id("msg"), toMemberId: to, direction: "out", kind, body, actions, createdAt: now() });

const TZ: Record<string, string> = { sen_rose: "America/New_York", mem_lisa: "America/Chicago", mem_danny: "America/Denver", mem_mark: "Europe/London" };
const fmt = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function nextSlots(): Slot[] {
  // Next Sunday 20:00Z (Sun 4 PM ET in summer), Monday 23:30Z, Thursday 15:30Z.
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  const sun = new Date(d.getTime() + (((7 - d.getUTCDay()) % 7) || 7) * 864e5);
  const at = (days: number, h: number, m: number) => new Date(sun.getTime() + days * 864e5 + (h * 60 + m) * 6e4).toISOString();
  return (BUG === "nap" ? [[0, 18, 0], [1, 23, 30], [4, 15, 30]] : [[0, 20, 0], [1, 23, 30], [4, 15, 30]]).map(([dd, h, m]) => {
    const startUtc = at(dd!, h!, m!);
    return { id: id("slot"), startUtc, endUtc: new Date(Date.parse(startUtc) + 45 * 6e4).toISOString(), reason: "Everyone is free",
      localTimes: Object.fromEntries(["sen_rose", "mem_lisa", "mem_danny"].map((w) => [w, fmt(startUtc, BUG === "tz" ? "America/New_York" : TZ[w]!)])) };
  });
}

const family = {
  onPaid(o: Order) {
    say("mem_lisa", "receipt", `Rose's order is paid: $${(o.request.amountCents / 100).toFixed(2)}.`);
    const hook = lastPublicDetail.shift();
    say("mem_lisa", "add_to_order", `Mom just placed an order. Want to add something?${hook ? ` She mentioned: ${hook}` : ""}`,
      [{ label: "Add a pastry", action: "add_item", payload: { orderId: o.id } }]);
  },
  onHold(o: Order, h: Hold) {
    say(o.fraud.suggestedVerifierId!, "fraud_card", o.fraud.familyFacingSummary,
      [{ label: "Cancel it", action: "cancel_hold", payload: { orderId: o.id, holdId: h.id } }]);
  },
  request(): Proposal {
    const p: Proposal = { id: id("prop"), seniorId: "sen_rose", kind: "video_call", memberIds: ["mem_lisa", "mem_danny"], includesDependents: ["Mia"],
      initiatedBy: "senior", slots: nextSlots(), responses: [], status: "proposed" };
    proposals.push(p);
    for (const m of p.memberIds)
      say(m, "schedule_proposal", "Rose would love to see you. Pick a time:",
        p.slots.map((s) => ({ label: s.localTimes[m]!, action: "accept_slot", payload: { proposalId: p.id, slotId: s.id, slot: s } })));
    return p;
  },
};

// ── voice ──────────────────────────────────────────────────────────────────
const calls: { callId: string; kind: string; purpose?: string; scheduledCallId?: string; startedAt: string }[] = [];

function simulateInbound(script: string[]) {
  // mark_private(): drop the "keep this between us" line before anything leaves voice.
  const publicLines = BUG === "leak" ? script : script.filter((l) => !/keep this between us/i.test(l));
  const text = publicLines.join(" ");
  const low = text.toLowerCase();
  const detail = publicLines.find((l) => /pie|tomato|dizzy/i.test(l));
  if (detail) lastPublicDetail.push(detail);
  const base = { seniorId: "sen_rose", context: { transcriptExcerpt: text } };
  if (/see the kids/.test(low)) family.request();
  else if (/sounds lovely/.test(low)) {
    const p = proposals.find((x) => x.status === "awaiting_senior");
    if (p) confirmSenior(p, p.confirmedSlotId!);
  } else if (/grandson|medicare/.test(low)) placeOrder({ ...base, type: "gift", payeeDescription: "Gift cards", amountCents: /medicare/.test(low) ? 30000 : 50000, items: [{ name: "Gift card", qty: 1 }] });
  else if (/mia/.test(low)) strayLateScam(), placeOrder({ ...base, type: "gift", merchantId: "mer_crumb", recipientMemberId: "mem_lisa", amountCents: BUG === "dollars" ? 25 : 2500, items: [{ name: "Gift card", qty: 1 }] });
  else if (/groceries/.test(low)) placeOrder({ ...base, type: "groceries", merchantId: "mer_freshmart", amountCents: 2340, items: [{ name: "Milk", qty: 1 }] });
  const c = { callId: id("call"), kind: "inbound", startedAt: now() };
  calls.push(c);
  return { callId: c.callId };
}

function confirmSenior(p: Proposal, slotId: string): ScheduledCall {
  const slot = p.slots.find((s) => s.id === slotId)!;
  const sc: ScheduledCall = { id: id("sch"), proposalId: p.id, seniorId: p.seniorId, memberIds: p.memberIds, startUtc: slot.startUtc,
    roomName: `room-${p.id}`, roomJoinUrl: `http://localhost:3000/call/${p.id}`, seniorJoin: "phone_dialout", status: "scheduled" };
  scheduled.push(sc);
  p.status = "confirmed";
  p.scheduledCallId = sc.id;
  return sc;
}

// ── HTTP ───────────────────────────────────────────────────────────────────
function app(name: string, reset: () => void, health: () => object = () => ({ ok: true, service: name, mock: true })): FastifyInstance {
  const a = Fastify();
  a.get("/health", async () => health());
  a.post("/demo/reset", async () => { reset(); return { ok: true }; });   // D1
  return a;
}
const clear = (...xs: unknown[][]) => xs.forEach((x) => (x.length = 0));

const voice = app("voice", () => clear(calls));
voice.post<{ Body: { script: string[] } }>("/demo/simulate-inbound", async (r) => simulateInbound(r.body.script));
voice.post<{ Body: SimulateVerificationRequest }>("/demo/simulate-verification", async (r) => {
  const c = { callId: id("call"), kind: "verification", startedAt: now() };
  calls.push(c);
  if (/cancel|wasn't me/i.test(r.body.script.map((l) => l.text).join(" "))) {
    const h = holds.find((x) => x.id === r.body.holdId)!;
    const o = orders.find((x) => x.id === h.orderId)!;
    h.status = BUG === "release" ? "released" : "cancelled";
    h.resolution = { decision: BUG === "release" ? "release" : "cancel", byMemberId: r.body.memberId, method: "verbal_on_verification_call", at: now() };
    o.status = "cancelled";
    if (BUG !== "moments") scamsStopped++;
    savedCents += o.request.amountCents;
  }
  return { callId: c.callId };
});
voice.get("/demo/calls", async () => calls);

const money = app("money", () => clear(orders, holds));
money.get("/orders", async () => orders);
money.get<{ Params: { id: string } }>("/orders/:id", async (r, reply) => orders.find((o) => o.id === r.params.id) ?? reply.code(404).send({ error: { code: "NOT_FOUND", message: r.params.id } }));
money.get("/holds", async () => holds);

const fam = app("family", () => { clear(messages, proposals, scheduled, lastPublicDetail); scamsStopped = 0; savedCents = 0; });
fam.get<{ Querystring: { memberId: string } }>("/messages", async (r) => messages.filter((m) => m.toMemberId === r.query.memberId));
fam.post<{ Params: { id: string }; Body: { action: string; payload: { proposalId: string; slotId: string } } }>("/messages/:id/act", async (r) => {
  const msg = messages.find((m) => m.id === r.params.id)!;
  const p = proposals.find((x) => x.id === r.body.payload.proposalId);
  if (r.body.action === "accept_slot" && p) {
    p.responses.push({ memberId: msg.toMemberId, slotId: r.body.payload.slotId, accept: true });
    const agreed = p.memberIds.every((m) => p.responses.some((x) => x.memberId === m && x.slotId === r.body.payload.slotId));
    if (agreed) { p.status = "awaiting_senior"; p.confirmedSlotId = r.body.payload.slotId; }
  }
  return { ok: true };
});
fam.get("/proposals/:seniorId/pending-senior", async () => proposals.filter((p) => p.status === "awaiting_senior"));
fam.get("/schedule/:seniorId/upcoming", async () => scheduled);
fam.get("/moments/:seniorId", async () => ({ calls: 0, voiceNotes: 0, gifts: 0, addedItems: 0, scamsStopped, savedCents }));
fam.post<{ Body: { scheduledCallId: string } }>("/demo/fire-due", async (r) => {
  const sc = scheduled.find((s) => s.id === r.body.scheduledCallId)!;
  sc.status = "ringing";
  calls.push({ callId: id("call"), kind: "outbound", purpose: "scheduled_family_call", scheduledCallId: sc.id, startedAt: now() });
  return { ok: true };
});

const del = app("delivery", () => clear(deliveries), () => ({ ok: true, service: "delivery", mock: true,
  provider: BUG === "live-provider" ? "doordash_thirdparty" : "mock", liveCheckout: BUG === "live-provider" }));
del.get("/orders", async () => deliveries);
del.post<{ Params: { id: string }; Body: { to: DeliveryStatus } }>("/demo/advance/:id", async (r, reply) => {
  const d = deliveries.find((x) => x.deliveryId === r.params.id);
  if (!d) return reply.code(404).send({ error: { code: "NOT_FOUND", message: r.params.id } });
  delivery.advance(d, r.body.to);
  return d;
});

await Promise.all([
  voice.listen({ port: PORTS.voice }), money.listen({ port: PORTS.money }),
  fam.listen({ port: PORTS.family }), del.listen({ port: PORTS.delivery }),
]);
console.log(`fake stack up on ${Object.values(PORTS).join(", ")}`);
