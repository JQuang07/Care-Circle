import { DateTime } from "luxon";
import type { ContactRhythm } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import type { CallRecord } from "../seed-data.js";
import { getCircle } from "./circle.js";

const DAY = 24 * 3600 * 1000;
const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function hourLabel(minutes: number): string {
  const h = Math.round(minutes / 60) % 24;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${suffix}`;
}

function partOfDay(minutes: number): string {
  if (minutes < 12 * 60) return "mornings";
  if (minutes < 17 * 60) return "afternoons";
  return "evenings";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Plain-English pattern from the last 8 weeks, in the senior's time zone. */
export function describePattern(calls: CallRecord[], tz: string, now: Date): string | undefined {
  const since = now.getTime() - 56 * DAY;
  const recent = calls.filter((c) => {
    const t = Date.parse(c.startedAt);
    return t >= since && t <= now.getTime();
  });
  if (recent.length === 0) return undefined;
  const local = recent.map((c) => DateTime.fromISO(c.startedAt, { zone: tz }));
  const byDay = new Map<number, DateTime[]>();
  for (const dt of local) byDay.set(dt.weekday, [...(byDay.get(dt.weekday) ?? []), dt]);
  const [topDay, topCalls] = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const mins = median(topCalls.map((d) => d.hour * 60 + d.minute));
  const dayName = WEEKDAY_NAMES[topDay];

  if (topCalls.length >= 4) {
    const base = `${dayName}s ~${hourLabel(mins)}`;
    const midweek = (d: number) => d >= 2 && d <= 4;
    const midweekShare = local.filter((d) => midweek(d.weekday)).length / local.length;
    if (midweek(topDay) && midweekShare >= 0.6) return `Midweek, usually ${base}`;
    return base;
  }
  if (recent.length >= 4) return `A few times a month, often ${dayName} ${partOfDay(mins)}`;
  return `About once a month, usually ${dayName} ${partOfDay(mins)}`;
}

export async function computeContactRhythm(deps: Deps, seniorId: string): Promise<ContactRhythm> {
  const { senior, members } = await getCircle(deps, seniorId);
  const now = deps.clock.now();
  const all = (await deps.store.calls.list({ seniorId })).filter((c) => Date.parse(c.startedAt) <= now.getTime());
  return {
    seniorId,
    perMember: members.map((m) => {
      const mine = all.filter((c) => c.memberId === m.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const last = mine[mine.length - 1];
      return {
        memberId: m.id,
        lastContactAt: last?.startedAt,
        usualPattern: describePattern(mine, senior.tz, now),
        callsLast30d: mine.filter((c) => Date.parse(c.startedAt) >= now.getTime() - 30 * DAY).length,
        // CONTRACTS §3 types this as literal false: the app has no member→senior money-request path,
        // so no member has ever asked Rose for money through it.
        everAskedForMoney: false as const,
      };
    }),
  };
}
