"use client";
/**
 * Delivery status for the web (D9 + D14). Money's `order.fulfilment` says which store and
 * what couldn't be matched; delivery's own record is the freshest status. Either may be
 * missing while the owners finish their tasks, so each fills in for the other.
 */
import { z } from "zod";
import {
  DeliveryHealthSchema, DeliveryOrderSchema,
  type DeliveryOrder, type DeliveryProvider, type DeliveryStatus, type Order,
} from "@care-circle/contracts";
import { svc } from "./svc";

export interface DeliveryInfo {
  /** Only `true` when delivery /health says so. Unknown or unreachable counts as a dry run. */
  liveCheckout: boolean;
  byOrderId: Record<string, DeliveryOrder>;
}

export async function loadDelivery(signal?: AbortSignal): Promise<DeliveryInfo> {
  const [health, orders] = await Promise.all([
    svc("delivery", "/health", { schema: DeliveryHealthSchema, signal }),
    svc("delivery", "/orders?seniorId=sen_rose", { schema: z.array(DeliveryOrderSchema), signal }),
  ]);
  return {
    liveCheckout: health.ok && health.data.liveCheckout === true,
    byOrderId: orders.ok ? Object.fromEntries(orders.data.map((d) => [d.orderId, d])) : {},
  };
}

export interface DeliveryView {
  provider: DeliveryProvider;
  storeName: string;
  status?: DeliveryStatus;
  etaText?: string;
  trackingUrl?: string;
  failureReason?: string;
  unmatchedItems: string[];
}

export function deliveryView(order: Order, d?: DeliveryOrder): DeliveryView | undefined {
  const f = order.fulfilment;
  if (!f && !d) return undefined;
  return {
    provider: d?.provider ?? f!.provider,
    storeName: f?.storeName ?? d!.storeName,
    status: d?.status ?? f?.delivery?.status,
    etaText: d?.etaText ?? f?.delivery?.etaText,
    trackingUrl: d?.trackingUrl ?? f?.delivery?.trackingUrl,
    failureReason: d?.failureReason ?? f?.delivery?.failureReason,
    unmatchedItems: f?.unmatchedItems ?? [],
  };
}

export const STATUS_WORDS: Record<DeliveryStatus, string> = {
  cart_ready: "Cart ready",
  dry_run_complete: "Cart built, not ordered",
  awaiting_live_checkout: "Waiting for a person to place it",
  placed: "Ordered",
  picked_up: "On the way",
  delivered: "Delivered",
  failed: "Couldn't be delivered",
};
