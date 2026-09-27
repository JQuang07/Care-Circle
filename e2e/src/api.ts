/** Contract endpoints (CONTRACTS.md §4 + CONTRACTS-ADDENDUM.md), typed and schema-checked. */
import { z } from "zod";
import {
  DeliveryOrderSchema, DemoCallSchema, HoldSchema, MessageSchema, OkResponseSchema, OrderSchema,
  ProposalSchema, ScheduledCallSchema, SimulateVerificationResponseSchema,
  type DeliveryAdvanceRequest, type Message, type Order, type SimulateVerificationRequest,
} from "@care-circle/contracts";
import { call, type Service } from "./http";
import { SENIOR } from "./ids";

const CallIdSchema = z.object({ callId: z.string() });

/**
 * The /moments response isn't in §3 (see CCR-07). Only the two numbers E2E asserts on
 * are pinned; the rest are accepted as-is.
 */
export const MomentsSchema = z.object({
  calls: z.unknown(),
  voiceNotes: z.unknown(),
  gifts: z.unknown(),
  addedItems: z.unknown(),
  scamsStopped: z.number(),
  savedCents: z.number().int(),
});
export type Moments = z.infer<typeof MomentsSchema>;

/** D1 · every stateful service restores its seed state. */
export const reset = (service: Service) => call(service, "POST", "/demo/reset", {}, OkResponseSchema);
/** D1 · the order web's "Reset all data" uses. */
export const RESET_ORDER = ["family", "money", "delivery", "voice"] as const satisfies readonly Service[];

export const voice = {
  simulateInbound: (script: string[]) =>
    call("voice", "POST", "/demo/simulate-inbound", { seniorId: SENIOR.id, script }, CallIdSchema),
  /** D3 · the verifier speaks on the verification call, text-driven. */
  simulateVerification: (holdId: string, memberId: string, script: SimulateVerificationRequest["script"]) =>
    call("voice", "POST", "/demo/simulate-verification",
      { seniorId: SENIOR.id, holdId, memberId, script } satisfies SimulateVerificationRequest, SimulateVerificationResponseSchema),
  /** D3 · which calls voice placed, so E2E can prove /calls/outbound was hit. */
  calls: () => call("voice", "GET", `/demo/calls?seniorId=${SENIOR.id}`, undefined, z.array(DemoCallSchema)),
};

export const money = {
  orders: () => call("money", "GET", `/orders?seniorId=${SENIOR.id}`, undefined, z.array(OrderSchema)),
  /** D9 */
  order: (id: string) => call("money", "GET", `/orders/${id}`, undefined, OrderSchema),
  holds: () => call("money", "GET", `/holds?seniorId=${SENIOR.id}`, undefined, z.array(HoldSchema)),
};

export const family = {
  inbox: (memberId: string) => call("family", "GET", `/messages?memberId=${memberId}`, undefined, z.array(MessageSchema)),
  /** D5 · send the stored button payload back unchanged. */
  act: (messageId: string, action: string, payload: unknown) =>
    call("family", "POST", `/messages/${messageId}/act`, { action, payload }),
  pendingSenior: () => call("family", "GET", `/proposals/${SENIOR.id}/pending-senior`, undefined, z.array(ProposalSchema)),
  upcoming: () => call("family", "GET", `/schedule/${SENIOR.id}/upcoming`, undefined, z.array(ScheduledCallSchema)),
  moments: () => call("family", "GET", `/moments/${SENIOR.id}`, undefined, MomentsSchema),
  /** D2 · fire scheduled_call.due now instead of waiting for the wall clock. */
  fireDue: (scheduledCallId: string) => call("family", "POST", "/demo/fire-due", { scheduledCallId }, OkResponseSchema),
};

/** D14 · delivery (:4004). E2E only runs when its provider is `mock` (see global-setup). */
export const delivery = {
  orders: () => call("delivery", "GET", `/orders?seniorId=${SENIOR.id}`, undefined, z.array(DeliveryOrderSchema)),
  advance: (deliveryId: string, to: DeliveryAdvanceRequest["to"]) =>
    call("delivery", "POST", `/demo/advance/${deliveryId}`, { to } satisfies DeliveryAdvanceRequest, DeliveryOrderSchema),
};

// ── snapshot helpers: tests assert on what's NEW, so runs repeat without a reset ──
export const idSet = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
export const newSince = <T extends { id: string }>(xs: T[], before: Set<string>) => xs.filter((x) => !before.has(x.id));

export async function inboxSnapshot(memberIds: readonly string[]) {
  const entries = await Promise.all(memberIds.map(async (m) => [m, idSet(await family.inbox(m))] as const));
  return Object.fromEntries(entries) as Record<string, Set<string>>;
}

export const summarizeOrder = (o: Order) =>
  ({ id: o.id, type: o.request.type, status: o.status, amountCents: o.request.amountCents, risk: o.fraud.risk, hardStop: o.fraud.hardStop });
export const summarizeMsg = (m: Message) => ({ id: m.id, kind: m.kind, body: m.body.slice(0, 80) });
