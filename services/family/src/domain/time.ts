import { DateTime } from "luxon";

const DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]; // luxon weekday 1..7

/** Parse "daily" | "sun" | "mon-fri" | "sat-sun" | "mon,wed,fri" into luxon weekdays (1=Mon..7=Sun). */
export function parseDays(spec: string): Set<number> {
  const s = spec.trim().toLowerCase();
  if (s === "daily" || s === "every day") return new Set([1, 2, 3, 4, 5, 6, 7]);
  if (s === "weekdays") return new Set([1, 2, 3, 4, 5]);
  if (s === "weekends") return new Set([6, 7]);
  const out = new Set<number>();
  for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((p) => DAY_NAMES.indexOf(p.slice(0, 3)) + 1);
    if (a <= 0) continue;
    if (!b) { out.add(a); continue; }
    // Wrap-around ranges like "fri-mon" are allowed.
    for (let d = a; ; d = (d % 7) + 1) { out.add(d); if (d === b) break; }
  }
  return out;
}

/** "HH:MM" → minutes after midnight. */
export function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Parse "08:00-15:30 mon-fri" → { start, end, days }. */
export function parseHoursSpec(spec: string): { start: number; end: number; days: Set<number> } {
  const [range, ...rest] = spec.trim().split(/\s+/);
  const [a, b] = range.split("-");
  return { start: hm(a), end: hm(b), days: parseDays(rest.join(" ") || "daily") };
}

export interface Interval { start: number; end: number; } // epoch ms, half-open

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Interval [startMin, endMin) on `date` (local calendar day in `tz`) as epoch ms.
 * Built with local wall-clock times, so DST transitions are handled by luxon.
 */
export function localWindow(dayLocal: DateTime, startMin: number, endMin: number): Interval {
  const d = dayLocal.startOf("day");
  const s = d.set({ hour: Math.floor(startMin / 60), minute: startMin % 60 });
  const e = endMin >= 24 * 60 ? d.plus({ days: 1 }) : d.set({ hour: Math.floor(endMin / 60), minute: endMin % 60 });
  return { start: s.toMillis(), end: e.toMillis() };
}

/** Local calendar days (in tz) that an interval touches. */
export function localDaysTouched(iv: Interval, tz: string): DateTime[] {
  const first = DateTime.fromMillis(iv.start, { zone: tz }).startOf("day");
  const last = DateTime.fromMillis(iv.end - 1, { zone: tz }).startOf("day");
  const out: DateTime[] = [];
  for (let d = first; d <= last; d = d.plus({ days: 1 })) out.push(d);
  return out;
}

const COVER_STEP = 15 * 60_000;

/**
 * Is [iv] fully inside the union of weekly windows (local, in tz)?
 * Checked in 15-minute steps against each step's own local day, so windows can chain across
 * midnight ("23:00-24:00" + "00:00-01:00") and DST shifts are handled by luxon.
 */
export function withinWeekly(iv: Interval, tz: string, windows: { days: Set<number>; start: number; end: number }[]): boolean {
  for (let t = iv.start; t < iv.end; t += COVER_STEP) {
    const day = DateTime.fromMillis(t, { zone: tz });
    const stepEnd = Math.min(t + COVER_STEP, iv.end);
    const covered = windows.some((w) => {
      if (!w.days.has(day.weekday)) return false;
      const win = localWindow(day, w.start, w.end);
      return t >= win.start && stepEnd <= win.end;
    });
    if (!covered) return false;
  }
  return true;
}

/** Does [iv] hit any weekly block (local, in tz)? Checks every local day the interval touches. */
export function hitsWeekly(iv: Interval, tz: string, blocks: { days: Set<number>; start: number; end: number }[]): boolean {
  for (const day of localDaysTouched(iv, tz)) {
    for (const b of blocks) {
      if (b.days.has(day.weekday) && overlaps(iv, localWindow(day, b.start, b.end))) return true;
    }
  }
  return false;
}

/** "Sun 4:00 PM" in the given zone. */
export function formatLocal(iso: string | number, tz: string): string {
  const dt = typeof iso === "number" ? DateTime.fromMillis(iso, { zone: tz }) : DateTime.fromISO(iso, { zone: tz });
  return dt.toFormat("ccc h:mm a");
}

/** Longer form for message bodies: "Sunday, Oct 4 at 4:00 PM". */
export function formatLocalLong(iso: string, tz: string): string {
  return DateTime.fromISO(iso, { zone: tz }).toFormat("cccc, LLL d 'at' h:mm a");
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
