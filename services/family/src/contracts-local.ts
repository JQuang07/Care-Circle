// TEMPORARY: copied from CONTRACTS.md §3 until packages/contracts exists.
// Replace imports of this file with "@care-circle/contracts" once Agent 4 publishes it.

export type OrderType = "groceries" | "ride" | "gift" | "pharmacy_refill" | "other";

export interface OrderRequest {
  seniorId: string;
  type: OrderType;
  merchantId?: string;
  payeeDescription?: string;
  items: { name: string; qty: number; priceCents?: number }[];
  amountCents: number;
  recipientMemberId?: string;
  context: {
    statedReason?: string;
    transcriptExcerpt: string;
    claimedRelative?: string;
    urgencyOrSecrecy?: boolean;
  };
}

export type ScamTypology =
  | "grandparent_impostor" | "government_impostor" | "tech_support"
  | "prize_lottery" | "romance" | "investment" | "cash_courier" | "unknown";

export interface FraudSignal { layer: 1 | 2 | 3 | 4; code: string; description: string; weight: number; }

export interface FraudAssessment {
  risk: "low" | "medium" | "high";
  score: number;
  hardStop: boolean;
  typology?: ScamTypology;
  signals: FraudSignal[];
  recommendedAction: "proceed" | "verify_with_family" | "hold";
  suggestedVerifierId?: string;
  seniorFacingMessage: string;
  familyFacingSummary: string;
}

export interface Order {
  id: string; seniorId: string; request: OrderRequest;
  status: "draft" | "approved" | "held" | "cancelled" | "paid";
  fraud: FraudAssessment; holdId?: string; receiptUrl?: string; createdAt: string;
}

export interface Hold {
  id: string; orderId: string; seniorId: string;
  status: "open" | "released" | "cancelled" | "expired_cooling_off";
  createdAt: string; coolingOffUntil: string;
  resolution?: {
    decision: "release" | "cancel"; byMemberId: string;
    method: "verbal_on_verification_call" | "passkey_web"; at: string;
  };
}

export interface TranscriptTurn { speaker: "senior" | "agent" | string; text: string; ts: string; }

export interface CallEnded {
  callId: string; seniorId: string; kind: "inbound" | "verification" | "scheduled_family_call";
  startedAt: string; endedAt: string;
  transcript: TranscriptTurn[];
  privateSpans: { startTs: string; endTs: string }[];
}

export interface Hook { id: string; seniorId: string; text: string; forMemberId: string; nudgeText: string; createdAt: string; }

export interface Slot {
  id: string; startUtc: string; endUtc: string; reason: string;
  localTimes: Record<string, string>;
}

export interface Proposal {
  id: string; seniorId: string; kind: "video_call" | "visit";
  memberIds: string[]; includesDependents: string[];
  initiatedBy: "senior" | "member" | "ai_rhythm";
  slots: Slot[]; responses: { memberId: string; slotId: string; accept: boolean }[];
  status: "proposed" | "awaiting_senior" | "confirmed" | "cancelled";
  confirmedSlotId?: string; scheduledCallId?: string;
}

export interface ScheduledCall {
  id: string; proposalId: string; seniorId: string; memberIds: string[];
  startUtc: string; roomName: string; roomJoinUrl: string;
  seniorJoin: "phone_dialout" | "tablet";
  recurring?: "weekly";
  status: "scheduled" | "ringing" | "live" | "done" | "missed";
}

export interface ContactRhythm {
  seniorId: string;
  perMember: {
    memberId: string; lastContactAt?: string; usualPattern?: string;
    callsLast30d: number; everAskedForMoney: false;
  }[];
}

export type MessageKind =
  | "nudge" | "add_to_order" | "fraud_card" | "schedule_proposal"
  | "briefing" | "receipt" | "text" | "voice_note";

export interface MessageAction { label: string; action: string; payload: any; }

export interface Message {
  id: string; toMemberId: string; fromMemberId?: string; direction: "out" | "in";
  kind: MessageKind;
  body: string; actions?: MessageAction[];
  mediaUrl?: string; createdAt: string;
}

// ---- Seed shapes (CONTRACTS §2) ----
export interface RoutineBlock { label: string; days: string; start: string; end: string; }
export interface Senior {
  id: string; name: string; age: number; tz: string; phone: string; language: string;
  routine: RoutineBlock[];
}
export interface Dependent { name: string; age: number; schoolHours: string; }
export interface Member {
  id: string; name: string; relation: string; tz: string; phone: string;
  whatsapp: boolean; isVerifier: boolean; dependents?: Dependent[];
}

// ---- Request bodies (CONTRACTS §4) ----
export interface ScheduleRequestBody {
  seniorId: string;
  kind: "video_call" | "visit";
  memberIds?: string[];
  includeDependents?: boolean;
  initiatedBy: "senior" | "member" | "ai_rhythm";
  preferredWindow?: string;
}

export interface Moments {
  calls: number; voiceNotes: number; gifts: number; addedItems: number;
  scamsStopped: number; savedCents: number;
}
