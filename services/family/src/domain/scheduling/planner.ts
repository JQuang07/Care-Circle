import { DateTime } from "luxon";
import type { Muse } from "../../adapters/muse.js";
import type { Slot } from "../../contracts-local.js";
import { newId } from "../../ids.js";
import { formatLocal, toIso } from "../time.js";
import { checkSlot, generateCandidates, type Candidate, type Constraints } from "./constraints.js";

export interface PlanResult { slots: Slot[]; flex: boolean; flexNote?: string; }

const WEEKDAY: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** Loose preference parser: "sunday", "this weekend", "weekday evening", "afternoon", "2026-10-04". */
export function matchesPreference(iv: Candidate, pref: string | undefined, tz: string): boolean {
  if (!pref) return false;
  const p = pref.toLowerCase();
  const dt = DateTime.fromMillis(iv.start, { zone: tz });
  const days = new Set<number>();
  for (const [k, v] of Object.entries(WEEKDAY)) if (new RegExp(`\\b${k}`).test(p)) days.add(v);
  if (/weekend/.test(p)) { days.add(6); days.add(7); }
  if (/weekday/.test(p)) [1, 2, 3, 4, 5].forEach((d) => days.add(d));
  const iso = p.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso && dt.toISODate() !== iso) return false;
  if (days.size && !days.has(dt.weekday)) return false;
  const h = dt.hour;
  if (/morning/.test(p) && h >= 12) return false;
  if (/afternoon/.test(p) && (h < 12 || h >= 17)) return false;
  if (/evening|after work|night/.test(p) && h < 17) return false;
  const at = p.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (at) {
    const target = ((Number(at[1]) % 12) + (at[3] === "pm" ? 12 : 0)) * 60 + Number(at[2] ?? 0);
    if (Math.abs(h * 60 + dt.minute - target) > 60) return false;
  }
  return !!(iso || days.size || /morning|afternoon|evening|after work|night/.test(p) || at);
}

function heuristicScore(c: Constraints, iv: Candidate, pref: string | undefined, now: number): number {
  const s = DateTime.fromMillis(iv.start, { zone: c.senior.tz });
  const mins = s.hour * 60 + s.minute;
  let score = 0;
  // The family's real rhythm: Sunday around 4pm Rose's time.
  if (s.weekday === 7) score += 2;
  const fromFour = Math.abs(mins - 16 * 60);
  score += fromFour === 0 ? 2.5 : fromFour <= 30 ? 1.5 : fromFour <= 60 ? 1 : 0;
  // Rose is freshest just after her nap, or late morning.
  if (mins >= 15 * 60 && mins <= 17 * 60 + 30) score += 1;
  else if (mins >= 10 * 60 + 30 && mins < 12 * 60) score += 0.5;
  for (const m of c.members) {
    const lh = DateTime.fromMillis(iv.start, { zone: m.tz }).hour;
    score += lh >= 10 && lh < 20 ? 1 : lh >= 20 && lh < 22 ? 0.4 : 0;
  }
  if (matchesPreference(iv, pref, c.senior.tz)) score += 4;
  score -= ((iv.start - now) / 86_400_000) * 0.15;
  score -= iv.missing.length * 3;
  // On-the-hour times read better in a message.
  if (s.minute === 0) score += 0.3;
  return score;
}

function city(tz: string): string {
  return tz.split("/").pop()!.replace(/_/g, " ");
}

function hourText(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat(DateTime.fromMillis(ms, { zone: tz }).minute ? "h:mma" : "ha").toLowerCase();
}

/** Human reason, built from the constraints actually checked (used when Muse is off or its text is unusable). */
export function templateReason(c: Constraints, iv: Candidate): string {
  const s = DateTime.fromMillis(iv.start, { zone: c.senior.tz });
  const head = `${s.toFormat("cccc")} ${hourText(iv.start, c.senior.tz)}`;
  const notes: string[] = [];
  for (const m of c.members) {
    if (m.tz === c.senior.tz || iv.missing.includes(m.id)) continue;
    const lh = DateTime.fromMillis(iv.start, { zone: m.tz }).hour;
    if (lh >= 19 || lh < 9 || Math.abs(DateTime.fromMillis(iv.start, { zone: m.tz }).offset - s.offset) >= 300) {
      notes.push(`${m.name} at ${hourText(iv.start, m.tz)} in ${city(m.tz)}`);
    }
  }
  const deps = c.dependents.map((d) => `${d.name}'s out of school`);
  const mins = s.hour * 60 + s.minute;
  const afterNap = c.senior.routine.some((r) => r.label === "nap" && r.days.has(s.weekday) && mins >= r.end && mins - r.end <= 90);
  if (iv.missing.length) {
    const names = c.members.filter((m) => iv.missing.includes(m.id)).map((m) => `${m.name} (${hourText(iv.start, m.tz)} their time)`);
    return `${head} works for ${c.senior.name} and ${c.members.filter((m) => !iv.missing.includes(m.id)).map((m) => m.name).join(" and ") || "the family"}; ${names.join(", ")} would need to flex.`;
  }
  const who = c.members.length > 1 ? "everyone" : `${c.senior.name} and ${c.members[0]?.name ?? "you"}`;
  let reason = `${head} works for ${who}`;
  if (notes.length) reason += `, including ${notes.join(" and ")}`;
  if (deps.length) reason += `${notes.length ? "," : ""} and ${deps.join(" and ")}`;
  if (afterNap) reason += `, right after ${c.senior.name}'s nap`;
  return reason + ".";
}

export function localTimesFor(c: Constraints, startMs: number): Record<string, string> {
  const out: Record<string, string> = { [c.senior.id]: formatLocal(startMs, c.senior.tz) };
  for (const m of c.members) out[m.id] = formatLocal(startMs, m.tz);
  return out;
}

/** Spread picks across days (and at least 3h apart) so the family gets real choices. */
function diversePicks(sorted: Candidate[], n: number, tz: string): Candidate[] {
  const picks: Candidate[] = [];
  const dayKey = (iv: Candidate) => DateTime.fromMillis(iv.start, { zone: tz }).toISODate();
  for (const iv of sorted) {
    if (picks.length >= n) break;
    if (picks.some((p) => dayKey(p) === dayKey(iv))) continue;
    picks.push(iv);
  }
  for (const iv of sorted) {
    if (picks.length >= n) break;
    if (picks.some((p) => Math.abs(p.start - iv.start) < 3 * 3600_000)) continue;
    picks.push(iv);
  }
  return picks;
}

const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startUtc", "reason"],
        properties: { startUtc: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};

const RANK_SYSTEM = `You help a family pick times for a video call (or visit) with their elderly mother/grandmother.
You get a list of candidate start times. Every candidate has ALREADY been checked against everyone's hard constraints.
Choose the 3 best, preferring: the family's known rhythm, comfortable local hours for everyone (not too late for people abroad),
times right after her nap or in the late afternoon, and variety across days. Copy startUtc exactly from the list.
For each, write a warm one-sentence reason in plain English that names local times for anyone far away and mentions kids' school if relevant,
e.g. "Sunday 4pm works for everyone, including Mark at 9pm in London, and Mia's out of school."
No health details. Return JSON only.`;

export async function planSlots(muse: Muse, c: Constraints, opts: { preferredWindow?: string; now: number; count?: number }): Promise<PlanResult> {
  const n = opts.count ?? 3;
  const { valid, partial } = generateCandidates(c);
  const flex = valid.length === 0;
  let pool = flex ? partial : valid;
  if (pool.length === 0) return { slots: [], flex: true };
  const preferred = pool.filter((iv) => matchesPreference(iv, opts.preferredWindow, c.senior.tz));
  if (preferred.length >= n) pool = preferred;
  const sorted = [...pool].sort((a, b) => heuristicScore(c, b, opts.preferredWindow, opts.now) - heuristicScore(c, a, opts.preferredWindow, opts.now));
  const heuristic = diversePicks(sorted, n, c.senior.tz);

  let chosen: { iv: Candidate; reason?: string }[] = [];
  if (muse.enabled) {
    const shortlist = diversePicks(sorted, Math.min(12, sorted.length), c.senior.tz);
    const lines = shortlist.map((iv) => {
      const lt = Object.entries(localTimesFor(c, iv.start)).map(([id, t]) => `${id}=${t}`).join(", ");
      return `- startUtc=${toIso(iv.start)} | ${lt}${iv.missing.length ? ` | NOT available: ${iv.missing.join(",")}` : ""}`;
    }).join("\n");
    const people = [
      `${c.senior.id} (${c.senior.name}, ${c.senior.tz}; routine: ${c.senior.routine.map((r) => r.label).join(", ")})`,
      ...c.members.map((m) => `${m.id} (${m.name}, ${m.tz})`),
      ...c.dependents.map((d) => `${d.name} (child of ${d.parentId}, school hours respected)`),
    ].join("\n");
    const res = await muse.json<{ picks: { startUtc: string; reason: string }[] }>({
      name: "rank_slots",
      schema: RANK_SCHEMA,
      // The voice agent may be waiting on this mid-conversation; the heuristic ranking is a fine fallback.
      timeoutMs: 12_000,
      effort: "low",
      system: RANK_SYSTEM,
      user: `People:\n${people}\nFamily rhythm: Danny usually calls Sundays ~4pm Rose's time.\n` +
        (opts.preferredWindow ? `Requested: ${opts.preferredWindow}\n` : "") +
        (flex ? "No time works for everyone; these are the next best. Say who would need to flex.\n" : "") +
        `Candidates:\n${lines}`,
    });
    for (const p of res?.picks ?? []) {
      const t = Date.parse(p.startUtc);
      if (Number.isNaN(t)) continue;
      // Hard constraints are enforced here, in code: a Muse pick must match a generated candidate AND re-pass checkSlot.
      const iv = pool.find((x) => x.start === t);
      if (!iv) continue;
      const violations = checkSlot(c, iv, opts.now).filter((v) => !(flex && v.startsWith("member_unavailable:")));
      if (violations.length) continue;
      if (chosen.some((x) => x.iv.start === t)) continue;
      chosen.push({ iv, reason: p.reason?.trim() });
      if (chosen.length >= n) break;
    }
  }
  for (const iv of heuristic) {
    if (chosen.length >= n) break;
    if (!chosen.some((x) => x.iv.start === iv.start)) chosen.push({ iv });
  }
  chosen = chosen.sort((a, b) => a.iv.start - b.iv.start);

  const slots: Slot[] = chosen.map(({ iv, reason }) => ({
    id: newId("slot"),
    startUtc: toIso(iv.start),
    endUtc: toIso(iv.end),
    reason: reason && reason.length > 10 && reason.length < 300 && !/medic|doctor|pill/i.test(reason) ? reason : templateReason(c, iv),
    localTimes: localTimesFor(c, iv.start),
  }));
  let flexNote: string | undefined;
  if (flex) {
    const missing = [...new Set(chosen.flatMap((x) => x.iv.missing))];
    const names = c.members.filter((m) => missing.includes(m.id)).map((m) => m.name);
    flexNote = `There's no time this week that works for everyone. These are the closest. ${names.join(" and ")}, could you flex for one of them?`;
  }
  return { slots, flex, flexNote };
}
