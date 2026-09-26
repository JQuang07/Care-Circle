import type { Circle, ContactRhythm, Credential } from './contracts';
import type { LedgerEntry } from './store/store';

// CONTRACTS.md §2 — fixed IDs everyone uses.
export const ROSE_ID = 'sen_rose';
export const ROSE_TZ = 'America/New_York';

export const SEED_CIRCLE: Circle = {
  senior: { id: ROSE_ID, name: 'Rose', age: 81, tz: ROSE_TZ, phone: '+1555010000', language: 'en' },
  members: [
    { id: 'mem_lisa', name: 'Lisa', relation: 'daughter', tz: 'America/Chicago', phone: '+1555010001',
      whatsapp: true, isVerifier: true, dependents: [{ name: 'Mia', age: 9, schoolHours: '08:00-15:30 mon-fri' }] },
    { id: 'mem_danny', name: 'Danny', relation: 'grandson', tz: 'America/Denver', phone: '+1555010002',
      whatsapp: true, isVerifier: true },
    { id: 'mem_mark', name: 'Mark', relation: 'son', tz: 'Europe/London', phone: '+1555010003',
      whatsapp: true, isVerifier: false },
  ],
};

export const MERCHANTS = [
  { id: 'mer_freshmart', name: 'FreshMart', category: 'grocery' },
  { id: 'mer_cornerrx', name: 'CornerRx', category: 'pharmacy' },
  { id: 'mer_crumb', name: 'Sweet Crumb Bakery', category: 'bakery' },
  { id: 'mer_ridemock', name: 'RideMock', category: 'rides' },
] as const;
export const KNOWN_MERCHANT_IDS = new Set<string>(MERCHANTS.map((m) => m.id));
export const merchantName = (id?: string) => MERCHANTS.find((m) => m.id === id)?.name;

export const SEED_CREDENTIAL: Credential = {
  seniorId: ROSE_ID, perPurchaseCapCents: 15000, monthlyCapCents: 80000,
  blockedCategories: ['wire', 'crypto', 'money_transfer', 'gift_card_nonmember'],
  fundedBy: ['mem_lisa', 'mem_mark'],
};

/** Fallback contact rhythm (used in MOCK and if family is unreachable). Relative to `now`. */
export function seedContactRhythm(now: Date): ContactRhythm {
  const lastSunday = new Date(now);
  lastSunday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 7) % 7 || 7));
  lastSunday.setUTCHours(21, 0, 0, 0); // ~4pm ET
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();
  return {
    seniorId: ROSE_ID,
    perMember: [
      { memberId: 'mem_danny', lastContactAt: lastSunday.toISOString(), usualPattern: 'Sundays ~4pm',
        callsLast30d: 4, everAskedForMoney: false },
      { memberId: 'mem_lisa', lastContactAt: daysAgo(3), usualPattern: 'Wednesdays and Saturdays',
        callsLast30d: 7, everAskedForMoney: false },
      { memberId: 'mem_mark', lastContactAt: daysAgo(12), usualPattern: 'every other week',
        callsLast30d: 2, everAskedForMoney: false },
    ],
  };
}

// Deterministic PRNG so the seed and the eval are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rose's 60-day purchase history ending just before `anchor`:
 * weekly FreshMart $40–70, a monthly CornerRx refill, occasional RideMock rides,
 * a bakery treat now and then. All mid-morning to early afternoon Eastern.
 */
export function generateHistory(anchor: Date, seniorId = ROSE_ID): LedgerEntry[] {
  const rand = mulberry32(20260915);
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) / 10) * 10;
  const at = (daysAgo: number, utcHour: number) => {
    const d = new Date(anchor.getTime() - daysAgo * 86400_000);
    d.setUTCHours(utcHour, Math.floor(rand() * 60), 0, 0);
    return d.toISOString();
  };
  const out: LedgerEntry[] = [];
  let n = 0;
  const add = (daysAgo: number, hour: number, merchantId: string, category: string, amountCents: number, label: string) =>
    out.push({ id: `led_seed_${++n}`, seniorId, at: at(daysAgo, hour), merchantId, category, amountCents, label });

  for (let d = 59; d >= 1; d -= 7) add(d, 15, 'mer_freshmart', 'groceries', between(4000, 7000), 'Weekly groceries');
  for (const d of [52, 22]) add(d, 16, 'mer_cornerrx', 'pharmacy_refill', between(1500, 3500), 'Monthly prescription refill');
  for (const d of [48, 33, 26, 12, 5]) add(d, 14, 'mer_ridemock', 'ride', between(1200, 2600), 'Ride');
  for (const d of [40, 18, 9]) add(d, 17, 'mer_crumb', 'other', between(800, 1600), 'Bakery treat');

  return out.sort((a, b) => a.at.localeCompare(b.at));
}
