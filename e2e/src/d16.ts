/**
 * D16 · the purchase-confirmation rule, as the addendum states it. Voice owns the real
 * implementation; this copy only guards our scripts, so a demo line can never again
 * fail to confirm because of how E2E worded it.
 */
const AFFIRMATIVE = /^(yes|yeah|go ahead|please do|that's right|okay|ok|sure)\b/i;
const NEGATION_OR_HESITATION = /\b(no|not|wait|don't|do not|hold on|actually)\b/i;
/** "Adds new items or changes": the usual ways a change rides along on a yes. */
const CHANGE = /\b(but|add|also|plus|instead|change|remove|swap|and some|one more)\b/i;

export function confirmsPurchase(utterance: string): { ok: boolean; why?: string } {
  const u = utterance.trim().replace(/[’]/g, "'");
  if (!AFFIRMATIVE.test(u)) return { ok: false, why: "does not start with an affirmative" };
  const neg = u.match(NEGATION_OR_HESITATION);
  if (neg) return { ok: false, why: `contains negation/hesitation “${neg[0]}”` };
  const change = u.match(CHANGE);
  if (change) return { ok: false, why: `adds a change (“${change[0]}”)` };
  return { ok: true };
}
