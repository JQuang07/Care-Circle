import { z } from "zod";
// Local contract mirror until Agent 4 publishes @care-circle/contracts.
export const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`));
export const orderRequest = z.object({
  seniorId: id("sen"),
  type: z.enum(["groceries", "ride", "gift", "pharmacy_refill", "other"]),
  merchantId: id("mer").optional(),
  payeeDescription: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        qty: z.number().int().positive().max(100),
        priceCents: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(50),
  amountCents: z.number().int().nonnegative().max(100_000_000),
  recipientMemberId: id("mem").optional(),
  context: z.object({
    statedReason: z.string().max(4000).optional(),
    transcriptExcerpt: z.string().max(12000),
    claimedRelative: z.string().max(200).optional(),
    urgencyOrSecrecy: z.boolean().optional(),
  }),
});
export type OrderRequest = z.infer<typeof orderRequest>;
export interface Fraud {
  risk: "low" | "medium" | "high";
  hardStop: boolean;
  seniorFacingMessage: string;
  suggestedVerifierId?: string;
  score: number;
  signals: unknown[];
  recommendedAction: string;
  familyFacingSummary: string;
  typology?: string;
}
export interface Order {
  id: string;
  seniorId: string;
  request: OrderRequest;
  status: "draft" | "approved" | "held" | "cancelled" | "paid";
  fulfilment?: {
    provider: "mock" | "doordash_thirdparty";
    storeName: string;
    quoteId?: string;
    unmatchedItems: string[];
    delivery?: {
      deliveryId: string;
      status: string;
      etaText?: string;
      trackingUrl?: string;
      failureReason?: string;
    };
  };
  fraud: Fraud;
  holdId?: string;
  receiptUrl?: string;
  createdAt: string;
}
export interface Hold {
  id: string;
  orderId: string;
  seniorId: string;
  status: string;
  resolution?: { decision: string; byMemberId: string };
}
export interface Circle {
  senior: { id: string; name: string; phone: string };
  members: {
    id: string;
    name: string;
    phone: string;
    isVerifier: boolean;
    age?: number;
    dependents?: { name: string; age: number }[];
  }[];
}
export interface Proposal {
  id: string;
  status: string;
  memberIds?: string[];
  slots: {
    id: string;
    startUtc: string;
    endUtc: string;
    reason: string;
    localTimes: Record<string, string>;
  }[];
}
export const scheduledCall = z.object({
  id: id("sch"),
  proposalId: id("prop"),
  seniorId: id("sen"),
  memberIds: z.array(id("mem")),
  startUtc: z.iso.datetime(),
  roomName: z.string().min(1).max(200),
  roomJoinUrl: z.url(),
  seniorJoin: z.enum(["phone_dialout", "tablet"]),
  recurring: z.literal("weekly").optional(),
  phase: z.enum(["reminder", "due"]).optional(),
  status: z.enum(["scheduled", "ringing", "live", "done", "missed"]),
});
export type ScheduledCall = z.infer<typeof scheduledCall>;
export interface Turn {
  speaker: string;
  text: string;
  ts: string;
}
export type Pending =
  | { kind: "order"; order: Order }
  | { kind: "unmatched"; order: Order }
  | { kind: "verification"; holdId: string; memberId: string; name?: string }
  | { kind: "schedule"; proposalId: string; slotId: string; label?: string };
export interface Session {
  callId: string;
  seniorId: string;
  kind: "inbound" | "verification" | "scheduled_family_call";
  startedAt: string;
  endedAt?: string;
  transcript: Turn[];
  privateSpans: { startTs: string; endTs: string }[];
  privateStart?: string;
  pending?: Pending;
  pendingDelivered?: boolean;
  lastOrderId?: string;
  twilioSid?: string;
  streamToken?: string;
  verification?: {
    holdId: string;
    memberId: string;
    parentCallId: string;
    decision?: "cancel" | "release";
    resolved?: boolean;
  };
  latencies: number[];
  transport?: string;
  scheduledCallId?: string;
  purpose?: "reminder" | "scheduled_family_call";
  dispatchStatus?: "dispatching" | "started" | "failed";
  lastTs?: number;
}
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}
