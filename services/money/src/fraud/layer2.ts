import type { OrderRequest, ScamTypology } from '../contracts';
import type { Llm } from '../llm';
import { CASH_COURIER_PATTERNS, normalize } from './text';

export interface Layer2Result { typology: ScamTypology; confidence: number; cues: string[]; source: 'muse' | 'heuristic' }
export interface Classifier { classify(req: OrderRequest): Promise<Layer2Result> }

const TYPOLOGIES: ScamTypology[] = [
  'grandparent_impostor', 'government_impostor', 'tech_support', 'prize_lottery',
  'romance', 'investment', 'cash_courier', 'unknown',
];

export function layer2Input(req: OrderRequest) {
  return {
    statedReason: req.context.statedReason ?? '',
    transcriptExcerpt: req.context.transcriptExcerpt,
    claimedRelative: req.context.claimedRelative ?? '',
    items: req.items.map((i) => `${i.qty} x ${i.name}`),
    payee: req.payeeDescription ?? req.merchantId ?? 'unknown',
  };
}

// ---------- Offline heuristic (used when Muse is unavailable, and for offline eval) ----------

const CUES: [string, RegExp][] = [
  ['urgency', /\b(right now|right away|immediately|urgent(ly)?|hurry|asap|emergency|tonight|today|within the hour|in the next hour|before (it's|its) too late|by (the )?end of (the )?day)\b/],
  ['secrecy', /\bdon't tell\b|\bkeep (it|this|that) (a )?secret\b|\bbetween (you and me|us)\b/],
  ['isolation', /\bdon't (call|tell|contact) (your|the) (family|kids|children|son|daughter)\b/],
  ['authority_claim', /\b(irs|medicare|social security|police|sheriff|officer|fraud department|government|federal|warrant|bank's)\b/],
  ['relative_in_trouble', /\b(jail|arrested|bail|lawyer|attorney|crashed|car accident|in trouble|stranded)\b/],
  ['voice_claim', /\bsounded (exactly |just )?like (him|her)\b|\bit was (his|her) voice\b/],
  ['prize', /\b(i('ve| have)? won|you('ve| have)? won|winner|lottery|sweepstakes|jackpot)\b/],
  ['upfront_fee', /\b(processing|release|handling|claim) fee\b|\bfee to (release|claim|get)\b|\bpay (the )?taxes on\b/],
  ['tech_support', /\b(microsoft|apple support|tech support|virus|hacked|remote access|anydesk|teamviewer|fix (my|the|your) computer|pop-?up)\b/],
  ['online_romance', /\b(met (him|her)? ?online|online friend|dating (site|app)|soldier overseas|oil rig|so we can (finally )?meet)\b/],
  ['guaranteed_returns', /\b(guaranteed|risk-?free|double your|\d+% (return|a month|monthly|weekly|every month))\b/],
  ['cash_courier', new RegExp(CASH_COURIER_PATTERNS.map((p) => p.source).join('|'))],
  ['safe_account', /\bsafe account\b|\bmove (your|my|the|all) (money|savings)\b/],
  ['unusual_payment', /\bgift ?cards?\b|\bbitcoin\b|\bcrypto\b|\bwire(d)?\b|\bzelle\b|\bwestern union\b|\bgoogle play\b/],
  ['unsolicited_charity', /\b(donat(e|ion)|relief fund|victims of|hurricane|wildfire|earthquake|disaster)\b/],
  ['unsolicited_contact', /\b(a man|a woman|a lady|a guy|someone|somebody|they)\b.{0,25}\b(called|texted|emailed)\b|\bgot a (call|text)\b/],
];

function pickTypology(c: Set<string>): ScamTypology {
  if (c.has('cash_courier')) return 'cash_courier';
  if (c.has('voice_claim') || c.has('relative_in_trouble')) return 'grandparent_impostor';
  if (c.has('tech_support')) return 'tech_support';
  if (c.has('prize')) return 'prize_lottery';
  if (c.has('online_romance')) return 'romance';
  if (c.has('guaranteed_returns')) return 'investment';
  if (c.has('safe_account') || c.has('authority_claim')) return 'government_impostor';
  return 'unknown';
}

export function heuristicClassify(req: OrderRequest): Layer2Result {
  const i = layer2Input(req);
  const text = normalize([i.statedReason, i.transcriptExcerpt, i.payee, ...i.items].join(' | '));
  const cues = CUES.filter(([, re]) => re.test(text)).map(([name]) => name);
  const typology = pickTypology(new Set(cues));
  const n = cues.length;
  const confidence = n === 0 ? 0.05
    : Math.min(0.95, 0.25 + 0.2 * (n - 1) + (typology !== 'unknown' ? 0.15 : 0));
  return { typology, confidence: Math.round(confidence * 100) / 100, cues, source: 'heuristic' };
}

export const heuristicClassifier: Classifier = { classify: async (r) => heuristicClassify(r) };

// ---------- Muse ----------

const SYSTEM = `You screen purchase requests made by an older adult named Rose through a phone assistant.
Classify whether the request matches a known scam story. Typologies:
grandparent_impostor (someone posing as a grandchild/relative in trouble; voice clones),
government_impostor (IRS, Medicare, Social Security, police, or a bank "fraud department" / "safe account"),
tech_support, prize_lottery, romance (new online romantic interest), investment (guaranteed returns),
cash_courier (someone will collect cash in person), unknown (no scam pattern, or an ordinary purchase).
Grounding cues to look for: urgency, secrecy, authority claims, prize/"you've won", tech-support remote access,
a new online romantic interest, guaranteed returns, "don't call your family", unusual payment (gift cards, wire, crypto).
Ordinary errands (groceries, prescriptions, rides, birthday presents for family) should get confidence near 0.
Return only JSON. confidence is 0-1: your probability that this is a scam. cues: short snake_case names.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['typology', 'confidence', 'cues'],
  properties: {
    typology: { type: 'string', enum: TYPOLOGIES },
    confidence: { type: 'number' },
    cues: { type: 'array', items: { type: 'string' } },
  },
};

/** Treat model output as untrusted input: validate every field. */
export function validateLayer2(raw: unknown): Omit<Layer2Result, 'source'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const typology = TYPOLOGIES.includes(r.typology as ScamTypology) ? (r.typology as ScamTypology) : 'unknown';
  const c = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : null;
  if (c === null) return null;
  const cues = Array.isArray(r.cues)
    ? r.cues.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 40)).slice(0, 8)
    : [];
  return { typology, confidence: Math.min(1, Math.max(0, c)), cues };
}

/** Muse first; on any error or invalid output, fall back to the heuristic (never to "safe"). */
export function museClassifier(llm: Llm, log?: (msg: string) => void): Classifier {
  return {
    async classify(req) {
      try {
        const raw = await llm.json(SYSTEM, JSON.stringify(layer2Input(req)), 'scam_story', SCHEMA);
        const v = validateLayer2(raw);
        if (v) return { ...v, source: 'muse' };
        log?.('layer2: invalid Muse output, using heuristic');
      } catch (e) {
        log?.(`layer2: Muse error (${(e as Error).message}), using heuristic`);
      }
      return heuristicClassify(req);
    },
  };
}
