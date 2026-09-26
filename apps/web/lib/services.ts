/**
 * Which service paths the browser may reach through /api/svc. Everything else stays
 * server-to-server. In particular GET family /circle is NOT here: it returns phone
 * numbers, which CONTRACTS.md §4 marks "internal only".
 */
export type ServiceName = "voice" | "money" | "family" | "delivery";

/**
 * `POST delivery /orders/:id/checkout` places a REAL DoorDash order. The browser must send
 * `{ confirmedBy, confirmPhrase }`; the proxy checks the phrase server-side and forwards
 * only `{ confirmedBy }`, so the typed confirmation can't be skipped by calling the API directly.
 */
export const CHECKOUT_PATH = /^\/orders\/[\w-]+\/checkout$/;
export const CHECKOUT_PHRASE = "PLACE REAL ORDER";

export const BROWSER_ALLOWED: Record<ServiceName, { GET: RegExp[]; POST: RegExp[] }> = {
  voice: {
    GET: [/^\/health$/, /^\/demo\/calls$/ /* D3 */],
    POST: [/^\/demo\/simulate-inbound$/, /^\/demo\/simulate-verification$/ /* D3 */, /^\/demo\/reset$/ /* D1 */],
  },
  money: {
    GET: [/^\/health$/, /^\/orders$/, /^\/orders\/[\w-]+$/ /* D9 */, /^\/holds$/, /^\/credentials\/[\w-]+$/, /^\/eval\/results$/],
    POST: [/^\/holds\/[\w-]+\/resolve$/, /^\/demo\/reset$/ /* D1 */],
  },
  family: {
    // `/schedule/calls/:id/join` (D11) returns a LiveKit token for one member; the browser needs it to join.
    GET: [/^\/health$/, /^\/messages$/, /^\/schedule\/calls\/[\w-]+\/join$/, /^\/moments\/[\w-]+$/, /^\/schedule\/[\w-]+\/upcoming$/, /^\/proposals\/[\w-]+\/pending-senior$/, /^\/contact-rhythm\/[\w-]+$/],
    POST: [/^\/messages\/[\w-]+\/act$/, /^\/messages\/reply$/, /^\/demo\/fire-due$/ /* D2 */, /^\/demo\/reset$/ /* D1 */],
  },
  // D14. No `/demo/advance` (mock-only test hook, not a demo control).
  delivery: {
    GET: [/^\/health$/, /^\/orders$/, /^\/orders\/[\w-]+$/],
    POST: [/^\/quote$/, CHECKOUT_PATH /* guarded again in the proxy */, /^\/demo\/reset$/ /* D1 */],
  },
};

export function serviceBaseUrl(s: ServiceName): string {
  const env = { voice: process.env.VOICE_URL, money: process.env.MONEY_URL, family: process.env.FAMILY_URL, delivery: process.env.DELIVERY_URL }[s];
  return env ?? { voice: "http://localhost:4001", money: "http://localhost:4002", family: "http://localhost:4003", delivery: "http://localhost:4004" }[s];
}

/** D1 · the order "Reset all data" resets services in. */
export const RESET_ORDER = ["family", "money", "delivery", "voice"] as const satisfies readonly ServiceName[];
