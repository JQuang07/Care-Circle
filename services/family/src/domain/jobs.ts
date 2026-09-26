import { DateTime } from "luxon";
import type { CallEnded } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { newId } from "../ids.js";
import type { ScheduledCallRecord } from "../store/types.js";
import { getCircle, memberName } from "./circle.js";
import { recentHooks } from "./hooks.js";
import { sendMessage } from "./messages.js";
import { computeContactRhythm } from "./rhythm.js";
import { buildConstraints, checkSlot } from "./scheduling/constraints.js";
import { createScheduledCall, requestSchedule, toScheduledCall } from "./scheduling/proposals.js";
import { formatLocal } from "./time.js";

const MIN = 60_000;
export const BRIEFING_LEAD = 60 * MIN;
export const REMINDER_LEAD = 30 * MIN;
const MISSED_AFTER = 90 * MIN;

async function sendBriefings(deps: Deps, sc: ScheduledCallRecord) {
  const { senior, members } = await getCircle(deps, sc.seniorId);
  const hooks = await recentHooks(deps, sc.seniorId);
  const starters = hooks.length
    ? `A few things ${senior.name} mentioned lately:\n${hooks.map((h) => `• ${h.text}`).join("\n")}`
    : `Ask ${senior.name} about her week. She loves hearing about yours too.`;
  for (const mid of sc.memberIds) {
    const m = members.find((x) => x.id === mid);
    if (!m) continue;
    const others = sc.memberIds.filter((x) => x !== mid).map((x) => memberName(members, x));
    const host = sc.hostMemberId === mid ? `\n\nYou're hosting: say hi first and bring ${others.length ? others.join(" and ") : "everyone"} in.` : "";
    const what = sc.kind === "visit" ? "Your visit with" : "Your call with";
    await sendMessage(deps, {
      toMemberId: mid, kind: "briefing",
      body: `${what} ${senior.name} starts in an hour (${formatLocal(sc.startUtc, m.tz)} your time).\n\n${starters}${host}`,
      actions: [
        ...(sc.kind === "video_call" ? [{ label: "Join call", action: "call_now", payload: { scheduledCallId: sc.id, url: sc.memberJoinUrls[mid] } }] : []),
        { label: "Got it", action: "dismiss", payload: {} },
      ],
    });
  }
}

/** One pass of the scheduler: T-60 briefing, T-30 reminder, T-0 due + ringing, and missed detection. */
export async function tick(deps: Deps): Promise<{ briefings: number; reminders: number; due: number; missed: number }> {
  const now = deps.clock.now().getTime();
  const out = { briefings: 0, reminders: 0, due: 0, missed: 0 };
  const calls = (await deps.store.scheduledCalls.list()).filter((c) => c.status === "scheduled" || c.status === "ringing" || c.status === "live");
  for (const sc of calls) {
    const start = Date.parse(sc.startUtc);
    try {
      if (sc.status === "scheduled" && now >= start + MISSED_AFTER) {
        sc.status = "missed"; out.missed++;
        await deps.store.scheduledCalls.put(sc);
        continue;
      }
      if (!sc.briefingSentAt && now >= start - BRIEFING_LEAD && now < start + 15 * MIN) {
        await sendBriefings(deps, sc);
        sc.briefingSentAt = new Date(now).toISOString(); out.briefings++;
        await deps.store.scheduledCalls.put(sc);
      }
      if (sc.kind !== "video_call") continue; // visits have no phone leg
      if (!sc.reminderSentAt && now >= start - REMINDER_LEAD && now < start) {
        await deps.voice.scheduledCallDue(toScheduledCall(sc), "reminder");
        sc.reminderSentAt = new Date(now).toISOString(); out.reminders++;
        await deps.store.scheduledCalls.put(sc);
      }
      if (!sc.dueSentAt && now >= start && sc.status === "scheduled") {
        sc.status = "ringing";
        await deps.voice.scheduledCallDue(toScheduledCall(sc), "due");
        sc.dueSentAt = new Date(now).toISOString(); out.due++;
        await deps.store.scheduledCalls.put(sc);
      }
      if ((sc.status === "ringing" || sc.status === "live") && now >= start + MISSED_AFTER) {
        sc.status = "missed"; out.missed++;
        await deps.store.scheduledCalls.put(sc);
      }
    } catch (err) {
      // Voice may be down; leave the flag unset so the next tick retries.
      deps.log.warn({ err: String(err), scheduledCallId: sc.id }, "scheduler step failed; will retry");
    }
  }
  return out;
}

/** call.ended for a scheduled family call → done, moment logged, weekly offer, next occurrence if recurring. */
export async function handleScheduledCallEnded(deps: Deps, call: CallEnded): Promise<ScheduledCallRecord | undefined> {
  const started = Date.parse(call.startedAt);
  const candidates = (await deps.store.scheduledCalls.list({ seniorId: call.seniorId }))
    .filter((c) => c.kind === "video_call" && ["scheduled", "ringing", "live", "missed"].includes(c.status))
    .filter((c) => Math.abs(Date.parse(c.startUtc) - started) <= 3 * 3600_000)
    .sort((a, b) => Math.abs(Date.parse(a.startUtc) - started) - Math.abs(Date.parse(b.startUtc) - started));
  const sc = candidates[0];
  if (!sc) return undefined;
  sc.status = "done";
  sc.endedAt = call.endedAt;
  await deps.store.scheduledCalls.put(sc);

  for (const mid of sc.memberIds) {
    await deps.store.calls.put({ id: `call_${sc.id}_${mid}`, seniorId: sc.seniorId, memberId: mid, startedAt: call.startedAt, endedAt: call.endedAt, source: "scheduled" });
  }
  await deps.store.moments.put({ id: newId("evt"), seniorId: sc.seniorId, type: "call", at: call.endedAt, ref: sc.id });

  const { senior } = await getCircle(deps, sc.seniorId);
  if (sc.recurring === "weekly") {
    await scheduleNextOccurrence(deps, sc);
  } else if (!sc.weeklyOfferSentAt) {
    const day = DateTime.fromISO(sc.startUtc, { zone: senior.tz }).toFormat("cccc");
    for (const mid of sc.memberIds) {
      await sendMessage(deps, {
        toMemberId: mid, kind: "text",
        body: `That was lovely. Make this a weekly ${day} call with ${senior.name}? We'll take turns hosting.`,
        actions: [
          { label: `Yes, every ${day}`, action: "make_weekly", payload: { scheduledCallId: sc.id } },
          { label: "Not now", action: "decline_weekly", payload: { scheduledCallId: sc.id } },
        ],
      });
    }
    sc.weeklyOfferSentAt = deps.clock.now().toISOString();
    await deps.store.scheduledCalls.put(sc);
  }
  return sc;
}

/** +7 days, same people, new room, next host in the rotation. Skips (and says so) if Rose's calendar is now busy. */
export async function scheduleNextOccurrence(deps: Deps, sc: ScheduledCallRecord): Promise<ScheduledCallRecord | undefined> {
  const { senior, members } = await getCircle(deps, sc.seniorId);
  // Same local wall-clock time next week (DST-safe), not +168h.
  const nextStart = DateTime.fromISO(sc.startUtc, { zone: senior.tz }).plus({ weeks: 1 });
  const durMs = Date.parse(sc.endUtc) - Date.parse(sc.startUtc);
  const startIso = nextStart.toUTC().toISO()!;
  const existing = (await deps.store.scheduledCalls.list({ proposalId: sc.proposalId })).find((c) => c.startUtc === startIso);
  if (existing) return existing;
  const now = deps.clock.now();
  const c = await buildConstraints(deps, { senior, members, memberIds: sc.memberIds, includeDependents: false, kind: sc.kind, now, horizonDays: 15 });
  const violations = checkSlot(c, { start: nextStart.toMillis(), end: nextStart.toMillis() + durMs }, now.getTime())
    .filter((v) => !v.startsWith("member_unavailable:") && v !== "outside_horizon");
  if (violations.length) {
    deps.log.warn({ violations, scheduledCallId: sc.id }, "weekly occurrence skipped");
    return undefined;
  }
  const next = await createScheduledCall(deps, {
    proposalId: sc.proposalId, seniorId: sc.seniorId, memberIds: sc.memberIds, kind: sc.kind,
    startUtc: startIso, endUtc: new Date(nextStart.toMillis() + durMs).toISOString(), recurring: "weekly",
  });
  for (const mid of sc.memberIds) {
    const m = members.find((x) => x.id === mid)!;
    const host = next.hostMemberId === mid ? " You're hosting this one." : ` ${memberName(members, next.hostMemberId ?? "")} is hosting.`;
    await sendMessage(deps, {
      toMemberId: mid, kind: "text",
      body: `Next weekly call with ${senior.name}: ${formatLocal(next.startUtc, m.tz)} your time.${host}`,
      actions: [{ label: "Join call", action: "open_url", payload: { url: next.memberJoinUrls[mid], scheduledCallId: next.id } }],
    });
  }
  return next;
}

export async function makeWeekly(deps: Deps, scheduledCallId: string, actorId: string) {
  const sc = await deps.store.scheduledCalls.get(scheduledCallId);
  if (!sc) return { ok: false, reason: "not_found" };
  if (sc.recurring === "weekly") return { ok: true, alreadyWeekly: true };
  sc.recurring = "weekly";
  await deps.store.scheduledCalls.put(sc);
  const next = await scheduleNextOccurrence(deps, sc);
  const { members } = await getCircle(deps, sc.seniorId);
  for (const mid of sc.memberIds.filter((m) => m !== actorId)) {
    await sendMessage(deps, { toMemberId: mid, kind: "text", body: `${memberName(members, actorId)} made it a weekly call.` });
  }
  return { ok: true, nextScheduledCallId: next?.id };
}

/**
 * ai_rhythm: a member's weekly pattern (e.g. Danny's Sunday call) broken twice running →
 * suggest a call to that member. Never to Rose, never with guilt.
 */
export async function runRhythmJob(deps: Deps, seniorId: string): Promise<string[]> {
  const { senior } = await getCircle(deps, seniorId);
  const now = deps.clock.now();
  const nowLocal = DateTime.fromJSDate(now).setZone(senior.tz);
  const rhythm = await computeContactRhythm(deps, seniorId);
  const calls = await deps.store.calls.list({ seniorId });
  const created: string[] = [];
  for (const pm of rhythm.perMember) {
    const pattern = pm.usualPattern?.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s ~/);
    if (!pattern) continue;
    const weekday = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(pattern[1]) + 1;
    // The two most recent occurrences of that weekday that are fully over (end of that local day).
    let d = nowLocal.startOf("day");
    const occurrences: DateTime[] = [];
    while (occurrences.length < 2) {
      d = d.minus({ days: 1 });
      if (d.weekday === weekday) occurrences.push(d);
    }
    const hadCall = (day: DateTime) => calls.some((c) => c.memberId === pm.memberId && DateTime.fromISO(c.startedAt, { zone: senior.tz }).hasSame(day, "day"));
    if (occurrences.some(hadCall)) continue;
    // Already something in motion for this member? Don't pile on.
    const open = (await deps.store.proposals.list({ seniorId })).some((p) =>
      p.memberIds.includes(pm.memberId) && (p.status === "proposed" || p.status === "awaiting_senior" ||
        (p.initiatedBy === "ai_rhythm" && now.getTime() - Date.parse(p.createdAt) < 7 * 86_400_000)));
    const booked = (await deps.store.scheduledCalls.list({ seniorId })).some((c) => c.memberIds.includes(pm.memberId) && c.status === "scheduled");
    if (open || booked) continue;
    try {
      const p = await requestSchedule(deps, { seniorId, kind: "video_call", memberIds: [pm.memberId], initiatedBy: "ai_rhythm", preferredWindow: pattern[1].toLowerCase() });
      created.push(p.id);
    } catch (err) {
      deps.log.warn({ err: String(err), memberId: pm.memberId }, "rhythm suggestion failed");
    }
  }
  return created;
}
