import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo-root .env (services/family/src -> ../../../.env). Local process env wins.
loadEnv({ path: path.resolve(here, "../../../.env") });

const env = process.env;

export interface Config {
  port: number;
  host: string;
  mock: boolean;
  databaseUrl?: string;
  internalSecret: string;
  /** Require X-CC-Secret on every route (not just webhooks + /circle). */
  requireSecretEverywhere: boolean;
  metaApiKey?: string;
  museBaseUrl: string;
  museModel: string;
  /** "on" | "off": off forces the deterministic fallbacks (tests, offline). */
  museEnabled: boolean;
  livekitUrl?: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
  voiceUrl: string;
  moneyUrl: string;
  deliveryUrl: string;
  webUrl: string;
  familyUrl: string;
  /** Scheduler tick interval (ms). 0 disables the background loop. */
  tickMs: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = {
    port: Number(env.FAMILY_PORT ?? env.PORT ?? 4003),
    host: env.FAMILY_HOST ?? "0.0.0.0",
    mock: env.MOCK === "1" || env.MOCK === "true",
    databaseUrl: env.DATABASE_URL || undefined,
    internalSecret: env.CC_INTERNAL_SECRET ?? "dev-secret",
    requireSecretEverywhere: env.FAMILY_REQUIRE_SECRET_ALL === "1",
    metaApiKey: env.META_API_KEY || undefined,
    museBaseUrl: env.MUSE_BASE_URL ?? "https://api.meta.ai/v1",
    museModel: env.MUSE_MODEL ?? "muse-spark-1.1",
    museEnabled: (env.FAMILY_MUSE ?? "on") !== "off" && !!env.META_API_KEY,
    livekitUrl: env.LIVEKIT_URL || undefined,
    livekitApiKey: env.LIVEKIT_API_KEY || undefined,
    livekitApiSecret: env.LIVEKIT_API_SECRET || undefined,
    voiceUrl: env.VOICE_URL ?? "http://localhost:4001",
    moneyUrl: env.MONEY_URL ?? "http://localhost:4002",
    deliveryUrl: env.DELIVERY_URL ?? "http://localhost:4004",
    webUrl: env.WEB_URL ?? "http://localhost:3000",
    familyUrl: env.FAMILY_URL ?? "http://localhost:4003",
    tickMs: Number(env.FAMILY_TICK_MS ?? 15000),
  };
  return { ...base, ...overrides };
}
