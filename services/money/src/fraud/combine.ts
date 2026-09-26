import type { FraudAssessment, FraudSignal } from './types';

/** Model output is untrusted: clamp to [0,1]; garbage (NaN, strings) scores 0. */
export function layer2Points(confidence: unknown): number {
  const c = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  return Math.min(1, Math.max(0, c)) * 40;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export type Combined = Pick<FraudAssessment, 'risk' | 'score' | 'hardStop' | 'recommendedAction'>;

/** layer1 = hard-rule signals; soft = weighted signals from layers 2–4. */
export function combine(layer1: FraudSignal[], soft: FraudSignal[]): Combined {
  const hardStop = layer1.length > 0;
  const sum = soft.filter((s) => s.layer !== 1).reduce((a, s) => a + nonNeg(s.weight), 0);
  const score = Math.min(100, Math.round(sum));
  const risk = hardStop || score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  const recommendedAction = risk === 'high' ? 'hold' : risk === 'medium' ? 'verify_with_family' : 'proceed';
  return { hardStop, score, risk, recommendedAction };
}
