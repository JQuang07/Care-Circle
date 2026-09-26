// PROVISIONAL — replace with the real types from CONTRACTS.md.
// Money is integer cents everywhere to avoid float bugs ($49.999...).

export type Category =
  | 'groceries' | 'pharmacy' | 'rides' | 'bakery' | 'gift_card' | 'retail'
  | 'wire' | 'crypto' | 'money_transfer' | 'other';

export interface OrderItem { name: string; qty: number; priceCents: number }

export interface OrderRequest {
  seniorId: string;
  merchantId?: string | null;      // null/undefined = new or unknown payee
  payeeName?: string;
  category: Category;
  amountCents: number;
  items: OrderItem[];
  recipientMemberId?: string | null;
  statedReason?: string;
  transcriptExcerpt?: string;
  claimedRelative?: string;
  note?: string;
  requestedAt: string;             // ISO timestamp
}

export type HardRuleCode =
  | 'GIFT_CARD_NONMEMBER' | 'BLOCKED_CATEGORY' | 'NEW_PAYEE'
  | 'OVER_CAP' | 'SECRECY' | 'CASH_COURIER';

export interface HardRuleHit { code: HardRuleCode; detail: string }

export interface HardRuleContext {
  circleMemberIds: ReadonlySet<string>;
  blockedCategories: ReadonlySet<string>;
  perPurchaseCapCents: number;
  monthlyCapCents: number;
  spentThisMonthCents: number;
}

export type Risk = 'low' | 'medium' | 'high';
export type Action = 'proceed' | 'verify_with_family' | 'hold';
