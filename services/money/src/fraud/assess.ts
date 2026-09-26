import type { Credential, FraudAssessment, FraudSignal, OrderRequest } from '../contracts';
import type { FamilyClient } from '../family';
import type { Llm } from '../llm';
import { KNOWN_MERCHANT_IDS, merchantName } from '../seed';
import type { LedgerEntry, Store } from '../store/store';
import { combine, layer2Points } from './combine';
import { detectRails, effectiveAmountCents, hardRules } from './layer1';
import type { Classifier } from './layer2';
import { baselineSignals } from './layer3';
import { relationshipSignals } from './layer4';
import { writeMessages } from './messages';
import { fmtUsd } from './text';

export interface AssessDeps {
  store: Store;
  family: FamilyClient;
  classifier: Classifier;
  llm: Llm | null;
  credential: (seniorId: string) => Credential | undefined;
  now: () => Date;
}

const monthKey = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(d);

export function spentThisMonth(ledger: LedgerEntry[], now: Date, tz: string): number {
  const key = monthKey(now, tz);
  return ledger.filter((e) => monthKey(new Date(e.at), tz) === key).reduce((s, e) => s + e.amountCents, 0);
}

export async function loadLedger(store: Store, seniorId: string, now: Date) {
  return store.getLedger(seniorId, new Date(now.getTime() - 62 * 86400_000).toISOString());
}

function describeWhat(req: OrderRequest): string {
  const amt = fmtUsd(effectiveAmountCents(req));
  if (detectRails(req).includes('gift_card')) return `${amt} in gift cards`;
  const m = merchantName(req.merchantId);
  if (m) return `${amt} at ${m}`;
  if (req.payeeDescription) return `${amt} for ${req.payeeDescription}`;
  return `${amt} (${req.items.map((i) => i.name).join(', ') || req.type})`;
}

/** Top 3 for the family: the most telling reasons from different angles, not three near-duplicates. */
const RANK: Record<string, number> = {
  SECRECY: 0, CASH_COURIER: 0, GIFT_CARD_NONMEMBER: 1, BLOCKED_CATEGORY: 1,
  CLAIMED_NEVER_ASKS: 2, CLAIMED_NOT_IN_CIRCLE: 2, NEW_PAYEE: 4, OVER_CAP: 5,
};
const rankOf = (s: FraudSignal) => RANK[s.code] ?? (s.layer === 2 ? 3 : 6);
export function topSignals(all: FraudSignal[]): FraudSignal[] {
  return [...all].sort((a, b) => rankOf(a) - rankOf(b) || b.weight - a.weight).slice(0, 3);
}

export async function assess(req: OrderRequest, deps: AssessDeps): Promise<FraudAssessment> {
  const now = deps.now();
  const credential = deps.credential(req.seniorId);
  if (!credential) throw Object.assign(new Error(`No credential for ${req.seniorId}`), { statusCode: 404, code: 'UNKNOWN_SENIOR' });

  const [circle, rhythm, ledger, l2] = await Promise.all([
    deps.family.getCircle(req.seniorId),
    deps.family.getContactRhythm(req.seniorId),
    loadLedger(deps.store, req.seniorId, now),
    deps.classifier.classify(req),
  ]);
  const tz = circle.senior.tz;

  // Layer 1 — deterministic hard stops.
  const l1 = hardRules(req, {
    circleMemberIds: new Set(circle.members.map((m) => m.id)),
    knownMerchantIds: KNOWN_MERCHANT_IDS,
    blockedCategories: new Set(credential.blockedCategories),
    perPurchaseCapCents: credential.perPurchaseCapCents,
    monthlyCapCents: credential.monthlyCapCents,
    spentThisMonthCents: spentThisMonth(ledger, now, tz),
  });

  // Layer 2 — scam-story classifier. confidence × 40.
  const l2Signals: FraudSignal[] = l2.confidence > 0.1 ? [{
    layer: 2, code: `STORY_${l2.typology.toUpperCase()}`, weight: layer2Points(l2.confidence),
    description: l2.typology === 'unknown'
      ? `Warning signs in the conversation: ${l2.cues.join(', ').replace(/_/g, ' ')}`
      : `The story matches a common ${l2.typology.replace(/_/g, ' ')} pattern (${l2.cues.join(', ').replace(/_/g, ' ')})`,
  }] : [];

  // Layers 3 and 4.
  const l3 = baselineSignals(req, ledger.filter((e) => e.at >= new Date(now.getTime() - 60 * 86400_000).toISOString()), now, tz);
  const l4 = relationshipSignals(req, circle, rhythm);

  const soft = [...l2Signals, ...l3, ...l4.signals];
  const combined = combine(l1, soft);
  const signals = [...l1, ...soft];

  const verifier = circle.members.find((m) => m.id === l4.suggestedVerifierId);
  const messages = await writeMessages(deps.llm, {
    risk: combined.risk,
    seniorName: circle.senior.name,
    verifierName: verifier?.name,
    what: describeWhat(req),
    claimedRelative: l4.claimedMember?.name ?? req.context.claimedRelative,
    topSignals: topSignals(signals),
  });

  return {
    ...combined,
    typology: l2.confidence >= 0.4 && l2.typology !== 'unknown' ? l2.typology : undefined,
    signals,
    suggestedVerifierId: combined.risk === 'low' ? undefined : l4.suggestedVerifierId,
    ...messages,
  };
}
