import { DateTime } from "luxon";
import type { Moments } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { badRequest } from "../deps.js";
import { getCircle } from "./circle.js";

/**
 * D12: a calendar week, Monday 00:00 → next Monday in the senior's time zone. `week` is an ISO week
 * (2026-W39) or any date in it (YYYY-MM-DD); omitted or "current" means this week. "last7" (rolling
 * last 7 days) is kept for older callers.
 */
export function weekRange(week: string | undefined, tz: string, now: Date): { start: number; end: number } {
  if (week === "last7") return { start: now.getTime() - 7 * 86_400_000, end: now.getTime() + 1 };
  const anchor = !week || week === "current" ? DateTime.fromJSDate(now).setZone(tz)
    : /^\d{4}-W\d{2}$/.test(week) ? DateTime.fromISO(`${week}-1`, { zone: tz }) : DateTime.fromISO(week, { zone: tz });
  if (!anchor.isValid) throw badRequest(`invalid week "${week}" (use YYYY-MM-DD, YYYY-Www, current or last7)`);
  const start = anchor.startOf("week");
  return { start: start.toMillis(), end: start.plus({ weeks: 1 }).toMillis() };
}

export async function computeMoments(deps: Deps, seniorId: string, week?: string): Promise<Moments> {
  const { senior } = await getCircle(deps, seniorId);
  const { start, end } = weekRange(week, senior.tz, deps.clock.now());
  const inWeek = (iso?: string) => !!iso && Date.parse(iso) >= start && Date.parse(iso) < end;

  const calls = (await deps.store.calls.list({ seniorId })).filter((c) => inWeek(c.startedAt)).length;
  const events = (await deps.store.moments.list({ seniorId })).filter((e) => inWeek(e.at));
  const count = (t: string) => events.filter((e) => e.type === t).length;

  // Scams stopped + dollars saved: Agent 2's holds are the source of truth; local copies are the fallback.
  let scamsStopped = 0;
  let savedCents = 0;
  try {
    const [holds, orders] = await Promise.all([deps.money.listHolds(seniorId), deps.money.listOrders(seniorId)]);
    const amount = new Map(orders.map((o) => [o.id, o.request?.amountCents ?? 0]));
    for (const h of holds) {
      if (h.status !== "cancelled" && h.status !== "expired_cooling_off") continue;
      if (!inWeek(h.resolution?.at ?? h.createdAt)) continue;
      scamsStopped++;
      savedCents += amount.get(h.orderId) ?? 0;
    }
  } catch (err) {
    deps.log.warn({ err: String(err) }, "money /holds unavailable; using locally seen holds");
    for (const h of await deps.store.holds.list({ seniorId })) {
      if ((h.status === "cancelled" || h.status === "expired_cooling_off") && inWeek(h.resolvedAt ?? h.createdAt)) {
        scamsStopped++;
        savedCents += h.amountCents;
      }
    }
  }
  return {
    calls,
    voiceNotes: count("voice_note"),
    gifts: count("gift"),
    addedItems: count("added_item"),
    scamsStopped,
    savedCents,
  };
}
