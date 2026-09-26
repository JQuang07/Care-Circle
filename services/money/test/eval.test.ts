import { expect, it } from 'vitest';
import { runEval } from '../eval/run';

it('eval meets targets: every scam caught, ≤2 legit held as high', async () => {
  const s = await runEval({ write: false });
  expect(s.scenarios).toBe(24);
  expect(s.scamsCaught).toBe(12);
  expect(s.falseHighHolds).toBeLessThanOrEqual(2);
  for (const r of s.rows) if (r.risk !== 'low') expect(r.seniorFacingMessage).not.toMatch(/scam|fraud|tricked/i);
});
