import type { Hold, Order } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { AppError, badRequest } from "../deps.js";
import { newId } from "../ids.js";
import { ServiceError } from "../adapters/services.js";
import { getCircle, memberName } from "./circle.js";
import { sendMessage } from "./messages.js";
import { once } from "./once.js";
import { dollars } from "./orders.js";

function describe(order: Order): string {
  const r = order.request;
  const what = r.payeeDescription ?? (r.items?.[0]?.name ?? r.type.replace("_", " "));
  return `${dollars(r.amountCents)} for ${what}`;
}

/** fraud.hold_created → a fraud_card to every verifier. */
export async function handleFraudHold(deps: Deps, payload: { order: Order; hold: Hold }): Promise<void> {
  const { order, hold } = payload ?? ({} as any);
  if (!order?.id || !hold?.id) throw badRequest("expected { order, hold }");
  await deps.store.holds.put({
    id: hold.id, orderId: order.id, seniorId: order.seniorId, amountCents: order.request?.amountCents ?? 0,
    status: hold.status, createdAt: hold.createdAt ?? deps.clock.now().toISOString(),
  });
  if (!(await once(deps, `fraud-hold:${hold.id}`))) return;
  const { senior, members } = await getCircle(deps, order.seniorId);
  const summary = order.fraud?.familyFacingSummary?.trim()
    || `We paused a ${describe(order)} purchase for ${senior.name} because it looked like a common scam. Nothing has been paid.`;
  const suggested = order.fraud?.suggestedVerifierId;
  for (const v of members.filter((m) => m.isVerifier)) {
    const lead = suggested === v.id ? `We're calling you now to check with ${senior.name}.\n\n` : "";
    await sendMessage(deps, {
      toMemberId: v.id, kind: "fraud_card",
      body: `Why we paused: ${lead}${summary}`,
      actions: [
        { label: "I'm calling her", action: "fraud_calling", payload: { holdId: hold.id, orderId: order.id } },
        { label: "Cancel it", action: "fraud_cancel", payload: { holdId: hold.id, orderId: order.id } },
        { label: "Approve in app (passkey)", action: "fraud_approve_passkey", payload: { holdId: hold.id, orderId: order.id, requiresPasskey: true } },
      ],
    });
  }
}

/** fraud.hold_resolved → short all-clear to the circle + gentle code-word practice (never the word itself). */
export async function handleFraudResolved(deps: Deps, payload: { order: Order; hold: Hold }): Promise<void> {
  const { order, hold } = payload ?? ({} as any);
  if (!order?.id || !hold?.id) throw badRequest("expected { order, hold }");
  const now = deps.clock.now().toISOString();
  const amountCents = order.request?.amountCents ?? 0;
  await deps.store.holds.put({ id: hold.id, orderId: order.id, seniorId: order.seniorId, amountCents, status: hold.status, createdAt: hold.createdAt ?? now, resolvedAt: hold.resolution?.at ?? now });
  if (!(await once(deps, `fraud-resolved:${hold.id}:${hold.status}`))) return;
  const { senior, members } = await getCircle(deps, order.seniorId);
  const by = hold.resolution?.byMemberId ? memberName(members, hold.resolution.byMemberId) : undefined;
  const stopped = hold.status === "cancelled" || hold.status === "expired_cooling_off";
  if (stopped) {
    await deps.store.moments.put({ id: newId("evt"), seniorId: senior.id, type: "scam_stopped", at: now, amountCents, ref: hold.id });
  }
  let body: string;
  if (hold.status === "cancelled") body = `All clear. The ${describe(order)} was stopped${by ? ` by ${by}` : ""} and nothing was paid. ${senior.name} is fine.`;
  else if (hold.status === "expired_cooling_off") body = `All clear. The paused ${describe(order)} expired after the 24-hour cooling-off period. Nothing was paid.`;
  else if (hold.status === "released") body = `All clear. ${by ?? "The family"} confirmed the ${describe(order)} was fine, so it went through.`;
  else return;
  if (stopped) body += `\n\nGentle reminder: if anyone calls ${senior.name} with an "emergency", she can ask them for the family code word. It might be nice to practice it together on your next call.`;
  for (const m of members) await sendMessage(deps, { toMemberId: m.id, kind: "text", body });
}

export async function fraudAction(deps: Deps, action: string, actorId: string, payload: any): Promise<unknown> {
  const holdId = payload?.holdId;
  if (!holdId) throw badRequest("payload.holdId is required");
  const found = (await deps.store.circle.list()).find((c) => c.members.some((m) => m.id === actorId));
  const actor = found?.members.find((m) => m.id === actorId);
  if (!actor?.isVerifier) throw new AppError(403, "NOT_A_VERIFIER", "only verifiers can act on a paused purchase");
  try {
    if (action === "fraud_calling") {
      for (const m of found!.members.filter((x) => x.isVerifier && x.id !== actorId)) {
        await sendMessage(deps, { toMemberId: m.id, kind: "text", body: `${actor.name} is calling ${found!.senior.name} about the paused purchase.` });
      }
      return { ok: true, dial: found!.senior.phone };
    }
    if (action === "fraud_cancel") {
      // CONTRACTS has no "app button" method; cancel is always allowed, so we send passkey_web (see CCR-4).
      const hold = await deps.money.resolveHold(holdId, { decision: "cancel", byMemberId: actorId, method: "passkey_web" });
      return { ok: true, hold };
    }
    if (action === "fraud_approve_passkey") {
      if (!payload.passkeyAssertion) {
        throw new AppError(400, "PASSKEY_REQUIRED", "Approving a paused purchase needs a passkey. Prompt WebAuthn and resend with payload.passkeyAssertion.");
      }
      const hold = await deps.money.resolveHold(holdId, { decision: "release", byMemberId: actorId, method: "passkey_web", passkeyAssertion: payload.passkeyAssertion });
      return { ok: true, hold };
    }
  } catch (err) {
    if (err instanceof ServiceError) throw new AppError(err.status >= 500 ? 502 : err.status, err.code, err.message);
    if (err instanceof AppError) throw err;
    throw new AppError(502, "MONEY_UNAVAILABLE", String(err));
  }
  throw badRequest(`unknown fraud action ${action}`, "UNKNOWN_ACTION");
}
