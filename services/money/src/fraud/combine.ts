import type { Action, HardRuleHit, Risk } from './types';

/** Model output is untrusted: clamp to [0,1]; garbage (NaN, strings) scores 0. */
export function layer2Points(confidence: unknown): number {
  const c = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  return Math.min(1, Math.max(0, c)) * 40;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export interface Combined {
  hardStop: boolean;
  score: number;
  risk: Risk;
  recommendedAction: Action;
  hardRuleCodes: string[];
}

export function combine(
  hard: HardRuleHit[],
  soft: { layer2Confidence: unknown; layer3: number; layer4: number },
): Combined {
  const hardStop = hard.length > 0;
  const sum = layer2Points(soft.layer2Confidence) + nonNeg(soft.layer3) + nonNeg(soft.layer4);
  const score = Math.min(100, Math.round(sum));
  const risk: Risk = hardStop || score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  const recommendedAction: Action =
    risk === 'high' ? 'hold' : risk === 'medium' ? 'verify_with_family' : 'proceed';
  return { hardStop, score, risk, recommendedAction, hardRuleCodes: hard.map((h) => h.code) };
}
