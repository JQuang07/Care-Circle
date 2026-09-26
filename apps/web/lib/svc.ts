"use client";
/** Browser-side calls to the services, via the /api/svc proxy. Never throws. */
import type { ZodType } from "zod";
import type { ServiceName } from "./services";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export async function svc<T>(
  service: ServiceName,
  path: string,
  opts: { method?: "GET" | "POST"; body?: unknown; schema?: ZodType<T>; signal?: AbortSignal } = {},
): Promise<Result<T>> {
  try {
    const res = await fetch(`/api/svc/${service}${path}`, {
      method: opts.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      signal: opts.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const e = json?.error;
      if (e && typeof e === "object") return { ok: false, status: res.status, code: String(e.code), message: String(e.message) };
      const [bare] = path.split("?");
      return {
        ok: false, status: res.status, code: `HTTP_${res.status}`,
        message: res.status === 404 ? `The ${service} service has no ${opts.method ?? "GET"} ${bare} yet.` : `The ${service} service answered ${res.status} for ${bare}.`,
      };
    }
    if (!opts.schema) return { ok: true, data: json as T };
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, status: 200, code: "CONTRACT_VIOLATION", message: `${service}${path}: ${issue?.path.join(".")} ${issue?.message}` };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, status: 0, code: "ABORTED", message: "aborted" };
    return { ok: false, status: 0, code: "NETWORK", message: String(e) };
  }
}

/** Human wording for a failed call, including the "this needs a contract change" case. */
export function explain(r: Extract<Result<unknown>, { ok: false }>, ccr?: string): string {
  if (r.status === 404 && ccr) return `Not available yet: waiting on ${ccr}.`;
  if (r.code === "UPSTREAM_UNREACHABLE") return r.message + " Start it with `pnpm dev`.";
  return `${r.code}: ${r.message}`;
}
