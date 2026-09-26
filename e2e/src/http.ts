/**
 * Typed HTTP client for the E2E suite. Every exchange is logged so a failing scenario
 * can quote the exact request/response in the owning agent's status file.
 * Responses are validated against the contract schemas: a shape violation is a bug
 * even when the value "looks right".
 */
import type { ZodType } from "zod";

export type Service = "voice" | "money" | "family" | "delivery";

export const BASE: Record<Service, string> = {
  voice: process.env.VOICE_URL ?? "http://localhost:4001",
  money: process.env.MONEY_URL ?? "http://localhost:4002",
  family: process.env.FAMILY_URL ?? "http://localhost:4003",
  delivery: process.env.DELIVERY_URL ?? "http://localhost:4004",
};

export interface Exchange {
  at: string;
  service: Service;
  method: string;
  path: string;
  reqBody?: unknown;
  status?: number;
  resBody?: unknown;
  error?: string;
}

export const exchanges: Exchange[] = [];

export class HttpError extends Error {
  constructor(message: string, readonly exchange: Exchange) {
    super(message);
    this.name = "HttpError";
  }
}

export class ContractViolation extends Error {
  constructor(message: string, readonly exchange: Exchange) {
    super(message);
    this.name = "ContractViolation";
  }
}

export async function call<T = unknown>(
  service: Service,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
): Promise<T> {
  const ex: Exchange = { at: new Date().toISOString(), service, method, path, reqBody: body };
  exchanges.push(ex);
  let res: Response;
  try {
    res = await fetch(`${BASE[service]}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-cc-secret": process.env.CC_INTERNAL_SECRET ?? "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    ex.error = String(err);
    throw new HttpError(`${service} ${method} ${path} → network error: ${ex.error}`, ex);
  }
  ex.status = res.status;
  const text = await res.text();
  try {
    ex.resBody = text ? JSON.parse(text) : undefined;
  } catch {
    ex.resBody = text;
  }
  if (!res.ok) {
    const e = (ex.resBody as { error?: { code?: string; message?: string } })?.error;
    throw new HttpError(
      `${service} ${method} ${path} → HTTP ${res.status}${e ? ` ${e.code}: ${e.message}` : ""}`,
      ex,
    );
  }
  if (!schema) return ex.resBody as T;
  const parsed = schema.safeParse(ex.resBody);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ContractViolation(`${service} ${method} ${path} response violates the contract (CONTRACTS.md §3 + addendum): ${issues}`, ex);
  }
  return parsed.data;
}
