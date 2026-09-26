import type { Circle, ContactRhythm } from './contracts';
import { SEED_CIRCLE, seedContactRhythm } from './seed';

export interface FamilyClient {
  getCircle(seniorId: string): Promise<Circle>;
  getContactRhythm(seniorId: string): Promise<ContactRhythm>;
}

export const seedFamilyClient = (now: () => Date): FamilyClient => ({
  getCircle: async () => structuredClone(SEED_CIRCLE),
  getContactRhythm: async () => seedContactRhythm(now()),
});

/** Agent 3's API. Falls back to seed data (with a warning) so fraud checks never stall. */
export function httpFamilyClient(baseUrl: string, secret: string, now: () => Date, warn: (m: string) => void): FamilyClient {
  const fallback = seedFamilyClient(now);
  async function get<T>(path: string, fb: () => Promise<T>): Promise<T> {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { 'X-CC-Secret': secret }, signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      warn(`family ${path} unavailable (${(e as Error).message}); using seed data`);
      return fb();
    }
  }
  return {
    getCircle: (id) => get(`/circle/${id}`, () => fallback.getCircle(id)),
    getContactRhythm: (id) => get(`/contact-rhythm/${id}`, () => fallback.getContactRhythm(id)),
  };
}
