/**
 * CONTRACTS.md §3 — Shared types, plus docs/CONTRACTS-ADDENDUM.md (v1.0.2), which wins
 * where they disagree. Do not edit by hand: change the contract first (human only), then
 * mirror it here AND in schemas.ts. `schemas.ts` has compile-time checks that fail if the
 * two ever drift. Addendum additions are tagged with their decision number (D5, D9, …).
 */

export type OrderType = "groceries" | "ride" | "gift" | "pharmacy_refill" | "other";

export interface OrderRequest {
  seniorId: string;
  type: OrderType;
  merchantId?: string;             // absent if unknown or new payee
  payeeDescription?: string;       // e.g. "Target gift cards", "man named Kevin"
  items: { name: string; qty: number; priceCents?: number }[];
  amountCents: number;
  recipientMemberId?: string;      // for gifts to circle members (D7: a dependent's gift goes to the parent)
  scheduledFor?: string;           // D11: ISO UTC, rides
  context: {
    statedReason?: string;         // Rose's own words about WHY
    transcriptExcerpt: string;     // last ~60s of conversation
    claimedRelative?: string;      // e.g. "my grandson" / "Danny"
    urgencyOrSecrecy?: boolean;    // voice agent's quick flag
  };
}

export type ScamTypology = "grandparent_impostor" | "government_impostor" | "tech_support" |
  "prize_lottery" | "romance" | "investment" | "cash_courier" | "unknown";

export interface FraudSignal { layer: 1|2|3|4; code: string; description: string; weight: number; }

export interface FraudAssessment {
  risk: "low" | "medium" | "high";
  score: number;                   // 0–100
  hardStop: boolean;               // true if any layer-1 rule fired
  typology?: ScamTypology;
  signals: FraudSignal[];
  recommendedAction: "proceed" | "verify_with_family" | "hold";
  suggestedVerifierId?: string;    // who to call (a mem_ with isVerifier)
  seniorFacingMessage: string;     // warm, never scolding, <= 2 sentences
  familyFacingSummary: string;     // plain-English "why we paused"
}

export interface Order {
  id: string; seniorId: string; request: OrderRequest;
  status: "draft" | "approved" | "held" | "cancelled" | "paid";
  fraud: FraudAssessment; holdId?: string; receiptUrl?: string; createdAt: string;
  fulfilment?: OrderFulfilment;    // D9
}

/** D9 · How a groceries/meal order is being fulfilled (mirrors delivery's DeliveryOrder). */
export interface OrderFulfilment {
  provider: DeliveryProvider; storeName: string; quoteId?: string; unmatchedItems: string[];
  finalAmountCents?: number; returnedCents?: number;   // settled to DoorDash's checkout total
  delivery?: { deliveryId: string; status: DeliveryStatus; etaText?: string; trackingUrl?: string; failureReason?: string };
}

export interface Hold {
  id: string; orderId: string; seniorId: string;
  status: "open" | "released" | "cancelled" | "expired_cooling_off";
  createdAt: string; coolingOffUntil: string;   // +24h
  resolution?: { decision: "release" | "cancel"; byMemberId: string;
                 method: "verbal_on_verification_call" | "passkey_web"; at: string };
}

export interface TranscriptTurn { speaker: "senior" | "agent" | string /* mem_ id */; text: string; ts: string; }

export interface CallEnded {
  callId: string; seniorId: string; kind: "inbound" | "verification" | "scheduled_family_call";
  startedAt: string; endedAt: string;
  transcript: TranscriptTurn[];
  privateSpans: { startTs: string; endTs: string }[];  // "keep this between us"
  scheduledCallId?: string;                             // D11
}

export interface Hook { id: string; seniorId: string; text: string; forMemberId: string; nudgeText: string; createdAt: string; }

export interface Slot { id: string; startUtc: string; endUtc: string; reason: string;
                 localTimes: Record<string /* sen_ or mem_ */, string /* "Sun 4:00 PM" */>; }

export interface Proposal {
  id: string; seniorId: string; kind: "video_call" | "visit";
  memberIds: string[]; includesDependents: string[];   // e.g. ["Mia"]
  initiatedBy: "senior" | "member" | "ai_rhythm";
  slots: Slot[]; responses: { memberId: string; slotId: string; accept: boolean }[];
  status: "proposed" | "awaiting_senior" | "confirmed" | "cancelled";
  confirmedSlotId?: string; scheduledCallId?: string;
}

export interface ScheduledCall {
  id: string; proposalId: string; seniorId: string; memberIds: string[];
  startUtc: string; roomName: string; roomJoinUrl: string;   // family joins here
  seniorJoin: "phone_dialout" | "tablet";                      // Plan A / Plan B
  recurring?: "weekly";
  status: "scheduled" | "ringing" | "live" | "done" | "missed";
}

export interface ContactRhythm {
  seniorId: string;
  perMember: { memberId: string; lastContactAt?: string; usualPattern?: string; // "Sundays ~4pm"
               callsLast30d: number; everAskedForMoney: boolean }[];   // D6 (was literal `false`)
}

export interface Message {   // WhatsApp mock
  id: string; toMemberId: string; fromMemberId?: string; direction: "out" | "in";
  kind: "nudge" | "add_to_order" | "fraud_card" | "schedule_proposal" | "briefing" | "receipt" | "text" | "voice_note";
  body: string; actions?: { label: string; action: string; payload: any }[];
  mediaUrl?: string; createdAt: string;
}

// ─── §2 seed shapes + D7 / D11 ─────────────────────────────────────────────
export interface RoutineBlock { label: string; days: string; start: string; end: string; }

export interface Senior {
  id: string; name: string; age: number; tz: string; phone: string; language: string;
  routine: RoutineBlock[];
}

/** A minor is never a member, never messaged, never called (D7). */
export interface Dependent {
  name: string; age: number; schoolHours: string;
  birthday?: string;               // D7: "MM-DD", e.g. "10-14"
}

export interface Member {
  id: string; name: string; relation: string; tz: string; phone: string;
  whatsapp: boolean; isVerifier: boolean; dependents?: Dependent[];
}

export interface SeniorHint { text: string; createdAt: string; }

/** `GET family /circle/:seniorId` (phones included, internal only; never sent to a browser). */
export interface Circle { senior: Senior; members: Member[]; seniorHints: SeniorHint[]; }   // D11

// ─── D5 · Message actions ──────────────────────────────────────────────────
export interface ScheduleProposalPayload { proposalId: string; slotId: string; slot: Slot; }
export interface FraudCardPayload { orderId: string; holdId: string; }
export interface AddToOrderPayload { orderId: string; }
export interface NudgePayload { hookId?: string; }

/** Which actions each message kind carries, and the payload stored on its button. */
export interface MessageActionsByKind {
  schedule_proposal: { action: "accept_slot" | "decline_all"; payload: ScheduleProposalPayload };
  fraud_card: { action: "cancel_hold" | "release_hold" | "calling_her"; payload: FraudCardPayload };
  add_to_order: { action: "add_item" | "record_voice_note"; payload: AddToOrderPayload };
  nudge: { action: "call_now" | "dismiss"; payload: NudgePayload };
  briefing: { action: "call_now" | "dismiss"; payload: NudgePayload };
}
export type MessageActionName = MessageActionsByKind[keyof MessageActionsByKind]["action"];

/** The only keys a client may add to the stored (authoritative) button payload. */
export interface MessageActClientExtras {
  voiceNoteUrl?: string; passkeyAssertion?: string; note?: string; slotId?: string;
}

/** `POST family /messages/:id/act` */
export interface MessageActRequest {
  action: MessageActionName;
  payload: Record<string, unknown> & MessageActClientExtras;
}

// ─── D1–D4, D8, D11 · Endpoint bodies ──────────────────────────────────────
export interface OkResponse { ok: true; }                       // D1 /demo/reset, D2 /demo/fire-due

export type TimeTravelRequest =                                 // D2 POST family /demo/time-travel
  | { nowUtc: string }
  | { to: "next_call"; minutesBefore?: number };

export interface FireDueRequest { scheduledCallId: string; }    // D2 POST family /demo/fire-due

export interface DemoCall {                                     // D3 GET voice /demo/calls?seniorId=
  callId: string; kind: string;    // D3 leaves `kind` open ("inbound", "outbound", …)
  purpose?: string; scheduledCallId?: string; startedAt: string;
}

export interface SimulateVerificationRequest {                  // D3 POST voice /demo/simulate-verification
  seniorId: string; holdId: string; memberId: string;
  script: { speaker: "senior" | "member"; text: string }[];
}
export interface SimulateVerificationResponse { callId: string; }

/** D4 · `scheduled_call.due` body: the ScheduledCall plus which phase fired. */
export type ScheduledCallDue = ScheduledCall & { phase: "reminder" | "due" };

/** `POST money /holds/:id/resolve`. D8: `cancel` needs no passkey. */
export interface HoldResolveRequest {
  decision: "release" | "cancel"; byMemberId: string;
  method: "verbal_on_verification_call" | "passkey_web"; passkeyAssertion?: string;
}

export interface CallJoin { serverUrl: string; roomName: string; identity: string; token: string; }  // D11

export interface VoiceNote {                                    // D11 GET family /orders/:orderId/voice-notes
  id: string; orderId: string; memberId: string; memberName: string; url: string; createdAt: string;
}

// ─── D14 · Delivery service (:4004) ────────────────────────────────────────
export type DeliveryProvider = "mock" | "doordash_thirdparty";
export type DeliveryKind = "grocery" | "meal";

export interface QuoteRequest {                                 // POST delivery /quote
  kind: DeliveryKind; items: { name: string; qty: number }[]; storeHint?: string;
}

export interface QuoteLine {
  requested: string; qty: number;
  status: "matched" | "not_found" | "ambiguous";
  matched?: { name: string; priceCents: number; qty: number };
  options?: { name: string; priceCents: number }[];             // ≤ 3, when ambiguous
}

export interface Quote {
  quoteId: string; provider: DeliveryProvider; kind: DeliveryKind;
  storeName: string; storeId: string;
  lines: QuoteLine[]; subtotalCents: number; feesCents: number;
  totalCents: number;              // subtotal + estimated fees
  expiresAt: string;
}

export type DeliveryStatus =
  | "cart_ready" | "dry_run_complete" | "awaiting_live_checkout" | "placed"
  | "picked_up" | "delivered" | "failed";

export interface DeliveryOrder {
  deliveryId: string; orderId: string; seniorId: string; quoteId: string; provider: DeliveryProvider;
  status: DeliveryStatus;
  cartTotalCents: number; approvedAmountCents: number;
  storeName: string;
  externalOrderId?: string; trackingUrl?: string; etaUtc?: string; etaText?: string;
  failureReason?: string; confirmedBy?: string;
  cartNote?: string; checkoutTotalCents?: number;
  createdAt: string; updatedAt: string;
}

export interface CreateDeliveryOrderRequest {                   // POST delivery /orders
  orderId: string; seniorId: string; quoteId: string; approvedAmountCents: number;
}

export interface DeliveryCheckoutRequest { confirmedBy: string; }   // POST delivery /orders/:id/checkout

export interface DeliveryAdvanceRequest { to: "placed" | "picked_up" | "delivered"; }  // POST delivery /demo/advance/:id (mock only)

export interface DeliveryHealth {                               // GET delivery /health
  ok: true; service: "delivery"; mock: boolean;
  provider: DeliveryProvider; liveCheckout: boolean;
  doordash?: Record<string, unknown>;
}

/** Event: `POST {money,family}/webhooks/delivery-status`, on every status change. */
export interface DeliveryStatusEvent {
  deliveryId: string; orderId: string; status: DeliveryStatus;
  etaText?: string; trackingUrl?: string; failureReason?: string;
}
