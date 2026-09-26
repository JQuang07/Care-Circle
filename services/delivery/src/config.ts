import type { ProviderName } from "./types.js";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export interface Config {
  port: number; host: string;
  provider: ProviderName;
  liveCheckout: boolean;
  maxOrderCents: number; tolerancePct: number; quoteTtlMs: number;
  secret: string;
  moneyUrl: string; familyUrl: string;
  mcpUrl?: string; mcpToken?: string; mcpCommand?: string;
  dropoffAddress?: string; defaultGroceryStore: string;
  pollMs: number;
  feeBaseCents: number; feePct: number;
}

export function loadConfig(o: Partial<Config> = {}, env: NodeJS.ProcessEnv = process.env): Config {
  const provider: ProviderName = env.DELIVERY_PROVIDER === "doordash_thirdparty" ? "doordash_thirdparty" : "mock";
  const cfg: Config = {
    // Deliberately NOT env.PORT: a stray PORT in the root .env must never move this service.
    port: num(env.DELIVERY_PORT, 4004),
    host: env.DELIVERY_HOST ?? "0.0.0.0",
    provider,
    // Live checkout only ever applies to the real provider, and only when explicitly armed.
    liveCheckout: provider === "doordash_thirdparty" && env.DOORDASH_LIVE_CHECKOUT === "1",
    maxOrderCents: num(env.DOORDASH_MAX_ORDER_CENTS, 3000),
    tolerancePct: num(env.DOORDASH_PRICE_TOLERANCE_PCT, 10),
    quoteTtlMs: 15 * 60_000,
    secret: env.CC_INTERNAL_SECRET ?? "",
    moneyUrl: env.MONEY_URL ?? "http://localhost:4002",
    familyUrl: env.FAMILY_URL ?? "http://localhost:4003",
    mcpUrl: env.DOORDASH_MCP_URL || undefined,
    mcpToken: env.DOORDASH_MCP_TOKEN || undefined,
    mcpCommand: env.DOORDASH_MCP_COMMAND || undefined,
    dropoffAddress: env.DOORDASH_DROPOFF_ADDRESS || undefined,
    defaultGroceryStore: env.DOORDASH_GROCERY_STORE || "grocery",
    pollMs: num(env.DOORDASH_POLL_MS, 30_000),
    feeBaseCents: num(env.DOORDASH_FEE_BASE_CENTS, 799),
    feePct: num(env.DOORDASH_FEE_PCT, 15),
    ...o,
  };
  // Re-derive after overrides so a test can't accidentally arm live checkout on the mock.
  cfg.liveCheckout = cfg.provider === "doordash_thirdparty" && cfg.liveCheckout;
  return cfg;
}
