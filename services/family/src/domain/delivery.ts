import type { Member } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { badRequest } from "../deps.js";
import { ServiceError } from "../adapters/services.js";
import { getCircle } from "./circle.js";
import { sendMessage } from "./messages.js";
import { once } from "./once.js";
import { storeLabel } from "./orders.js";

/**
 * D14 event from services/delivery. `seniorId` and `storeName` are extras delivery adds;
 * when they're missing, family looks the delivery up.
 */
export interface DeliveryStatusEvent {
  deliveryId: string; orderId: string; status: string;
  etaUtc?: string; etaText?: string; trackingUrl?: string; failureReason?: string;
  seniorId?: string; storeName?: string;
}

const HANDLED = ["dry_run_complete", "placed", "picked_up", "delivered", "failed"];

export function validateDeliveryEvent(body: any): DeliveryStatusEvent {
  if (!body?.deliveryId || !body.orderId || !body.status) throw badRequest("expected { deliveryId, orderId, status }");
  return body;
}

/** POST /webhooks/delivery-status → family messages; idempotent by deliveryId + status. */
export async function handleDeliveryStatus(deps: Deps, ev: DeliveryStatusEvent): Promise<void> {
  if (!HANDLED.includes(ev.status)) return;
  let { seniorId, storeName } = ev;
  if (!seniorId || !storeName) {
    const d = await deps.delivery.getDelivery(ev.deliveryId);
    seniorId ??= d.seniorId;
    storeName ??= d.storeName;
  }
  if (!(await once(deps, `delivery:${ev.deliveryId}:${ev.status}`))) return;

  const { senior, members } = await getCircle(deps, seniorId!);
  const store = storeLabel(storeName) || "the store";
  const eta = ev.etaText ? `, arriving ${ev.etaText}` : "";
  const track = ev.trackingUrl ? { actions: [{ label: "Track delivery", action: "open_url", payload: { url: ev.trackingUrl } }] } : {};
  const send = async (to: Member[], body: string, extra = {}) => {
    for (const m of to) await sendMessage(deps, { toMemberId: m.id, kind: "text", body, ...extra });
  };

  switch (ev.status) {
    case "dry_run_complete": {
      // The primary contact: the first verifier in circle order (Lisa in the seed).
      const primary = members.find((m) => m.isVerifier) ?? members[0];
      // Demo: the DoorDash cart is built and checkout reached; the real order button is never pressed.
      await send([primary], `✅ Order confirmed: ${senior.name}'s groceries are ordered from ${store}. (Demo: DoorDash checkout reached, no real charge.)`);
      return;
    }
    case "placed":
      await send(members, `${senior.name}'s groceries from ${store} are on the way${eta}.`, track);
      return;
    case "picked_up":
      await send(members, `The driver picked up ${senior.name}'s groceries from ${store}${eta}.`, track);
      return;
    case "delivered":
      await send(members, `${senior.name}'s groceries arrived.`);
      try {
        await deps.voice.outbound({ seniorId: senior.id, purpose: "delivery_arrived", orderId: ev.orderId });
      } catch (err) {
        // Voice rejects this purpose (400) until its v1.1; the family message above is what matters.
        if (!(err instanceof ServiceError && err.status === 400)) deps.log.warn({ err: String(err), orderId: ev.orderId }, "delivery_arrived call failed");
      }
      return;
    case "failed": {
      const why = ev.failureReason ? ` Reason: ${ev.failureReason}.` : "";
      await send(members.filter((m) => m.isVerifier), `${senior.name}'s grocery delivery from ${store} didn't go through.${why}`);
      return;
    }
  }
}
