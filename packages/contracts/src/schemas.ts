/**
 * CONTRACTS.md §3 + CONTRACTS-ADDENDUM.md — zod schemas mirroring `types.ts` one-to-one.
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
  scheduledFor: z.string().optional(),
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

// ─── D14 · Delivery (declared first: Order.fulfilment uses it) ─────────────
export const DeliveryProviderSchema = z.enum(["mock", "doordash_thirdparty"]);
export const DeliveryKindSchema = z.enum(["grocery", "meal"]);
export const DeliveryStatusSchema = z.enum([
  "cart_ready", "dry_run_complete", "awaiting_live_checkout", "placed", "picked_up", "delivered", "failed",
]);

export const OrderFulfilmentSchema = z.object({
  provider: DeliveryProviderSchema,
  storeName: z.string(),
  quoteId: z.string().optional(),
  unmatchedItems: z.array(z.string()),
  delivery: z
    .object({
      deliveryId: z.string(),
      status: DeliveryStatusSchema,
      etaText: z.string().optional(),
      trackingUrl: z.string().optional(),
      failureReason: z.string().optional(),
    })
    .optional(),
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
  fulfilment: OrderFulfilmentSchema.optional(),
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
  scheduledCallId: z.string().optional(),
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
      everAskedForMoney: z.boolean(), // D6
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

// ─── §2 seed shapes + D7 / D11 ─────────────────────────────────────────────
export const RoutineBlockSchema = z.object({ label: z.string(), days: z.string(), start: z.string(), end: z.string() });

export const SeniorSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  tz: z.string(),
  phone: z.string(),
  language: z.string(),
  routine: z.array(RoutineBlockSchema),
});

export const DependentSchema = z.object({
  name: z.string(),
  age: z.number(),
  schoolHours: z.string(),
  birthday: z.string().optional(),
});

export const MemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  relation: z.string(),
  tz: z.string(),
  phone: z.string(),
  whatsapp: z.boolean(),
  isVerifier: z.boolean(),
  dependents: z.array(DependentSchema).optional(),
});

export const SeniorHintSchema = z.object({ text: z.string(), createdAt: z.string() });

export const CircleSchema = z.object({
  senior: SeniorSchema,
  members: z.array(MemberSchema),
  seniorHints: z.array(SeniorHintSchema),
});

// ─── D5 · Message actions ──────────────────────────────────────────────────
export const ScheduleProposalPayloadSchema = z.object({ proposalId: z.string(), slotId: z.string(), slot: SlotSchema });
export const FraudCardPayloadSchema = z.object({ orderId: z.string(), holdId: z.string() });
export const AddToOrderPayloadSchema = z.object({ orderId: z.string() });
export const NudgePayloadSchema = z.object({ hookId: z.string().optional() });

/** Per message kind: allowed action names and the stored payload's schema. */
export const MESSAGE_ACTIONS = {
  schedule_proposal: { actions: ["accept_slot", "decline_all"], payload: ScheduleProposalPayloadSchema },
  fraud_card: { actions: ["cancel_hold", "release_hold", "calling_her"], payload: FraudCardPayloadSchema },
  add_to_order: { actions: ["add_item", "record_voice_note"], payload: AddToOrderPayloadSchema },
  nudge: { actions: ["call_now", "dismiss"], payload: NudgePayloadSchema },
  briefing: { actions: ["call_now", "dismiss"], payload: NudgePayloadSchema },
} as const satisfies { [K in keyof T.MessageActionsByKind]: { actions: readonly T.MessageActionsByKind[K]["action"][]; payload: z.ZodType<T.MessageActionsByKind[K]["payload"]> } };

export const MessageActionNameSchema = z.enum([
  "accept_slot", "decline_all", "cancel_hold", "release_hold", "calling_her",
  "add_item", "record_voice_note", "call_now", "dismiss",
]);

export const MessageActClientExtrasSchema = z.object({
  voiceNoteUrl: z.string().optional(),
  passkeyAssertion: z.string().optional(),
  note: z.string().optional(),
  slotId: z.string().optional(),
});

/** Payload keys pass through (the server merges them onto the stored payload); extras are type-checked. */
export const MessageActRequestSchema = z.object({
  action: MessageActionNameSchema,
  payload: z.looseObject(MessageActClientExtrasSchema.shape),
});

// ─── D1–D4, D8, D11 · Endpoint bodies ──────────────────────────────────────
export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const TimeTravelRequestSchema = z.union([
  z.object({ nowUtc: z.string() }),
  z.object({ to: z.literal("next_call"), minutesBefore: z.number().optional() }),
]);

export const FireDueRequestSchema = z.object({ scheduledCallId: z.string() });

export const DemoCallSchema = z.object({
  callId: z.string(),
  kind: z.enum(["inbound", "verification", "scheduled_family_call"]),
  purpose: z.string().optional(),
  scheduledCallId: z.string().optional(),
  startedAt: z.string(),
});

export const SimulateVerificationRequestSchema = z.object({
  seniorId: z.string(),
  holdId: z.string(),
  memberId: z.string(),
  script: z.array(z.object({ speaker: z.enum(["senior", "member"]), text: z.string() })),
});
export const SimulateVerificationResponseSchema = z.object({ callId: z.string() });

export const ScheduledCallDueSchema = ScheduledCallSchema.extend({ phase: z.enum(["reminder", "due"]) });

export const HoldResolveRequestSchema = z.object({
  decision: z.enum(["release", "cancel"]),
  byMemberId: z.string(),
  method: z.enum(["verbal_on_verification_call", "passkey_web"]),
  passkeyAssertion: z.string().optional(),
});

export const CallJoinSchema = z.object({ serverUrl: z.string(), roomName: z.string(), identity: z.string(), token: z.string() });

export const VoiceNoteSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  url: z.string(),
  createdAt: z.string(),
});

// ─── D14 · Delivery endpoint bodies ────────────────────────────────────────
export const QuoteRequestSchema = z.object({
  kind: DeliveryKindSchema,
  items: z.array(z.object({ name: z.string(), qty: z.number() })),
  storeHint: z.string().optional(),
});

export const QuoteLineSchema = z.object({
  requested: z.string(),
  qty: z.number(),
  status: z.enum(["matched", "not_found", "ambiguous"]),
  matched: z.object({ name: z.string(), priceCents: cents, qty: z.number() }).optional(),
  options: z.array(z.object({ name: z.string(), priceCents: cents })).max(3).optional(),
});

export const QuoteSchema = z.object({
  quoteId: z.string(),
  provider: DeliveryProviderSchema,
  kind: DeliveryKindSchema,
  storeName: z.string(),
  storeId: z.string(),
  lines: z.array(QuoteLineSchema),
  subtotalCents: cents,
  feesCents: cents,
  totalCents: cents,
  expiresAt: z.string(),
});

export const DeliveryOrderSchema = z.object({
  deliveryId: z.string(),
  orderId: z.string(),
  seniorId: z.string(),
  quoteId: z.string(),
  provider: DeliveryProviderSchema,
  status: DeliveryStatusSchema,
  cartTotalCents: cents,
  approvedAmountCents: cents,
  storeName: z.string(),
  externalOrderId: z.string().optional(),
  trackingUrl: z.string().optional(),
  etaUtc: z.string().optional(),
  etaText: z.string().optional(),
  failureReason: z.string().optional(),
  confirmedBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateDeliveryOrderRequestSchema = z.object({
  orderId: z.string(),
  seniorId: z.string(),
  quoteId: z.string(),
  approvedAmountCents: cents,
});

export const DeliveryCheckoutRequestSchema = z.object({ confirmedBy: z.string().min(1) });

export const DeliveryAdvanceRequestSchema = z.object({ to: z.enum(["placed", "picked_up", "delivered"]) });

export const DeliveryHealthSchema = z.object({
  ok: z.literal(true),
  service: z.literal("delivery"),
  mock: z.boolean(),
  provider: DeliveryProviderSchema,
  liveCheckout: z.boolean(),
  doordash: z.record(z.string(), z.unknown()).optional(),
});

export const DeliveryStatusEventSchema = z.object({
  deliveryId: z.string(),
  orderId: z.string(),
  status: DeliveryStatusSchema,
  etaText: z.string().optional(),
  trackingUrl: z.string().optional(),
  failureReason: z.string().optional(),
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
  // Addendum
  Check<Same<z.infer<typeof OrderFulfilmentSchema>, T.OrderFulfilment>>,
  Check<Same<NonNullable<z.infer<typeof OrderFulfilmentSchema>["delivery"]>, NonNullable<T.OrderFulfilment["delivery"]>>>,
  Check<Same<z.infer<typeof RoutineBlockSchema>, T.RoutineBlock>>,
  Check<Same<z.infer<typeof SeniorSchema>, T.Senior>>,
  Check<Same<z.infer<typeof DependentSchema>, T.Dependent>>,
  Check<Same<z.infer<typeof MemberSchema>, T.Member>>,
  Check<Same<z.infer<typeof SeniorHintSchema>, T.SeniorHint>>,
  Check<Same<z.infer<typeof CircleSchema>, T.Circle>>,
  Check<Same<z.infer<typeof ScheduleProposalPayloadSchema>, T.ScheduleProposalPayload>>,
  Check<Same<z.infer<typeof FraudCardPayloadSchema>, T.FraudCardPayload>>,
  Check<Same<z.infer<typeof AddToOrderPayloadSchema>, T.AddToOrderPayload>>,
  Check<Same<z.infer<typeof NudgePayloadSchema>, T.NudgePayload>>,
  Check<Same<z.infer<typeof MessageActionNameSchema>, T.MessageActionName>>,
  Check<Same<z.infer<typeof MessageActClientExtrasSchema>, T.MessageActClientExtras>>,
  Check<Same<z.infer<typeof OkResponseSchema>, T.OkResponse>>,
  Check<Same<z.infer<typeof TimeTravelRequestSchema>, T.TimeTravelRequest>>,
  Check<Same<z.infer<typeof FireDueRequestSchema>, T.FireDueRequest>>,
  Check<Same<z.infer<typeof DemoCallSchema>, T.DemoCall>>,
  Check<Same<z.infer<typeof SimulateVerificationRequestSchema>, T.SimulateVerificationRequest>>,
  Check<Same<z.infer<typeof SimulateVerificationResponseSchema>, T.SimulateVerificationResponse>>,
  Check<Same<z.infer<typeof ScheduledCallDueSchema>, T.ScheduledCallDue>>,
  Check<Same<z.infer<typeof HoldResolveRequestSchema>, T.HoldResolveRequest>>,
  Check<Same<z.infer<typeof CallJoinSchema>, T.CallJoin>>,
  Check<Same<z.infer<typeof VoiceNoteSchema>, T.VoiceNote>>,
  Check<Same<z.infer<typeof DeliveryProviderSchema>, T.DeliveryProvider>>,
  Check<Same<z.infer<typeof DeliveryKindSchema>, T.DeliveryKind>>,
  Check<Same<z.infer<typeof DeliveryStatusSchema>, T.DeliveryStatus>>,
  Check<Same<z.infer<typeof QuoteRequestSchema>, T.QuoteRequest>>,
  Check<Same<z.infer<typeof QuoteLineSchema>, T.QuoteLine>>,
  Check<Same<z.infer<typeof QuoteSchema>, T.Quote>>,
  Check<Same<z.infer<typeof DeliveryOrderSchema>, T.DeliveryOrder>>,
  Check<Same<z.infer<typeof CreateDeliveryOrderRequestSchema>, T.CreateDeliveryOrderRequest>>,
  Check<Same<z.infer<typeof DeliveryCheckoutRequestSchema>, T.DeliveryCheckoutRequest>>,
  Check<Same<z.infer<typeof DeliveryAdvanceRequestSchema>, T.DeliveryAdvanceRequest>>,
  Check<Same<z.infer<typeof DeliveryHealthSchema>, T.DeliveryHealth>>,
  Check<Same<z.infer<typeof DeliveryStatusEventSchema>, T.DeliveryStatusEvent>>,
];
