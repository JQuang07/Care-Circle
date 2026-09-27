// Shapes from docs/CONTRACTS-ADDENDUM.md D14. Move to @care-circle/contracts once Agent 4 adds them.
export type ProviderName = "mock" | "doordash_thirdparty";
export type Kind = "grocery" | "meal";

export interface RequestedItem { name: string; qty: number }

export interface QuoteLine {
  requested: string; qty: number;
  status: "matched" | "not_found" | "ambiguous";
  matched?: { name: string; priceCents: number; qty: number };
  options?: { name: string; priceCents: number }[];
}

export interface Quote {
  quoteId: string; provider: ProviderName; kind: Kind;
  storeName: string; storeId: string;
  lines: QuoteLine[]; subtotalCents: number; feesCents: number; totalCents: number;
  expiresAt: string;
}

export type DeliveryStatus =
  | "cart_ready" | "dry_run_complete" | "awaiting_live_checkout" | "placed"
  | "picked_up" | "delivered" | "failed";

export interface DeliveryOrder {
  deliveryId: string; orderId: string; seniorId: string; quoteId: string; provider: ProviderName;
  status: DeliveryStatus;
  cartTotalCents: number; approvedAmountCents: number;
  storeName: string;
  externalOrderId?: string; trackingUrl?: string; etaUtc?: string; etaText?: string;
  failureReason?: string; confirmedBy?: string;
  /** Dry run only: why the DoorDash cart itself wasn't built (the dry run finished on quote prices). */
  cartNote?: string;
  /** DoorDash's checkout total (items + fees + tax), when its checkout page showed one. Settles the charge. */
  checkoutTotalCents?: number;
  createdAt: string; updatedAt: string;
}
