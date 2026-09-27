// CONTRACTS.md §2–§3 plus D6/D14 addendum. main's shared package still lacks
// these additions. Replace shared shapes with @care-circle/contracts imports
// when the updated package lands; keep Circle/Credential internal types local.

export type OrderType = 'groceries' | 'ride' | 'gift' | 'pharmacy_refill' | 'other';

export interface OrderRequest {
  seniorId: string;
  type: OrderType;
  merchantId?: string;
  payeeDescription?: string;
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

export interface Order {
  id: string; seniorId: string; request: OrderRequest;
  status: 'draft' | 'approved' | 'held' | 'cancelled' | 'paid';
  fulfilment?: Fulfilment;
  fraud: FraudAssessment; holdId?: string; receiptUrl?: string; createdAt: string;
}

export interface Hold {
  id: string; orderId: string; seniorId: string;
  status: 'open' | 'released' | 'cancelled' | 'expired_cooling_off';
  createdAt: string; coolingOffUntil: string;
  resolution?: {
    decision: 'release' | 'cancel'; byMemberId: string;
    method: 'verbal_on_verification_call' | 'passkey_web'; at: string;
  };
}

export interface ContactRhythm {
  seniorId: string;
  perMember: {
    memberId: string; lastContactAt?: string; usualPattern?: string;
    callsLast30d: number; everAskedForMoney: boolean;
  }[];
}

export interface Senior { id: string; name: string; age: number; tz: string; phone: string; language: string }
export interface Member {
  id: string; name: string; relation: string; tz: string; phone: string;
  whatsapp: boolean; isVerifier: boolean;
  dependents?: { name: string; age: number; schoolHours?: string }[];
}
export interface Circle { senior: Senior; members: Member[] }

export interface Credential {
  seniorId: string; perPurchaseCapCents: number; monthlyCapCents: number;
  blockedCategories: string[]; fundedBy: string[];
}

export interface DeliveryStatus {
  deliveryId: string;
  status: 'cart_ready' | 'dry_run_complete' | 'awaiting_live_checkout' | 'placed' | 'picked_up' | 'delivered' | 'failed';
  etaText?: string; trackingUrl?: string; failureReason?: string;
}
export interface Fulfilment {
  provider: 'mock' | 'doordash_thirdparty'; storeName: string; quoteId?: string;
  unmatchedItems?: string[]; delivery?: DeliveryStatus;
  /** Settled once the real cart exists: what the family card finally pays, and what the fee estimate over-charged. */
  finalAmountCents?: number; returnedCents?: number;
}
