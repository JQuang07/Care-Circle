import { DateTime } from "luxon";
import type { Member, Senior } from "./contracts-local.js";

// ---- CONTRACTS §2 (fixed IDs) ----
export const SENIOR_ROSE: Senior = {
  id: "sen_rose", name: "Rose", age: 81, tz: "America/New_York",
  phone: "+1555010000", language: "en",
  routine: [
    { label: "nap", days: "daily", start: "13:00", end: "15:00" },
    { label: "church", days: "sun", start: "09:30", end: "12:00" },
  ],
};

export const MEMBERS: Member[] = [
  { id: "mem_lisa", name: "Lisa", relation: "daughter", tz: "America/Chicago", phone: "+1555010001",
    whatsapp: true, isVerifier: true, dependents: [{ name: "Mia", age: 9, schoolHours: "08:00-15:30 mon-fri" }] },
  { id: "mem_danny", name: "Danny", relation: "grandson", tz: "America/Denver", phone: "+1555010002",
    whatsapp: true, isVerifier: true },
  { id: "mem_mark", name: "Mark", relation: "son", tz: "Europe/London", phone: "+1555010003",
    whatsapp: true, isVerifier: false },
];

export const CREDENTIAL_FUNDED_BY = ["mem_lisa", "mem_mark"];

export const MERCHANTS: Record<string, { name: string; category: string }> = {
  mer_freshmart: { name: "FreshMart", category: "grocery" },
  mer_cornerrx: { name: "CornerRx", category: "pharmacy" },
  mer_crumb: { name: "Sweet Crumb Bakery", category: "bakery" },
  mer_ridemock: { name: "RideMock", category: "rides" },
};

// ---- Agent 3 seed: relationship context used to route hooks ----
export interface RelationshipFact { memberId: string; keywords: string[]; fact: string; }

export const RELATIONSHIP_FACTS: RelationshipFact[] = [
  { memberId: "mem_danny", keywords: ["tomato", "tomatoes", "garden", "plant", "planted", "seedling", "zucchini", "baseball", "rockies"],
    fact: "Danny helped Rose plant the tomatoes this spring and they talk about the garden and baseball." },
  { memberId: "mem_lisa", keywords: ["buddy", "dog", "vet", "mia", "recipe", "pie", "baking", "church", "choir", "quilt"],
    fact: "Lisa takes Buddy (Rose's dog) to his vet visits; Mia adores Buddy. Lisa and Rose swap recipes and church news." },
  { memberId: "mem_mark", keywords: ["bird", "birds", "feeder", "cardinal", "crossword", "puzzle", "photo", "photos", "dad", "london", "tea"],
    fact: "Mark and Rose share bird watching and the Sunday crossword; he loves hearing stories about Dad and old photos." },
];

// ---- Weekly availability (member-local times). Poll replies override these. ----
export interface AvailabilityBlock { days: string; start: string; end: string; }

export const WEEKLY_AVAILABILITY: Record<string, AvailabilityBlock[]> = {
  mem_lisa: [
    { days: "mon-fri", start: "16:00", end: "20:30" },
    { days: "sat-sun", start: "09:00", end: "20:00" },
  ],
  mem_danny: [
    { days: "mon-fri", start: "17:00", end: "21:00" },
    { days: "sat-sun", start: "10:00", end: "20:00" },
  ],
  mem_mark: [
    { days: "mon-fri", start: "18:00", end: "22:30" },
    { days: "sat-sun", start: "10:00", end: "22:00" },
  ],
};

/** Dependents' extra hard constraint beyond schoolHours: in bed by 8pm local. */
export const DEPENDENT_BEDTIME = "20:00";

// ---- 8 weeks of call history ----
export interface CallRecord {
  id: string; seniorId: string; memberId: string;
  startedAt: string; endedAt: string;
  source: "seed" | "scheduled" | "call_ended";
}

/**
 * Deterministic, relative to `now`, so the rhythm always looks current:
 * - Danny: most Sundays ~4pm ET (7 of the last 8; skipped 5 weeks ago)
 * - Lisa: midweek, usually Wednesday evening, plus some lunchtime check-ins
 * - Mark: rarely (twice in 8 weeks), Saturday late morning ET = afternoon in London
 */
export function generateCallHistory(now: Date, seniorId = SENIOR_ROSE.id): CallRecord[] {
  const tz = SENIOR_ROSE.tz;
  const nowEt = DateTime.fromJSDate(now).setZone(tz);
  const calls: CallRecord[] = [];
  const jitter = [5, -12, 18, -3, 9, -15, 2, 11];
  const add = (memberId: string, at: DateTime, minutes: number, tag: string) => {
    if (at >= nowEt) return;
    calls.push({
      id: `call_seed_${memberId.slice(4)}_${tag}`,
      seniorId, memberId,
      startedAt: at.toUTC().toISO()!,
      endedAt: at.plus({ minutes }).toUTC().toISO()!,
      source: "seed",
    });
  };
  // Most recent Sunday strictly before `now` (luxon weekday: Mon=1..Sun=7).
  const lastSunday = nowEt.minus({ days: nowEt.weekday % 7 }).startOf("day");
  // Week w = the Mon–Sun week ending on (lastSunday - w weeks). w = -1 is the current, unfinished week.
  for (let w = -1; w < 8; w++) {
    const sunday = lastSunday.minus({ weeks: w });
    const j = (w + 8) % 8;
    if (w !== 4 && w >= 0) add("mem_danny", sunday.set({ hour: 16, minute: 0 }).plus({ minutes: jitter[j] }), 25 + (j % 3) * 8, `w${w + 1}`);
    const wednesday = sunday.minus({ days: 4 });
    if (w < 7) add("mem_lisa", wednesday.set({ hour: 19, minute: 15 }).plus({ minutes: jitter[(j + 3) % 8] }), 18 + (j % 4) * 5, `w${w + 1}a`);
    if (w === 1 || w === 4 || w === 6) {
      add("mem_lisa", sunday.minus({ days: 5 }).set({ hour: 12, minute: 30 }), 12, `w${w + 1}b`);
    }
    if (w === 1 || w === 5) {
      add("mem_mark", sunday.minus({ days: 1 }).set({ hour: 11, minute: 0 }), 45, `w${w + 1}`);
    }
  }
  return calls.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
