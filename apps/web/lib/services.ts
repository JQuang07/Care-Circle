/**
 * Which service paths the browser may reach through /api/svc. Everything else stays
 * server-to-server. In particular GET family /circle is NOT here: it returns phone
 * numbers, which CONTRACTS.md §4 marks "internal only".
 */
export type ServiceName = "voice" | "money" | "family";

export const BROWSER_ALLOWED: Record<ServiceName, { GET: RegExp[]; POST: RegExp[] }> = {
  voice: {
    GET: [/^\/health$/, /^\/demo\/calls$/ /* CCR-03 */],
    POST: [/^\/demo\/simulate-inbound$/, /^\/demo\/simulate-verification$/ /* CCR-04 */, /^\/demo\/reset$/ /* CCR-01 */],
  },
  money: {
    GET: [/^\/health$/, /^\/orders$/, /^\/holds$/, /^\/credentials\/[\w-]+$/, /^\/eval\/results$/],
    POST: [/^\/holds\/[\w-]+\/resolve$/, /^\/demo\/reset$/ /* CCR-01 */],
  },
  family: {
    GET: [/^\/health$/, /^\/messages$/, /^\/moments\/[\w-]+$/, /^\/schedule\/[\w-]+\/upcoming$/, /^\/proposals\/[\w-]+\/pending-senior$/, /^\/contact-rhythm\/[\w-]+$/],
    POST: [/^\/messages\/[\w-]+\/act$/, /^\/messages\/reply$/, /^\/demo\/fire-due$/ /* CCR-02 */, /^\/demo\/reset$/ /* CCR-01 */],
  },
};

export function serviceBaseUrl(s: ServiceName): string {
  const env = { voice: process.env.VOICE_URL, money: process.env.MONEY_URL, family: process.env.FAMILY_URL }[s];
  return env ?? { voice: "http://localhost:4001", money: "http://localhost:4002", family: "http://localhost:4003" }[s];
}
