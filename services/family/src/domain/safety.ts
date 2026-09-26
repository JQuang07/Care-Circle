// Content rules for anything the family reads (hooks, nudges, briefings).

const HEALTH = [
  /\bdoctor'?s?\b/i, /\bdr\.?\s/i, /\bmedic(ation|ine|al|are)\b/i, /\bpills?\b/i, /\bprescription/i, /\brefill/i,
  /\bpharmac/i, /\bdos(e|age)\b/i, /\bblood (pressure|sugar|test)/i, /\bdiabet/i, /\binsulin/i, /\bsurgery/i,
  /\bhospital/i, /\bdiagnos/i, /\bcancer/i, /\bheart\b/i, /\bpain\b/i, /\bache/i, /\bdizz/i, /\bfell\b/i,
  /\bfall(s|ing)? down/i, /\bsymptom/i, /\barthritis/i, /\bchemo/i, /\bx-?ray/i, /\bmri\b/i, /\bscan\b/i,
  /\bcardio/i, /\bdementia/i, /\bmemory loss/i, /\bsick\b/i, /\billness/i, /\bcholesterol/i, /\btherap/i,
  /\bclinic\b/i, /\bnurse\b/i, /\bcornerrx\b/i, /\binhaler/i, /\bbreath(ing|less)/i, /\bchest\b/i, /\bhip\b/i,
];

const FAMILY_REFS = /\b(lisa|danny|mark|mia|daughter|son|grandson|granddaughter|kids?|family|sister|brother)\b/i;
const NEGATIVE = /\b(never|doesn'?t|don'?t|won'?t|annoy|upset|mad|angry|forgot|forget|ignor|rude|disappoint|complain|lazy|selfish|frustrat|hurt|busy|too busy|nag|argu|fight|fought)\w*/i;

const SCAM = /\b(gift ?cards?|wire|crypto|bitcoin|medicare|irs|lottery|prize|bail|kevin|stranger)\b/i;

export function mentionsHealth(text: string): boolean { return HEALTH.some((re) => re.test(text)); }

/** "Complaints about other family members" — any family reference combined with negative language. */
export function complainsAboutFamily(text: string): boolean { return FAMILY_REFS.test(text) && NEGATIVE.test(text); }

export function mentionsScam(text: string): boolean { return SCAM.test(text); }

export function hookTextAllowed(text: string): boolean {
  return !!text.trim() && !mentionsHealth(text) && !complainsAboutFamily(text) && !mentionsScam(text);
}

const GUILT = [
  /haven'?t (called|talked|spoken|visited|been in touch)/i, /\bin (weeks|ages|a while|so long|forever)\b/i,
  /\bbeen (a while|too long|forever|ages)\b/i, /should (call|visit|check in) (more|often)/i,
  /\b(lonely|forgotten|neglect\w*|abandon\w*)\b/i, /\bguilt/i, /don'?t forget (to|about) (call|her)/i,
  /before it'?s too late/i, /\blast time you\b/i, /\bit'?s been\b/i, /\bfinally\b/i, /\bmake time\b/i,
  /\bwhen was the last\b/i, /\bnot called\b/i, /\bshe misses you\b/i,
];

export function hasGuilt(text: string): boolean { return GUILT.some((re) => re.test(text)); }
