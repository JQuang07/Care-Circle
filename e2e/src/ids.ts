/** Fixed seed IDs from CONTRACTS.md §2. Everyone uses these; nothing here is new data. */
export const SENIOR = { id: "sen_rose", name: "Rose", tz: "America/New_York", phone: "+1555010000" } as const;

export const MEMBERS = {
  mem_lisa: { id: "mem_lisa", name: "Lisa", relation: "daughter", tz: "America/Chicago", isVerifier: true, dependents: ["Mia"] },
  mem_danny: { id: "mem_danny", name: "Danny", relation: "grandson", tz: "America/Denver", isVerifier: true, dependents: [] },
  mem_mark: { id: "mem_mark", name: "Mark", relation: "son", tz: "Europe/London", isVerifier: false, dependents: [] },
} as const;

export type MemberId = keyof typeof MEMBERS;
export const MEMBER_IDS = Object.keys(MEMBERS) as MemberId[];
export const VERIFIER_IDS = MEMBER_IDS.filter((id) => MEMBERS[id].isVerifier);

export const MERCHANTS = {
  mer_freshmart: "FreshMart",
  mer_cornerrx: "CornerRx",
  mer_crumb: "Sweet Crumb Bakery",
  mer_ridemock: "RideMock",
} as const;

/** Rose's routine (§2), in her local time. Used to sanity-check proposed slots. */
export const ROSE_ROUTINE = [
  { label: "nap", days: "daily", start: "13:00", end: "15:00" },
  { label: "church", days: "sun", start: "09:30", end: "12:00" },
] as const;
