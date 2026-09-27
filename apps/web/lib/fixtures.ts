/**
 * Sample data shown ONLY when a service is unreachable, always under a visible
 * "sample data" banner. Every object is typed against CONTRACTS.md §3, and action
 * payloads follow the D5 shapes (CONTRACTS-ADDENDUM.md).
 */
import type { Hold, Message, Order, ScheduledCall, Slot } from "@care-circle/contracts";

const t = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

const slots: Slot[] = [
  { id: "slot_a", startUtc: "2026-09-27T20:00:00Z", endUtc: "2026-09-27T20:45:00Z", reason: "After church and her nap; Mia is out of school",
    localTimes: { sen_rose: "Sun 4:00 PM", mem_lisa: "Sun 3:00 PM", mem_danny: "Sun 2:00 PM" } },
  { id: "slot_b", startUtc: "2026-09-28T23:30:00Z", endUtc: "2026-09-29T00:15:00Z", reason: "Monday evening, after Mia's homework",
    localTimes: { sen_rose: "Mon 7:30 PM", mem_lisa: "Mon 6:30 PM", mem_danny: "Mon 5:30 PM" } },
  { id: "slot_c", startUtc: "2026-10-01T15:30:00Z", endUtc: "2026-10-01T16:15:00Z", reason: "Rose's best time of day; Danny is free before work",
    localTimes: { sen_rose: "Thu 11:30 AM", mem_lisa: "Thu 10:30 AM", mem_danny: "Thu 9:30 AM" } },
];

const proposal = (to: string, body: string, minsAgo: number): Message => ({
  id: `msg_fx_prop_${to}`, toMemberId: to, direction: "out", kind: "schedule_proposal", createdAt: t(minsAgo), body,
  actions: slots.map((s) => ({ label: s.localTimes[to] ?? s.localTimes.sen_rose!, action: "accept_slot", payload: { proposalId: "prop_fx", slotId: s.id, slot: s } })),
});

export const SAMPLE_MESSAGES: Record<string, Message[]> = {
  mem_lisa: [
    { id: "msg_fx_l1", toMemberId: "mem_lisa", direction: "out", kind: "receipt", createdAt: t(42),
      body: "Rose's Kroger order is paid: milk, wheat bread, eggs, bananas. $23.40.", mediaUrl: "#receipt" },
    { id: "msg_fx_l2", toMemberId: "mem_lisa", direction: "out", kind: "add_to_order", createdAt: t(41),
      body: "Mom just ordered groceries for Thursday. Want to add something? Her tomatoes came in this week.",
      actions: [
        { label: "Add a pastry from Sweet Crumb", action: "add_item", payload: { orderId: "ord_fx_groc", merchantId: "mer_crumb", item: "Almond croissant", priceCents: 450 } },
        { label: "Not this time", action: "dismiss", payload: { orderId: "ord_fx_groc" } },
      ] },
    { id: "msg_fx_l3", toMemberId: "mem_lisa", fromMemberId: "mem_lisa", direction: "in", kind: "text", createdAt: t(40), body: "Add the croissant! She loves those." },
    proposal("mem_lisa", "Mom said she'd love to see the kids. Here are three times that work for everyone, including Mia after school.", 20),
    { id: "msg_fx_l4", toMemberId: "mem_lisa", direction: "out", kind: "nudge", createdAt: t(3),
      body: "Danny's checking on something with Mom. Nothing to do right now; we'll tell you how it goes." },
  ],
  mem_danny: [
    proposal("mem_danny", "Grandma would love a video call with you, Lisa, and Mia. Pick a time that works:", 20),
    { id: "msg_fx_d1", toMemberId: "mem_danny", direction: "out", kind: "fraud_card", createdAt: t(2),
      body: "We paused a $500 gift card purchase. Someone called Rose claiming to be her grandson in trouble and told her not to tell his mom. You're on file as her grandson, and this isn't in any family chat.",
      actions: [
        { label: "That wasn't me: cancel it", action: "cancel_hold", payload: { orderId: "ord_fx_scam", holdId: "hold_fx_scam" } },
        { label: "It was me: approve in app", action: "release_hold", payload: { orderId: "ord_fx_scam", holdId: "hold_fx_scam" } },
      ] },
  ],
  mem_mark: [
    { id: "msg_fx_m1", toMemberId: "mem_mark", direction: "out", kind: "briefing", createdAt: t(90),
      body: "Before Sunday's call: Mom's tomatoes came in, and she's a bit worried about Buddy's vet visit on Tuesday." },
    { id: "msg_fx_m2", toMemberId: "mem_mark", fromMemberId: "mem_mark", direction: "in", kind: "voice_note", createdAt: t(85),
      body: "Voice note for Mum (0:14)", mediaUrl: "" },
  ],
};

const fraudBase = { seniorFacingMessage: "", familyFacingSummary: "" };

export const SAMPLE_ORDERS: Order[] = [
  {
    id: "ord_fx_scam", seniorId: "sen_rose", status: "held", holdId: "hold_fx_scam", createdAt: t(2),
    request: { seniorId: "sen_rose", type: "gift", payeeDescription: "Target gift cards", amountCents: 50000,
      items: [{ name: "Target gift card", qty: 5, priceCents: 10000 }],
      context: { transcriptExcerpt: "He needs five hundred dollars in Target gift cards… He said not to tell his mom.", claimedRelative: "my grandson", urgencyOrSecrecy: true } },
    fraud: {
      ...fraudBase, risk: "high", score: 97, hardStop: true, typology: "grandparent_impostor", recommendedAction: "hold", suggestedVerifierId: "mem_danny",
      seniorFacingMessage: "This looks like a trick a lot of people get calls about. Let's check with Danny first. Want me to call him now?",
      familyFacingSummary: "Someone claiming to be Rose's grandson asked her for $500 in gift cards and told her to keep it from his mom. We paused it and are calling Danny on his number on file.",
      signals: [
        { layer: 1, code: "GIFT_CARD_NONMEMBER", description: "Gift cards for someone outside the circle", weight: 40 },
        { layer: 1, code: "SECRECY_LANGUAGE", description: "“Don't tell his mom”", weight: 25 },
        { layer: 2, code: "TYPOLOGY_GRANDPARENT", description: "Grandchild in trouble, urgent, gift cards: matches the grandparent-impostor script", weight: 20 },
        { layer: 3, code: "AMOUNT_ANOMALY", description: "$500 is 21× Rose's median order ($23.40)", weight: 7 },
        { layer: 4, code: "NOT_IN_FAMILY_CHANNELS", description: "Danny called Sunday as usual, has never asked for money, and no family chat mentions an emergency", weight: 5 },
      ],
    },
  },
  {
    id: "ord_fx_mia", seniorId: "sen_rose", status: "paid", createdAt: t(300), receiptUrl: "#receipt",
    request: { seniorId: "sen_rose", type: "gift", merchantId: "mer_crumb", recipientMemberId: "mem_lisa", amountCents: 2500,
      items: [{ name: "Sweet Crumb gift card", qty: 1, priceCents: 2500 }],
      context: { statedReason: "For Mia's birthday", transcriptExcerpt: "Mia's birthday is coming up. She's turning ten!" } },
    fraud: { ...fraudBase, risk: "low", score: 8, hardStop: false, recommendedAction: "proceed",
      familyFacingSummary: "Birthday gift for Mia, sent through Lisa. Normal amount for Rose.",
      signals: [{ layer: 3, code: "GIFT_NORMAL_AMOUNT", description: "$25 is in line with Rose's past gifts", weight: 0 }] },
  },
  {
    id: "ord_fx_groc", seniorId: "sen_rose", status: "paid", createdAt: t(42), receiptUrl: "#receipt",
    fulfilment: { provider: "mock", storeName: "Kroger (demo)", quoteId: "q_fx", unmatchedItems: ["Saffron"],
      delivery: { deliveryId: "del_fx", status: "dry_run_complete", etaText: "25-35 min" } },
    request: { seniorId: "sen_rose", type: "groceries", merchantId: "mer_freshmart", amountCents: 2340,
      items: [{ name: "Milk", qty: 1 }, { name: "Wheat bread", qty: 1 }, { name: "Eggs", qty: 1 }, { name: "Bananas", qty: 1 }],
      context: { transcriptExcerpt: "A gallon of milk, a loaf of wheat bread, a dozen eggs, and some bananas." } },
    fraud: { ...fraudBase, risk: "low", score: 2, hardStop: false, recommendedAction: "proceed", signals: [] },
  },
];

export const SAMPLE_HOLDS: Hold[] = [
  { id: "hold_fx_scam", orderId: "ord_fx_scam", seniorId: "sen_rose", status: "open", createdAt: t(2), coolingOffUntil: new Date(Date.now() + 24 * 3600_000).toISOString() },
];

export const SAMPLE_UPCOMING: ScheduledCall[] = [
  { id: "sch_fx", proposalId: "prop_fx", seniorId: "sen_rose", memberIds: ["mem_lisa", "mem_danny"], startUtc: slots[0]!.startUtc,
    roomName: "rose-sunday", roomJoinUrl: "/call/sch_fx", seniorJoin: "phone_dialout", recurring: "weekly", status: "scheduled" },
];

export const SAMPLE_MOMENTS = { calls: 4, voiceNotes: 3, gifts: 1, addedItems: 2, scamsStopped: 1, savedCents: 50000 };
