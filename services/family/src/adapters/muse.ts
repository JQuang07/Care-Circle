import OpenAI from "openai";
import type { Config } from "../config.js";

export interface MuseJsonRequest {
  name: string;
  /** JSON schema (strict structured output). */
  schema: Record<string, unknown>;
  system: string;
  user: string;
  /** Give up and let the caller fall back after this long (default 20s). */
  timeoutMs?: number;
  /** Lower = faster. Use "low" when someone is waiting on the answer. */
  effort?: "minimal" | "low" | "medium" | "high";
}

/** Muse Spark via the openai SDK. `json` returns null when disabled or on any failure, so callers fall back. */
export interface Muse {
  enabled: boolean;
  json<T>(req: MuseJsonRequest): Promise<T | null>;
}

export function createMuse(cfg: Config, log?: { warn: (o: any, m?: string) => void }): Muse {
  if (!cfg.museEnabled || !cfg.metaApiKey) return disabledMuse();
  const client = new OpenAI({ apiKey: cfg.metaApiKey, baseURL: cfg.museBaseUrl, maxRetries: 0 });
  return {
    enabled: true,
    async json<T>(req: MuseJsonRequest): Promise<T | null> {
      try {
        const res = await client.chat.completions.create({
          model: cfg.museModel,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: req.name, strict: true, schema: req.schema },
          },
          ...(req.effort ? { reasoning_effort: req.effort as "low" } : {}),
        }, { timeout: req.timeoutMs ?? 20_000 });
        const content = res.choices[0]?.message?.content;
        return content ? (JSON.parse(content) as T) : null;
      } catch (err) {
        log?.warn({ err: String(err), task: req.name }, "muse call failed; using fallback");
        return null;
      }
    },
  };
}

export function disabledMuse(): Muse {
  return { enabled: false, json: async () => null };
}

/** Test double: returns whatever the handler returns for a given task name. */
export function scriptedMuse(handler: (req: MuseJsonRequest) => unknown): Muse & { calls: MuseJsonRequest[] } {
  const calls: MuseJsonRequest[] = [];
  return {
    enabled: true,
    calls,
    async json<T>(req: MuseJsonRequest) {
      calls.push(req);
      const out = handler(req);
      return (out ?? null) as T | null;
    },
  };
}
