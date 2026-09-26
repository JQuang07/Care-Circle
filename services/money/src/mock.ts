import type { FraudAssessment, OrderRequest } from './contracts';
import { detectRails } from './fraud/layer1';

// Legacy canned fixtures. Runtime MOCK=1 uses the real fraud engine per D15.
export const CANNED: Record<FraudAssessment['risk'], FraudAssessment> = {
  low: {
    risk: 'low', score: 8, hardStop: false, signals: [
      { layer: 2, code: 'STORY_UNKNOWN', description: 'No warning signs in the conversation', weight: 2 },
      { layer: 3, code: 'NEW_CATEGORY', description: "A kind of purchase Rose hasn't made before (gift card)", weight: 6 },
    ],
    recommendedAction: 'proceed',
    seniorFacingMessage: '',
    familyFacingSummary: "Rose's request for $25 in gift cards for Mia's birthday looked normal, so it went ahead.",
  },
  medium: {
    risk: 'medium', score: 42, hardStop: false, typology: 'government_impostor', signals: [
      { layer: 2, code: 'STORY_GOVERNMENT_IMPOSTOR', description: 'The story matches a common government impostor pattern (authority claim, urgency, unsolicited contact)', weight: 32 },
      { layer: 3, code: 'NEW_MERCHANT', description: "A store or payee Rose hasn't used before (Medicare card renewal)", weight: 10 },
    ],
    recommendedAction: 'verify_with_family', suggestedVerifierId: 'mem_lisa',
    seniorFacingMessage: "Before we send this, let's quickly check with Lisa to make sure everything's right.",
    familyFacingSummary: 'Rose was asked for $40 for Medicare card renewal. The story matches a common government impostor pattern. A payee Rose hasn\'t used before. We suggested checking with Lisa before paying.',
  },
  high: {
    risk: 'high', score: 88, hardStop: true, typology: 'grandparent_impostor', signals: [
      { layer: 1, code: 'GIFT_CARD_NONMEMBER', description: 'Gift cards for someone outside the family circle', weight: 0 },
      { layer: 1, code: 'SECRECY', description: 'The caller asked to keep it secret', weight: 0 },
      { layer: 2, code: 'STORY_GRANDPARENT_IMPOSTOR', description: 'The story matches a common grandparent impostor pattern (urgency, secrecy, relative in trouble)', weight: 38 },
      { layer: 3, code: 'NEW_MERCHANT', description: "A store or payee Rose hasn't used before (Target gift cards)", weight: 10 },
      { layer: 4, code: 'CLAIMED_NEVER_ASKS', description: 'Danny last talked with Rose on Sunday and has never asked for money, and this "emergency" hasn\'t come up anywhere in the family', weight: 15 },
    ],
    recommendedAction: 'hold', suggestedVerifierId: 'mem_danny',
    seniorFacingMessage: "This looks like a trick a lot of people get calls about. Let's check with Danny before we send anything.",
    familyFacingSummary: 'Rose was asked for $500 in gift cards by someone claiming to be Danny. Gift cards for someone outside the family circle. The caller asked to keep it secret. Danny last talked with Rose on Sunday and has never asked for money. We paused it and are checking with Danny.',
  },
};

/** Pick a canned answer: header override first, then a rough guess from the request. */
export function mockAssess(req: OrderRequest, forced?: string): FraudAssessment {
  if (forced === 'low' || forced === 'medium' || forced === 'high') return structuredClone(CANNED[forced]);
  const t = `${req.context.transcriptExcerpt} ${req.context.statedReason ?? ''}`.toLowerCase();
  if ((detectRails(req).length && !req.recipientMemberId) || /don'?t tell|keep it (a )?secret/.test(t)) return structuredClone(CANNED.high);
  if (!req.merchantId || req.amountCents > 10000) return structuredClone(CANNED.medium);
  return structuredClone(CANNED.low);
}
