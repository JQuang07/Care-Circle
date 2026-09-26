import type { Kind, ProviderName } from "../types.js";
import type { Priced } from "../match.js";

export interface Store { id: string; name: string }
export interface CartResult { subtotalCents: number; totalCents: number; itemNames: string[] }
export type TrackStatus = "placed" | "picked_up" | "delivered";

/** Everything the delivery service needs from a delivery provider. Money never lives here. */
export interface Provider {
  readonly name: ProviderName;
  /** Connectivity + login state, for /health and dd:check. Never throws. */
  status(): Promise<{ connected: boolean; loggedIn?: boolean; detail?: string }>;
  findStore(kind: Kind, hint?: string): Promise<Store>;
  /** Fees + tax estimate added to the quote, so money charges what the cart will really cost. */
  estimateFeesCents(subtotalCents: number): number;
  catalog(store: Store): Promise<Priced[]>;
  /** Puts exactly these lines in the cart and returns the provider's own totals. */
  buildCart(store: Store, lines: { name: string; qty: number }[]): Promise<CartResult>;
  /** Checkout preview. Must NOT place an order. */
  preview(): Promise<{ totalCents?: number; etaText?: string }>;
  /** Places a real order. Only ever called behind the live-checkout gate. */
  checkout(): Promise<{ externalOrderId: string; etaText?: string }>;
  track(externalOrderId: string): Promise<{ status: TrackStatus; etaText?: string }>;
}

export class ProviderError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
