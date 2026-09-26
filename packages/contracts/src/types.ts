/**
 * CONTRACTS.md §3 — Shared types. Transcribed verbatim. Do not edit by hand:
 * change CONTRACTS.md first (human only), then mirror it here AND in schemas.ts.
 * `schemas.ts` contains compile-time checks that fail if the two ever drift.
 */

export type OrderType = "groceries" | "ride" | "gift" | "pharmacy_refill" | "other";

export interface OrderRequest {
  seniorId: string;
  type: OrderType;
  merchantId?: string;             // absent if unknown or new payee
  payeeDescription?: string;       // e.g. "Target gift cards", "man named Kevin"
  items: { name: string; qty: number; priceCents?: number }[];
  amountCents: number;
  recipientMemberId?: string;      // for gifts to circle members
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
               callsLast30d: number; everAskedForMoney: false }[];
               // NOTE: `everAskedForMoney` is the literal type `false` exactly as written in
               // CONTRACTS.md. Flagged as CCR-06 (probably meant `boolean`).
}

export interface Message {   // WhatsApp mock
  id: string; toMemberId: string; fromMemberId?: string; direction: "out" | "in";
  kind: "nudge" | "add_to_order" | "fraud_card" | "schedule_proposal" | "briefing" | "receipt" | "text" | "voice_note";
  body: string; actions?: { label: string; action: string; payload: any }[];
  mediaUrl?: string; createdAt: string;
}
