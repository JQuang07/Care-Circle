import type { Config } from "../config.js";
import type { Hold, Order, ScheduledCall } from "../contracts-local.js";

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function call<T>(cfg: Config, base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "X-CC-Secret": cfg.internalSecret, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ServiceError(res.status, json?.error?.code ?? "UPSTREAM_ERROR", json?.error?.message ?? `${method} ${path} → ${res.status}`);
  }
  return json as T;
}

export type DuePhase = "reminder" | "due";

/** Agent 1 · voice (:4001) */
export interface VoiceClient {
  scheduledCallDue(call: ScheduledCall, phase: DuePhase): Promise<void>;
}

/** Agent 2 · money (:4002) */
export interface MoneyClient {
  resolveHold(holdId: string, body: { decision: "release" | "cancel"; byMemberId: string; method: "verbal_on_verification_call" | "passkey_web"; passkeyAssertion?: unknown }): Promise<Hold>;
  listHolds(seniorId: string): Promise<Hold[]>;
  listOrders(seniorId: string): Promise<Order[]>;
}

export function httpVoiceClient(cfg: Config): VoiceClient {
  return {
    async scheduledCallDue(sc, phase) {
      // D4: the phase is in the body; the X-CC-Phase header stays for older readers.
      await call(cfg, cfg.voiceUrl, "POST", "/webhooks/scheduled-call-due", { ...sc, phase }, { "X-CC-Phase": phase });
    },
  };
}

export function httpMoneyClient(cfg: Config): MoneyClient {
  return {
    resolveHold: (holdId, body) => call(cfg, cfg.moneyUrl, "POST", `/holds/${encodeURIComponent(holdId)}/resolve`, body),
    listHolds: (seniorId) => call(cfg, cfg.moneyUrl, "GET", `/holds?seniorId=${encodeURIComponent(seniorId)}`),
    listOrders: (seniorId) => call(cfg, cfg.moneyUrl, "GET", `/orders?seniorId=${encodeURIComponent(seniorId)}`),
  };
}

// ---- Recording fakes for tests ----
export function recordingVoice(): VoiceClient & { events: { phase: DuePhase; call: ScheduledCall }[] } {
  const events: { phase: DuePhase; call: ScheduledCall }[] = [];
  return { events, async scheduledCallDue(c, phase) { events.push({ phase, call: structuredClone(c) }); } };
}

export function fakeMoney(init: { holds?: Hold[]; orders?: Order[] } = {}): MoneyClient & { holds: Hold[]; orders: Order[]; resolutions: any[] } {
  const holds = init.holds ?? [];
  const orders = init.orders ?? [];
  const resolutions: any[] = [];
  return {
    holds, orders, resolutions,
    async resolveHold(holdId, body) {
      resolutions.push({ holdId, ...body });
      const h = holds.find((x) => x.id === holdId);
      if (!h) throw new ServiceError(404, "NOT_FOUND", "hold not found");
      if (body.decision === "release" && body.method !== "passkey_web") throw new ServiceError(403, "PASSKEY_REQUIRED", "high-risk release needs passkey");
      h.status = body.decision === "cancel" ? "cancelled" : "released";
      h.resolution = { decision: body.decision, byMemberId: body.byMemberId, method: body.method, at: new Date().toISOString() };
      return structuredClone(h);
    },
    async listHolds(seniorId) { return holds.filter((h) => h.seniorId === seniorId); },
    async listOrders(seniorId) { return orders.filter((o) => o.seniorId === seniorId); },
  };
}
