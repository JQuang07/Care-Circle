import type { FraudAssessment, FraudSignal } from '../contracts';
import type { Llm } from '../llm';

const BANNED = /\b(scam|scams|scammer|scammed|fraud|fraudulent|fraudster|tricked|being tricked|fooled|gullible|stupid|foolish|should have known|victim|criminal)\b/i;

export function sentenceCount(s: string): number {
  return s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean).length;
}

/** Warm, ≤2 sentences, never says "scam," "fraud," or "you're being tricked." */
export function validSeniorMessage(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= 240 &&
    sentenceCount(s) <= 2 && !BANNED.test(s);
}

export function validFamilySummary(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 20 && s.length <= 600 && sentenceCount(s) <= 5;
}

export interface MessageFacts {
  risk: FraudAssessment['risk'];
  seniorName: string;
  verifierName?: string;
  what: string;            // "$500 in gift cards"
  claimedRelative?: string;
  topSignals: FraudSignal[];
}

export function templateSeniorMessage(f: MessageFacts): string {
  const v = f.verifierName ?? 'your family';
  if (f.risk === 'high') return `This looks like a trick a lot of people get calls about. Let's check with ${v} before we send anything.`;
  if (f.risk === 'medium') return `Before we send this, let's quickly check with ${v} to make sure everything's right.`;
  return '';
}

export function templateFamilySummary(f: MessageFacts): string {
  if (f.risk === 'low') return `${f.seniorName}'s request for ${f.what} looked normal, so it went ahead.`;
  const by = f.claimedRelative ? ` by someone claiming to be ${f.claimedRelative}` : '';
  const reasons = f.topSignals.map((s) => s.description.replace(/\.$/, '')).join('. ');
  const action = f.risk === 'high'
    ? `We paused it${f.verifierName ? ` and are checking with ${f.verifierName}` : ''}.`
    : `We suggested checking with ${f.verifierName ?? 'family'} before paying.`;
  return `${f.seniorName} was asked for ${f.what}${by}. ${reasons}. ${action}`;
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['seniorFacingMessage', 'familyFacingSummary'],
  properties: { seniorFacingMessage: { type: 'string' }, familyFacingSummary: { type: 'string' } },
};

const SYSTEM = `You write two short messages about a purchase that was paused or flagged for an older adult.
seniorFacingMessage: spoken aloud to her. Warm, calm, at most 2 sentences. Never use the words scam, fraud,
tricked, fooled, or anything that blames her. Suggest checking with the named family member.
Example: "This looks like a trick a lot of people get calls about. Let's check with Danny before we send anything."
familyFacingSummary: for her family, plain English, no jargon, at most 4 sentences, include the top reasons given.
Return only JSON.`;

/** Muse drafts the wording; each field is validated and falls back to a template independently. */
export async function writeMessages(llm: Llm | null, f: MessageFacts) {
  const fallback = { seniorFacingMessage: templateSeniorMessage(f), familyFacingSummary: templateFamilySummary(f) };
  if (!llm || f.risk === 'low') return fallback;
  try {
    const raw = (await llm.json(SYSTEM, JSON.stringify(f), 'fraud_messages', SCHEMA)) as Record<string, unknown>;
    return {
      seniorFacingMessage: validSeniorMessage(raw?.seniorFacingMessage) ? raw.seniorFacingMessage : fallback.seniorFacingMessage,
      familyFacingSummary: validFamilySummary(raw?.familyFacingSummary) ? raw.familyFacingSummary : fallback.familyFacingSummary,
    };
  } catch {
    return fallback;
  }
}
