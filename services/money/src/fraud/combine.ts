import type { FraudAssessment, FraudSignal } from '../contracts';

export const LAYER2_MAX = 40;
export const MEDIUM_AT = 30;
export const HIGH_AT = 60;

/** Model output is untrusted: clamp to [0,1]; garbage (NaN, strings) scores 0. */
export function layer2Points(confidence: unknown): number {
  const c = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  return Math.round(Math.min(1, Math.max(0, c)) * LAYER2_MAX * 10) / 10;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export type Combined = Pick<FraudAssessment, 'risk' | 'score' | 'hardStop' | 'recommendedAction'>;

/** Layer-1 signals decide hardStop; only layers 2–4 add to the score. */
export function combine(layer1: FraudSignal[], soft: FraudSignal[]): Combined {
  const hardStop = layer1.length > 0;
  const sum = soft.filter((s) => s.layer !== 1).reduce((a, s) => a + nonNeg(s.weight), 0);
  const score = Math.min(100, Math.round(sum));
  const risk = hardStop || score >= HIGH_AT ? 'high' : score >= MEDIUM_AT ? 'medium' : 'low';
  const recommendedAction = risk === 'high' ? 'hold' : risk === 'medium' ? 'verify_with_family' : 'proceed';
  return { hardStop, score, risk, recommendedAction };
}
