/**
 * CONTRACTS.md §3 — zod schemas mirroring `types.ts` one-to-one.
 *
 * Shape rule: no fields added or removed. Unknown keys are stripped (zod default),
 * so a peer that sends extra data doesn't break a consumer.
 * Only two refinements, both stated in the contract's own words:
 *   - money fields are integers (§0: "integer cents")
 *   - FraudAssessment.score is 0–100 (§3 comment)
 * IDs and timestamps are plain strings on purpose; the prefixes/ISO format in §0 are
 * conventions, and rejecting on them would turn a cosmetic slip into an outage.
 */
import { z } from "zod";
import type * as T from "./types";

const cents = z.number().int();

export const OrderTypeSchema = z.enum(["groceries", "ride", "gift", "pharmacy_refill", "other"]);

export const OrderRequestSchema = z.object({
  seniorId: z.string(),
  type: OrderTypeSchema,
  merchantId: z.string().optional(),
  payeeDescription: z.string().optional(),
  items: z.array(z.object({ name: z.string(), qty: z.number(), priceCents: cents.optional() })),
  amountCents: cents,
  recipientMemberId: z.string().optional(),
  context: z.object({
    statedReason: z.string().optional(),
    transcriptExcerpt: z.string(),
    claimedRelative: z.string().optional(),
    urgencyOrSecrecy: z.boolean().optional(),
  }),
});

export const ScamTypologySchema = z.enum([
  "grandparent_impostor", "government_impostor", "tech_support",
  "prize_lottery", "romance", "investment", "cash_courier", "unknown",
]);

export const FraudSignalSchema = z.object({
  layer: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  code: z.string(),
  description: z.string(),
  weight: z.number(),
});

export const FraudAssessmentSchema = z.object({
  risk: z.enum(["low", "medium", "high"]),
  score: z.number().min(0).max(100),
  hardStop: z.boolean(),
  typology: ScamTypologySchema.optional(),
  signals: z.array(FraudSignalSchema),
  recommendedAction: z.enum(["proceed", "verify_with_family", "hold"]),
  suggestedVerifierId: z.string().optional(),
  seniorFacingMessage: z.string(),
  familyFacingSummary: z.string(),
});

export const OrderSchema = z.object({
  id: z.string(),
  seniorId: z.string(),
  request: OrderRequestSchema,
  status: z.enum(["draft", "approved", "held", "cancelled", "paid"]),
  fraud: FraudAssessmentSchema,
  holdId: z.string().optional(),
  receiptUrl: z.string().optional(),
  createdAt: z.string(),
});

export const HoldSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  seniorId: z.string(),
  status: z.enum(["open", "released", "cancelled", "expired_cooling_off"]),
  createdAt: z.string(),
  coolingOffUntil: z.string(),
  resolution: z
    .object({
      decision: z.enum(["release", "cancel"]),
      byMemberId: z.string(),
      method: z.enum(["verbal_on_verification_call", "passkey_web"]),
      at: z.string(),
    })
    .optional(),
});

/** speaker is "senior" | "agent" | a mem_ id — which is just `string` at runtime. */
export const TranscriptTurnSchema = z.object({ speaker: z.string(), text: z.string(), ts: z.string() });

export const CallEndedSchema = z.object({
  callId: z.string(),
  seniorId: z.string(),
  kind: z.enum(["inbound", "verification", "scheduled_family_call"]),
  startedAt: z.string(),
  endedAt: z.string(),
  transcript: z.array(TranscriptTurnSchema),
  privateSpans: z.array(z.object({ startTs: z.string(), endTs: z.string() })),
});

export const HookSchema = z.object({
  id: z.string(),
  seniorId: z.string(),
  text: z.string(),
  forMemberId: z.string(),
  nudgeText: z.string(),
  createdAt: z.string(),
});

export const SlotSchema = z.object({
  id: z.string(),
  startUtc: z.string(),
  endUtc: z.string(),
  reason: z.string(),
  localTimes: z.record(z.string(), z.string()),
});

export const ProposalSchema = z.object({
  id: z.string(),
  seniorId: z.string(),
  kind: z.enum(["video_call", "visit"]),
  memberIds: z.array(z.string()),
  includesDependents: z.array(z.string()),
  initiatedBy: z.enum(["senior", "member", "ai_rhythm"]),
  slots: z.array(SlotSchema),
  responses: z.array(z.object({ memberId: z.string(), slotId: z.string(), accept: z.boolean() })),
  status: z.enum(["proposed", "awaiting_senior", "confirmed", "cancelled"]),
  confirmedSlotId: z.string().optional(),
  scheduledCallId: z.string().optional(),
});

export const ScheduledCallSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  seniorId: z.string(),
  memberIds: z.array(z.string()),
  startUtc: z.string(),
  roomName: z.string(),
  roomJoinUrl: z.string(),
  seniorJoin: z.enum(["phone_dialout", "tablet"]),
  recurring: z.literal("weekly").optional(),
  status: z.enum(["scheduled", "ringing", "live", "done", "missed"]),
});

export const ContactRhythmSchema = z.object({
  seniorId: z.string(),
  perMember: z.array(
    z.object({
      memberId: z.string(),
      lastContactAt: z.string().optional(),
      usualPattern: z.string().optional(),
      callsLast30d: z.number(),
      everAskedForMoney: z.literal(false), // literal per CONTRACTS.md; see CCR-06
    }),
  ),
});

export const MessageSchema = z.object({
  id: z.string(),
  toMemberId: z.string(),
  fromMemberId: z.string().optional(),
  direction: z.enum(["out", "in"]),
  kind: z.enum(["nudge", "add_to_order", "fraud_card", "schedule_proposal", "briefing", "receipt", "text", "voice_note"]),
  body: z.string(),
  actions: z.array(z.object({ label: z.string(), action: z.string(), payload: z.any() })).optional(),
  mediaUrl: z.string().optional(),
  createdAt: z.string(),
});

export const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) }); // §0
export const HealthSchema = z.object({ ok: z.literal(true), service: z.string(), mock: z.boolean() }); // §0

// ─── Drift guard ────────────────────────────────────────────────────────────
// If types.ts and a schema ever disagree (field added, removed, optional-ness,
// or type changed), `pnpm typecheck` fails on the line below naming the type.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;
type Check<X extends true> = X;
export type _DriftGuard = [
  Check<Same<z.infer<typeof OrderTypeSchema>, T.OrderType>>,
  Check<Same<z.infer<typeof OrderRequestSchema>, T.OrderRequest>>,
  Check<Same<z.infer<typeof OrderRequestSchema>["context"], T.OrderRequest["context"]>>,
  Check<Same<z.infer<typeof ScamTypologySchema>, T.ScamTypology>>,
  Check<Same<z.infer<typeof FraudSignalSchema>, T.FraudSignal>>,
  Check<Same<z.infer<typeof FraudAssessmentSchema>, T.FraudAssessment>>,
  Check<Same<z.infer<typeof OrderSchema>, T.Order>>,
  Check<Same<z.infer<typeof HoldSchema>, T.Hold>>,
  Check<Same<NonNullable<z.infer<typeof HoldSchema>["resolution"]>, NonNullable<T.Hold["resolution"]>>>,
  Check<Same<z.infer<typeof TranscriptTurnSchema>, T.TranscriptTurn>>,
  Check<Same<z.infer<typeof CallEndedSchema>, T.CallEnded>>,
  Check<Same<z.infer<typeof HookSchema>, T.Hook>>,
  Check<Same<z.infer<typeof SlotSchema>, T.Slot>>,
  Check<Same<z.infer<typeof ProposalSchema>, T.Proposal>>,
  Check<Same<z.infer<typeof ScheduledCallSchema>, T.ScheduledCall>>,
  Check<Same<z.infer<typeof ContactRhythmSchema>, T.ContactRhythm>>,
  Check<Same<z.infer<typeof ContactRhythmSchema>["perMember"][number], T.ContactRhythm["perMember"][number]>>,
  Check<Same<z.infer<typeof MessageSchema>, T.Message>>,
];
