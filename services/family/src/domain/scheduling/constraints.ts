import { DateTime } from "luxon";
import type { Member, Order, Senior } from "../../contracts-local.js";
import type { Deps } from "../../deps.js";
import { DEPENDENT_BEDTIME, WEEKLY_AVAILABILITY, type AvailabilityBlock } from "../../seed-data.js";
import { hitsWeekly, hm, localWindow, overlaps, parseDays, parseHoursSpec, withinWeekly, type Interval } from "../time.js";

/** Rose's comfortable window, local time (brief: 10:00–19:00). */
export const SENIOR_WINDOW = { start: hm("10:00"), end: hm("19:00") };
export const STEP_MIN = 30;
export const DURATION_MIN = { video_call: 30, visit: 120 } as const;

type Weekly = { days: Set<number>; start: number; end: number; label?: string };

export interface ParticipantConstraint { id: string; name: string; tz: string; windows: Weekly[]; }
export interface DependentConstraint { name: string; parentId: string; tz: string; blocked: Weekly[]; bedtime: number; }
export interface BusyBlock extends Interval { label: string; }

export interface Constraints {
  senior: { id: string; name: string; tz: string; routine: Weekly[] };
  members: ParticipantConstraint[];
  dependents: DependentConstraint[];
  busy: BusyBlock[];
  durationMin: number;
  horizon: Interval;
  excludedStarts: Set<number>;
}

export type Violation =
  | "in_past" | "outside_horizon" | "outside_senior_window"
  | `senior_routine:${string}` | `senior_busy:${string}`
  | `member_unavailable:${string}` | `dependent_school:${string}` | `dependent_bedtime:${string}` | "excluded";

function toWeekly(blocks: AvailabilityBlock[]): Weekly[] {
  return blocks.map((b) => ({ days: parseDays(b.days), start: hm(b.start), end: hm(b.end) }));
}

/** Pulls a ride's pickup time from a money Order, if one is present anywhere sensible. See CCR-2. */
export function rideInterval(order: Order): BusyBlock | undefined {
  if (order.request?.type !== "ride" || order.status === "cancelled") return undefined;
  const req: any = order.request;
  const candidates: unknown[] = [req.pickupAt, req.scheduledFor, req.context?.pickupAt, ...(req.items ?? []).map((i: any) => i?.name)];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const m = c.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})/);
    if (!m) continue;
    const t = Date.parse(m[0]);
    if (Number.isNaN(t)) continue;
    // Busy from 30 min before pickup to 2h after (the ride + the errand).
    return { start: t - 30 * 60_000, end: t + 120 * 60_000, label: "ride" };
  }
  return undefined;
}

export interface BuildInput {
  senior: Senior;
  members: Member[];
  memberIds: string[];
  includeDependents: boolean;
  kind: "video_call" | "visit";
  now: Date;
  horizonDays?: number;
  excludedStarts?: string[];
}

export async function loadBusy(deps: Deps, seniorId: string): Promise<BusyBlock[]> {
  const busy: BusyBlock[] = [];
  for (const sc of await deps.store.scheduledCalls.list({ seniorId })) {
    if (sc.status === "scheduled" || sc.status === "ringing" || sc.status === "live") {
      busy.push({ start: Date.parse(sc.startUtc), end: Date.parse(sc.endUtc), label: sc.kind === "visit" ? "visit" : "call" });
    }
  }
  try {
    for (const o of await deps.money.listOrders(seniorId)) {
      const r = rideInterval(o);
      if (r) busy.push(r);
    }
  } catch (err) {
    deps.log.warn({ err: String(err) }, "money /orders unavailable; scheduling without booked rides");
  }
  return busy;
}

export async function buildConstraints(deps: Deps, input: BuildInput, busy?: BusyBlock[]): Promise<Constraints> {
  const { senior, members, memberIds, includeDependents, kind, now } = input;
  const participants: ParticipantConstraint[] = [];
  for (const id of memberIds) {
    const m = members.find((x) => x.id === id)!;
    const override = await deps.store.availability.get(id);
    participants.push({ id, name: m.name, tz: m.tz, windows: toWeekly(override?.blocks ?? WEEKLY_AVAILABILITY[id] ?? []) });
  }
  const dependents: DependentConstraint[] = [];
  if (includeDependents) {
    for (const id of memberIds) {
      const parent = members.find((x) => x.id === id)!;
      for (const d of parent.dependents ?? []) {
        const school = parseHoursSpec(d.schoolHours);
        dependents.push({ name: d.name, parentId: parent.id, tz: parent.tz, blocked: [{ ...school, label: "school" }], bedtime: hm(DEPENDENT_BEDTIME) });
      }
    }
  }
  // Earliest start: 2h from now, rounded up to the grid.
  const step = STEP_MIN * 60_000;
  const earliest = Math.ceil((now.getTime() + 2 * 3600_000) / step) * step;
  return {
    senior: {
      id: senior.id, name: senior.name, tz: senior.tz,
      routine: senior.routine.map((r) => ({ days: parseDays(r.days), start: hm(r.start), end: hm(r.end), label: r.label })),
    },
    members: participants,
    dependents,
    busy: busy ?? (await loadBusy(deps, senior.id)),
    durationMin: DURATION_MIN[kind],
    horizon: { start: earliest, end: now.getTime() + (input.horizonDays ?? 8) * 24 * 3600_000 },
    excludedStarts: new Set((input.excludedStarts ?? []).map((s) => Date.parse(s))),
  };
}

/** Senior- and dependent-side hard constraints. Never relaxed. */
export function seniorViolations(c: Constraints, iv: Interval, now?: number): Violation[] {
  const v: Violation[] = [];
  if (now !== undefined && iv.start <= now) v.push("in_past");
  const day = DateTime.fromMillis(iv.start, { zone: c.senior.tz });
  const win = localWindow(day, SENIOR_WINDOW.start, SENIOR_WINDOW.end);
  if (iv.start < win.start || iv.end > win.end) v.push("outside_senior_window");
  for (const r of c.senior.routine) if (hitsWeekly(iv, c.senior.tz, [r])) v.push(`senior_routine:${r.label}`);
  for (const b of c.busy) if (overlaps(iv, b)) v.push(`senior_busy:${b.label}`);
  for (const d of c.dependents) {
    if (hitsWeekly(iv, d.tz, d.blocked)) v.push(`dependent_school:${d.name}`);
    const local = DateTime.fromMillis(iv.end, { zone: d.tz });
    const endMin = local.hour * 60 + local.minute;
    const startLocal = DateTime.fromMillis(iv.start, { zone: d.tz });
    if (endMin > d.bedtime || startLocal.day !== local.day || startLocal.hour < 7) v.push(`dependent_bedtime:${d.name}`);
  }
  return v;
}

export function unavailableMembers(c: Constraints, iv: Interval): string[] {
  return c.members.filter((m) => !withinWeekly(iv, m.tz, m.windows)).map((m) => m.id);
}

/** Every hard constraint, checked in code. Muse output goes through this before anyone sees it. */
export function checkSlot(c: Constraints, iv: Interval, now?: number): Violation[] {
  const v = seniorViolations(c, iv, now);
  if (iv.start < c.horizon.start - 1 || iv.start > c.horizon.end) v.push("outside_horizon");
  if (c.excludedStarts.has(iv.start)) v.push("excluded");
  for (const id of unavailableMembers(c, iv)) v.push(`member_unavailable:${id}`);
  return v;
}

export interface Candidate extends Interval { missing: string[]; }

/**
 * Walks the horizon on a 30-minute grid. Returns fully valid slots, or, if there are none,
 * the "next best" slots that satisfy every senior/dependent constraint but miss the fewest members.
 */
export function generateCandidates(c: Constraints): { valid: Candidate[]; partial: Candidate[] } {
  const step = STEP_MIN * 60_000;
  const dur = c.durationMin * 60_000;
  const valid: Candidate[] = [];
  const partial: Candidate[] = [];
  for (let t = c.horizon.start; t + dur <= c.horizon.end; t += step) {
    const iv = { start: t, end: t + dur };
    if (c.excludedStarts.has(t) || seniorViolations(c, iv).length) continue;
    const missing = unavailableMembers(c, iv);
    (missing.length === 0 ? valid : partial).push({ ...iv, missing });
  }
  if (valid.length) return { valid, partial: [] };
  const fewest = Math.min(...partial.map((p) => p.missing.length));
  return { valid, partial: partial.filter((p) => p.missing.length === fewest && p.missing.length < c.members.length) };
}
