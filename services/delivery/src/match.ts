// Deterministic item matching: Rose's words -> catalog/menu items. No model involved.
const STOP = new Set([
  "a", "an", "the", "of", "some", "loaf", "gallon", "dozen", "pack", "bag", "bunch", "fresh", "please", "and",
]);

const stem = (t: string) =>
  t.length > 4 && t.endsWith("es") ? t.slice(0, -2) : t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;

export const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t)).map(stem);

/** 0..1: share of the query's words found in the candidate, small bonus for exact phrase, small penalty for extra words. */
export function score(query: string, candidate: string): number {
  const q = tokens(query), c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  const cs = new Set(c);
  const hit = q.filter((t) => cs.has(t)).length;
  let s = hit / q.length;
  if (hit === q.length && candidate.toLowerCase().includes(query.toLowerCase().trim())) s += 0.1;
  s -= Math.min(0.2, Math.max(0, c.length - q.length) * 0.03);
  return Math.max(0, Math.min(1, s));
}

/** `staple` marks a store's house default for a generic word ("milk" → whole milk). Only the mock sets it. */
export interface Priced { name: string; priceCents: number; staple?: boolean }

export function rank(query: string, items: Priced[]) {
  return items
    .map((it) => ({ it, s: score(query, it.name) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s || a.it.priceCents - b.it.priceCents);
}

/** matched when there's a clear winner; ambiguous when the top two are within 0.05; else not_found. */
export function classify(query: string, items: Priced[]) {
  const r = rank(query, items);
  if (!r.length) return { status: "not_found" as const };
  const [a, b] = r;
  if (b && a!.s - b.s < 0.05 && a!.it.name.toLowerCase() !== b.it.name.toLowerCase()) {
    const tied = r.filter((x) => a!.s - x.s < 0.05);
    const staples = tied.filter((x) => x.it.staple);
    if (staples.length === 1) return { status: "matched" as const, item: staples[0]!.it };
    return { status: "ambiguous" as const, options: r.slice(0, 3).map((x) => x.it) };
  }
  return { status: "matched" as const, item: a!.it };
}
