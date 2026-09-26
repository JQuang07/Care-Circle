/** Independent checks on proposed slots: time-zone math and Rose's routine. */
import type { Slot } from "@care-circle/contracts";
import { MEMBERS, SENIOR } from "./ids";

const TZ: Record<string, string> = { [SENIOR.id]: SENIOR.tz, ...Object.fromEntries(Object.values(MEMBERS).map((m) => [m.id, m.tz])) };

function parts(iso: string, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday!, hour: Number(p.hour), minute: Number(p.minute), ampm: p.dayPeriod!.toUpperCase() };
}

/** Parses "Sun 4:00 PM" / "Sunday 4pm" loosely. Returns undefined if unreadable. */
function readLocal(s: string) {
  const m = s.replace(/[\u202f\u00a0]/g, " ").match(/^([A-Za-z]{3})[a-z]*\.?,?\s+(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?/);
  if (!m) return undefined;
  return { weekday: m[1]!, hour: Number(m[2]), minute: Number(m[3] ?? 0), ampm: `${m[4]!.toUpperCase()}M` };
}

/** Returns human-readable problems; empty means the slot checks out. `unreadable` are format-only warnings. */
export function checkSlot(slot: Slot) {
  const problems: string[] = [];
  const unreadable: string[] = [];
  for (const [who, shown] of Object.entries(slot.localTimes)) {
    const tz = TZ[who];
    if (!tz) { problems.push(`localTimes has unknown id "${who}"`); continue; }
    const want = parts(slot.startUtc, tz);
    const got = readLocal(shown);
    if (!got) { unreadable.push(`${who}: "${shown}"`); continue; }
    if (got.weekday !== want.weekday || got.hour !== want.hour || got.minute !== want.minute || got.ampm !== want.ampm) {
      problems.push(`${who} (${tz}) shows "${shown}" but ${slot.startUtc} is ${want.weekday} ${want.hour}:${String(want.minute).padStart(2, "0")} ${want.ampm} there`);
    }
  }
  // Rose's routine, in her local time (§2): nap 13:00–15:00 daily, church Sun 09:30–12:00.
  const toMin = (iso: string) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: SENIOR.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: p.weekday!, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  };
  const s = toMin(slot.startUtc);
  const e = toMin(slot.endUtc);
  const endMin = e.day === s.day ? e.min : 24 * 60;
  const overlaps = (a: number, b: number) => s.min < b && endMin > a;
  if (overlaps(13 * 60, 15 * 60)) problems.push(`overlaps Rose's nap (13:00–15:00 ET): ${slot.startUtc}`);
  if (s.day === "Sun" && overlaps(9 * 60 + 30, 12 * 60)) problems.push(`overlaps Rose's church (Sun 09:30–12:00 ET): ${slot.startUtc}`);
  return { problems, unreadable };
}
