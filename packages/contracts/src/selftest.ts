/** Runtime self-test: realistic contract objects parse; contract violations are rejected. */
import * as S from "./schemas";
import type { Order, Message, Proposal } from "./types";

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
ok("ContactRhythm everAskedForMoney:true rejected (literal false per contract)",
  !S.ContactRhythmSchema.safeParse({ seniorId: "sen_rose", perMember: [{ memberId: "mem_danny", callsLast30d: 4, everAskedForMoney: true }] }).success);
ok("Health parses", S.HealthSchema.safeParse({ ok: true, service: "money", mock: true }).success);
ok("Error body parses", S.ErrorBodySchema.safeParse({ error: { code: "HOLD_HIGH_RISK", message: "Passkey required" } }).success);

if (failures) { console.error(`\n✗ ${failures} failed`); process.exit(1); }
console.log("\n✓ contracts self-test passed");
