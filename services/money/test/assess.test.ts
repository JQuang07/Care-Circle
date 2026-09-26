import { describe, expect, it } from 'vitest';
import { heuristicClassify, museClassifier, validateLayer2 } from '../src/fraud/layer2';
import { resolveClaimedRelative } from '../src/fraud/layer4';
import { validSeniorMessage, writeMessages } from '../src/fraud/messages';
import type { Llm } from '../src/llm';
import { SEED_CIRCLE } from '../src/seed';
import { DEMO_SCAM, GROCERIES, MEDICARE, MIA, setup } from './helpers';

describe('assess end to end (offline)', () => {
  it('demo scam → high, hard stop, grandparent impostor, verify with Danny', async () => {
    const { service } = await setup();
    const a = await service.assess(DEMO_SCAM);
    expect(a).toMatchObject({ risk: 'high', hardStop: true, recommendedAction: 'hold',
      typology: 'grandparent_impostor', suggestedVerifierId: 'mem_danny' });
    expect(a.signals.map((s) => s.code)).toEqual(expect.arrayContaining(['GIFT_CARD_NONMEMBER', 'SECRECY', 'CLAIMED_NEVER_ASKS']));
    expect(validSeniorMessage(a.seniorFacingMessage)).toBe(true);
    expect(a.seniorFacingMessage).toContain('Danny');
    expect(a.familyFacingSummary).toMatch(/\$500 in gift cards by someone claiming to be Danny/);
  });

  it("Mia's $25 birthday gift card → low", async () => {
    const { service } = await setup();
    expect((await service.assess(MIA)).risk).toBe('low');
  });

  it('weekly groceries → low, score 0', async () => {
    const { service } = await setup();
    expect(await service.assess(GROCERIES)).toMatchObject({ risk: 'low', score: 0, recommendedAction: 'proceed' });
  });

  it('Medicare impostor → medium, verify with family', async () => {
    const { service } = await setup();
    expect(await service.assess(MEDICARE)).toMatchObject({ risk: 'medium', recommendedAction: 'verify_with_family' });
  });

  it('a 2am request adds the odd-hour signal', async () => {
    const { service, clock } = await setup();
    clock.set(new Date('2026-11-18T07:00:00Z')); // 2am ET
    const a = await service.assess(GROCERIES);
    expect(a.signals.map((s) => s.code)).toContain('ODD_HOUR');
  });

  it('unknown senior → 404 error', async () => {
    const { service } = await setup();
    await expect(service.assess({ ...GROCERIES, seniorId: 'sen_nobody' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Layer 2 treats Muse as untrusted', () => {
  const llmReturning = (x: unknown): Llm => ({ json: async () => x });
  const throwing: Llm = { json: async () => { throw new Error('timeout'); } };

  it('validates and clamps', () => {
    expect(validateLayer2({ typology: 'bogus', confidence: 7, cues: ['a', 3] }))
      .toEqual({ typology: 'unknown', confidence: 1, cues: ['a'] });
    expect(validateLayer2({ typology: 'romance', confidence: 'high' })).toBeNull();
  });

  it('garbage or errors fall back to the heuristic, not to "safe"', async () => {
    for (const llm of [llmReturning('nonsense'), llmReturning({}), throwing]) {
      const r = await museClassifier(llm).classify(DEMO_SCAM);
      expect(r.source).toBe('heuristic');
      expect(r.typology).toBe('grandparent_impostor');
    }
  });

  it('a Muse "confidence 0" still cannot clear the demo scam (Layer 1 wins)', async () => {
    const { service } = await setup({ llm: llmReturning({ typology: 'unknown', confidence: 0, cues: [] }) });
    expect((await service.assess(DEMO_SCAM)).risk).toBe('high');
  });

  it('heuristic finds nothing in ordinary errands', () => {
    expect(heuristicClassify(GROCERIES).cues).toEqual([]);
  });
});

describe('Layer 4 relative resolution', () => {
  const m = SEED_CIRCLE.members;
  it.each([['Danny', 'mem_danny'], ['my grandson', 'mem_danny'], ['my son', 'mem_mark'], ['my daughter Lisa', 'mem_lisa']])(
    '%s → %s', (claim, id) => expect(resolveClaimedRelative(claim, m)?.id).toBe(id));
  it.each(['my nephew Kevin', 'Mia', 'my granddaughter'])('%s → not in circle', (claim) =>
    expect(resolveClaimedRelative(claim, m)).toBeUndefined());
});

describe('messages', () => {
  it.each([
    "You're being scammed.", 'This is fraud.', "Don't worry, you're being tricked.",
    'One. Two. Three sentences is too many.', '',
  ])('rejects senior message: %s', (s) => expect(validSeniorMessage(s)).toBe(false));

  it('bad Muse wording falls back to the template', async () => {
    const llm: Llm = { json: async () => ({ seniorFacingMessage: 'This is a scam!', familyFacingSummary: 'x' }) };
    const out = await writeMessages(llm, { risk: 'high', seniorName: 'Rose', verifierName: 'Danny', what: '$500 in gift cards', topSignals: [] });
    expect(out.seniorFacingMessage).toBe("This looks like a trick a lot of people get calls about. Let's check with Danny before we send anything.");
  });
});
