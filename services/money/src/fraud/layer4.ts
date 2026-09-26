import type { Circle, ContactRhythm, FraudSignal, Member, OrderRequest } from '../contracts';
import { normalize } from './text';

export const W4 = { CLAIMED_NOT_IN_CIRCLE: 15, CLAIMED_NEVER_ASKS: 15 } as const;

const RELATION_WORDS: Record<string, string[]> = {
  grandson: ['grandson'], granddaughter: ['granddaughter'],
  grandkid: ['grandson', 'granddaughter'], grandchild: ['grandson', 'granddaughter'],
  son: ['son'], daughter: ['daughter'],
  nephew: ['nephew'], niece: ['niece'], brother: ['brother'], sister: ['sister'],
};

/** "Danny", "my grandson", "my grandson Danny" → the member, if exactly one matches. */
export function resolveClaimedRelative(claimed: string, members: Member[]): Member | undefined {
  const c = normalize(claimed);
  const byName = members.filter((m) => new RegExp(`\\b${m.name.toLowerCase()}\\b`).test(c));
  if (byName.length === 1) return byName[0];
  for (const [word, relations] of Object.entries(RELATION_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(c)) {
      const hits = members.filter((m) => relations.includes(m.relation));
      return hits.length === 1 ? hits[0] : undefined;
    }
  }
  return undefined;
}

const dayName = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(iso));

export interface Layer4Result { signals: FraudSignal[]; suggestedVerifierId?: string; claimedMember?: Member; contactNote?: string }

export function relationshipSignals(req: OrderRequest, circle: Circle, rhythm: ContactRhythm): Layer4Result {
  const signals: FraudSignal[] = [];
  const members = circle.members;
  const verifiers = members.filter((m) => m.isVerifier);
  const lastContact = (id: string) => rhythm.perMember.find((p) => p.memberId === id);

  const mostRecentVerifier = [...verifiers].sort((a, b) =>
    (lastContact(b.id)?.lastContactAt ?? '').localeCompare(lastContact(a.id)?.lastContactAt ?? ''))[0];
  let suggestedVerifierId = mostRecentVerifier?.id;
  let claimedMember: Member | undefined;
  let contactNote: string | undefined;

  const claimed = req.context.claimedRelative?.trim();
  if (claimed) {
    claimedMember = resolveClaimedRelative(claimed, members);
    if (!claimedMember) {
      signals.push({ layer: 4, code: 'CLAIMED_NOT_IN_CIRCLE', weight: W4.CLAIMED_NOT_IN_CIRCLE,
        description: `The caller claimed to be "${claimed}", who isn't in Rose's family circle` });
    } else {
      const r = lastContact(claimedMember.id);
      // D6: family history may truthfully report either value.
      if (!r || r.everAskedForMoney === false) {
        const when = r?.lastContactAt ? ` last talked with Rose on ${dayName(r.lastContactAt, circle.senior.tz)} and` : '';
        contactNote = `${claimedMember.name}${when} has never asked for money`;
        signals.push({ layer: 4, code: 'CLAIMED_NEVER_ASKS', weight: W4.CLAIMED_NEVER_ASKS,
          description: `${contactNote}, and this "emergency" hasn't come up anywhere in the family` });
      }
      // Contract: suggestedVerifierId must be a member with isVerifier.
      if (claimedMember.isVerifier) suggestedVerifierId = claimedMember.id;
    }
  }
  return { signals, suggestedVerifierId, claimedMember, contactNote };
}
