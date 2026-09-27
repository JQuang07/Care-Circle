import { expect, it } from 'vitest';
import { seedFamilyClient } from '../src/family';
import { relationshipSignals } from '../src/fraud/layer4';
import { DEMO_SCAM, NOW } from './helpers';
it('accepts true history and does not claim that member never asks for money', async () => {
  const family = seedFamilyClient(() => NOW);
  const circle = await family.getCircle('sen_rose');
  const rhythm = await family.getContactRhythm('sen_rose');
  rhythm.perMember.find(p => p.memberId === 'mem_danny')!.everAskedForMoney = true;
  expect(relationshipSignals(DEMO_SCAM, circle, rhythm).signals.map(s => s.code)).not.toContain('CLAIMED_NEVER_ASKS');
});
