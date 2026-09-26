/** Runtime self-test: realistic contract objects parse; contract violations are rejected. */
import * as S from "./schemas";
import type { Order, Message, Proposal, Circle, Quote, DeliveryOrder } from "./types";

let failures = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
};

const order: Order = {
  id: "ord_1", seniorId: "sen_rose", status: "held", holdId: "hold_1", createdAt: "2026-09-25T15:00:00Z",
  request: {
    seniorId: "sen_rose", type: "gift", payeeDescription: "Target gift cards", amountCents: 50000,
    items: [{ name: "Target gift card", qty: 5, priceCents: 10000 }],
    context: { transcriptExcerpt: "he said not to tell his mom", claimedRelative: "my grandson", urgencyOrSecrecy: true },
  },
  fraud: {
    risk: "high", score: 96, hardStop: true, typology: "grandparent_impostor",
    signals: [{ layer: 1, code: "GIFT_CARD_NONMEMBER", description: "Gift cards to someone outside the circle", weight: 100 }],
    recommendedAction: "hold", suggestedVerifierId: "mem_danny",
    seniorFacingMessage: "This looks like a trick a lot of people get calls about. Let's check with Danny first.",
    familyFacingSummary: "Rose was asked for $500 in gift cards by someone claiming to be her grandson.",
  },
};
ok("Order parses", S.OrderSchema.safeParse(order).success);
ok("float cents rejected (§0 integer cents)", !S.OrderSchema.safeParse({ ...order, request: { ...order.request, amountCents: 500.5 } }).success);
ok("score > 100 rejected", !S.FraudAssessmentSchema.safeParse({ ...order.fraud, score: 101 }).success);
ok("layer 5 rejected", !S.FraudSignalSchema.safeParse({ layer: 5, code: "x", description: "x", weight: 1 }).success);
ok("unknown order status rejected", !S.OrderSchema.safeParse({ ...order, status: "pending" }).success);
ok("extra keys stripped, not rejected", S.OrderSchema.safeParse({ ...order, extra: 1 }).success);

const msg: Message = {
  id: "msg_1", toMemberId: "mem_lisa", direction: "out", kind: "schedule_proposal", body: "Three times that work",
  actions: [{ label: "Sun 3:00 PM", action: "accept_slot", payload: { proposalId: "prop_1", slotId: "slot_1" } }],
  createdAt: "2026-09-25T15:00:00Z",
};
ok("Message parses", S.MessageSchema.safeParse(msg).success);
ok("unknown message kind rejected", !S.MessageSchema.safeParse({ ...msg, kind: "sticker" }).success);

const proposal: Proposal = {
  id: "prop_1", seniorId: "sen_rose", kind: "video_call", memberIds: ["mem_lisa", "mem_danny"], includesDependents: ["Mia"],
  initiatedBy: "senior", responses: [], status: "proposed",
  slots: [{ id: "slot_1", startUtc: "2026-09-27T20:00:00Z", endUtc: "2026-09-27T20:45:00Z", reason: "After church and nap",
            localTimes: { sen_rose: "Sun 4:00 PM", mem_lisa: "Sun 3:00 PM", mem_danny: "Sun 2:00 PM" } }],
};
ok("Proposal parses", S.ProposalSchema.safeParse(proposal).success);
ok("ContactRhythm everAskedForMoney is boolean (D6)",
  S.ContactRhythmSchema.safeParse({ seniorId: "sen_rose", perMember: [{ memberId: "mem_danny", callsLast30d: 4, everAskedForMoney: true }] }).success &&
  !S.ContactRhythmSchema.safeParse({ seniorId: "sen_rose", perMember: [{ memberId: "mem_danny", callsLast30d: 4, everAskedForMoney: "no" }] }).success);
ok("Health parses", S.HealthSchema.safeParse({ ok: true, service: "money", mock: true }).success);
ok("Error body parses", S.ErrorBodySchema.safeParse({ error: { code: "HOLD_HIGH_RISK", message: "Passkey required" } }).success);

// ─── Addendum ──────────────────────────────────────────────────────────────
ok("Order with D9 fulfilment parses", S.OrderSchema.safeParse({
  ...order, status: "paid",
  fulfilment: { provider: "mock", storeName: "FreshMart (mock)", quoteId: "q_1", unmatchedItems: ["saffron"],
                delivery: { deliveryId: "del_1", status: "dry_run_complete", etaText: "about 45 min" } },
}).success);
ok("fulfilment with unknown delivery status rejected", !S.OrderSchema.safeParse({
  ...order, fulfilment: { provider: "mock", storeName: "x", unmatchedItems: [], delivery: { deliveryId: "d", status: "lost" } },
}).success);
ok("OrderRequest scheduledFor (D11) kept", S.OrderRequestSchema.parse({ ...order.request, type: "ride", scheduledFor: "2026-09-27T14:00:00Z" }).scheduledFor === "2026-09-27T14:00:00Z");

const circle: Circle = {
  senior: { id: "sen_rose", name: "Rose", age: 81, tz: "America/New_York", phone: "+1555010000", language: "en",
            routine: [{ label: "nap", days: "daily", start: "13:00", end: "15:00" }] },
  members: [{ id: "mem_lisa", name: "Lisa", relation: "daughter", tz: "America/Chicago", phone: "+1555010001", whatsapp: true, isVerifier: true,
              dependents: [{ name: "Mia", age: 9, schoolHours: "08:00-15:30 mon-fri", birthday: "10-14" }] }],
  seniorHints: [{ text: "Loves talking about her garden", createdAt: "2026-09-25T15:00:00Z" }],
};
ok("Circle with D7 birthday + D11 seniorHints parses", S.CircleSchema.parse(circle).members[0]!.dependents![0]!.birthday === "10-14");

ok("D5 schedule_proposal payload parses", S.MESSAGE_ACTIONS.schedule_proposal.payload.safeParse({ proposalId: "prop_1", slotId: "slot_1", slot: proposal.slots[0] }).success);
ok("D5 fraud_card payload without holdId rejected", !S.MESSAGE_ACTIONS.fraud_card.payload.safeParse({ orderId: "ord_1" }).success);
ok("D5 act request keeps stored payload + client extras",
  (() => { const r = S.MessageActRequestSchema.safeParse({ action: "release_hold", payload: { orderId: "ord_1", holdId: "hold_1", passkeyAssertion: "sim" } });
           return r.success && r.data.payload.holdId === "hold_1" && r.data.payload.passkeyAssertion === "sim"; })());
ok("D5 unknown action rejected", !S.MessageActRequestSchema.safeParse({ action: "wire_money", payload: {} }).success);

ok("D2 time-travel both forms parse",
  S.TimeTravelRequestSchema.safeParse({ nowUtc: "2026-09-27T19:55:00Z" }).success &&
  S.TimeTravelRequestSchema.safeParse({ to: "next_call", minutesBefore: 5 }).success &&
  !S.TimeTravelRequestSchema.safeParse({ to: "tomorrow" }).success);
ok("D4 scheduled_call.due needs phase", !S.ScheduledCallDueSchema.safeParse({
  id: "sch_1", proposalId: "prop_1", seniorId: "sen_rose", memberIds: [], startUtc: "x", roomName: "r", roomJoinUrl: "u", seniorJoin: "tablet", status: "scheduled",
}).success);
ok("D8 cancel without passkey parses", S.HoldResolveRequestSchema.safeParse({ decision: "cancel", byMemberId: "mem_danny", method: "passkey_web" }).success);

const quote: Quote = {
  quoteId: "q_1", provider: "mock", kind: "grocery", storeName: "FreshMart (mock)", storeId: "st_1",
  lines: [
    { requested: "milk", qty: 1, status: "matched", matched: { name: "Whole milk 1 gal", priceCents: 429, qty: 1 } },
    { requested: "bread", qty: 1, status: "ambiguous", options: [{ name: "White", priceCents: 299 }, { name: "Wheat", priceCents: 349 }] },
    { requested: "saffron", qty: 1, status: "not_found" },
  ],
  subtotalCents: 429, feesCents: 863, totalCents: 1292, expiresAt: "2026-09-25T15:15:00Z",
};
ok("D14 Quote parses", S.QuoteSchema.safeParse(quote).success);
ok("D14 ambiguous line with >3 options rejected", !S.QuoteLineSchema.safeParse({
  requested: "x", qty: 1, status: "ambiguous", options: [1, 2, 3, 4].map((n) => ({ name: `o${n}`, priceCents: n })),
}).success);
const delivery: DeliveryOrder = {
  deliveryId: "del_1", orderId: "ord_1", seniorId: "sen_rose", quoteId: "q_1", provider: "mock", status: "dry_run_complete",
  cartTotalCents: 1292, approvedAmountCents: 1292, storeName: "FreshMart (mock)", createdAt: "x", updatedAt: "x",
};
ok("D14 DeliveryOrder parses", S.DeliveryOrderSchema.safeParse(delivery).success);
ok("D14 checkout needs a non-empty confirmedBy", !S.DeliveryCheckoutRequestSchema.safeParse({ confirmedBy: "" }).success);
ok("D14 delivery /health parses",
  S.DeliveryHealthSchema.safeParse({ ok: true, service: "delivery", mock: true, provider: "mock", liveCheckout: false }).success);

if (failures) { console.error(`\n✗ ${failures} failed`); process.exit(1); }
console.log("\n✓ contracts self-test passed");
