// Copied from CONTRACTS.md §3. When Agent 4 publishes packages/contracts,
// delete these and import from there instead.

export type OrderType = 'groceries' | 'ride' | 'gift' | 'pharmacy_refill' | 'other';

export interface OrderRequest {
  seniorId: string;
  type: OrderType;
  merchantId?: string;             // absent if unknown or new payee
  payeeDescription?: string;       // e.g. "Target gift cards", "man named Kevin"
  items: { name: string; qty: number; priceCents?: number }[];
  amountCents: number;
  recipientMemberId?: string;
  context: {
    statedReason?: string;
    transcriptExcerpt: string;
    claimedRelative?: string;
    urgencyOrSecrecy?: boolean;
  };
}

export type ScamTypology =
  | 'grandparent_impostor' | 'government_impostor' | 'tech_support'
  | 'prize_lottery' | 'romance' | 'investment' | 'cash_courier' | 'unknown';

export interface FraudSignal { layer: 1 | 2 | 3 | 4; code: string; description: string; weight: number }

export interface FraudAssessment {
  risk: 'low' | 'medium' | 'high';
  score: number;
  hardStop: boolean;
  typology?: ScamTypology;
  signals: FraudSignal[];
  recommendedAction: 'proceed' | 'verify_with_family' | 'hold';
  suggestedVerifierId?: string;
  seniorFacingMessage: string;
  familyFacingSummary: string;
}

// ---- Agent 2 internal (not in the contract) ----

export type HardRuleCode =
  | 'GIFT_CARD_NONMEMBER' | 'BLOCKED_CATEGORY' | 'NEW_PAYEE'
  | 'OVER_CAP' | 'SECRECY' | 'CASH_COURIER';

/** Everything Layer 1 needs, gathered by lookups before the pure check runs. */
export interface HardRuleContext {
  circleMemberIds: ReadonlySet<string>;   // from family GET /circle/:seniorId
  knownMerchantIds: ReadonlySet<string>;  // mer_freshmart, mer_cornerrx, ...
  blockedCategories: ReadonlySet<string>; // from the credential
  perPurchaseCapCents: number;
  monthlyCapCents: number;
  spentThisMonthCents: number;
}
