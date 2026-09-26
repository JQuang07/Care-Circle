/**
 * Scenario harness. Each step names the service that OWNS the expectation, so a failure
 * is routed to the right agent's `## BUGS FROM INTEGRATION` without guesswork.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { test } from "vitest";
import { ContractViolation, exchanges, HttpError } from "./http";
import { REPORT_DIR, RECORDS_FILE, type FailureRecord, type Owner } from "./report";

export type { Owner } from "./report";

/** A step that needs an endpoint the contract doesn't define yet. 404 → routed to the human. */
export class ContractGap extends Error {
  constructor(readonly ccr: string, message: string) {
    super(`${ccr} not approved/implemented yet: ${message}`);
    this.name = "ContractGap";
  }
}

export interface Ctx {
  step<T>(owner: Owner, expectation: string, fn: () => Promise<T>): Promise<T>;
  /** Wrap a call to a CCR-proposed endpoint: a 404 becomes a ContractGap, not a service bug. */
  proposed<T>(ccr: string, fn: () => Promise<T>): Promise<T>;
  warn(message: string): void;
}

const SETUP = "the service answers the pre-test snapshot (list what already exists)";

export function scenario(name: string, fn: (ctx: Ctx) => Promise<void>, timeoutMs = 240_000) {
  test(name, async () => {
    let current = { owner: "contract" as Owner, expectation: SETUP, from: exchanges.length };
    const ctx: Ctx = {
      async step(owner, expectation, run) {
        current = { owner, expectation, from: exchanges.length };
        return run();
      },
      async proposed(ccr, run) {
        try {
          return await run();
        } catch (err) {
          if (err instanceof HttpError && err.exchange.status === 404) {
            current = { ...current, owner: "contract" };
            throw new ContractGap(ccr, `${err.exchange.method} ${err.exchange.service} ${err.exchange.path} → 404`);
          }
          throw err;
        }
      },
      warn(message) {
        console.warn(`⚠ [${name}] ${message}`);
      },
    };
    try {
      await fn(ctx);
    } catch (err) {
      const record: FailureRecord = {
        scenario: name,
        owner: err instanceof ContractGap
          ? "contract"
          // Failed before any step (the "what exists already" snapshot): blame the service that answered.
          : current.expectation === SETUP && (err instanceof HttpError || err instanceof ContractViolation)
            ? err.exchange.service
            : current.owner,
        expected: current.expectation,
        actual: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        exchanges: exchanges.slice(Math.max(current.from - 1, 0)).slice(-8),
      };
      mkdirSync(REPORT_DIR, { recursive: true });
      appendFileSync(RECORDS_FILE, JSON.stringify(record) + "\n");
      throw err;
    }
  }, timeoutMs);
}

export interface WaitOpts {
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Poll until `probe` returns a value. `probe` may call `observe(x)` to record what it
 * last saw (quoted in the timeout error), or throw `FailFast` to stop early when the
 * system has clearly gone the wrong way (e.g. a grocery order got held).
 */
export async function waitFor<T>(
  what: string,
  probe: (observe: (x: unknown) => void) => Promise<T | undefined>,
  { timeoutMs = 60_000, intervalMs = 1_000 }: WaitOpts = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = "(nothing observed)";
  const observe = (x: unknown) => {
    last = x;
  };
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe(observe);
      if (v !== undefined) return v;
    } catch (err) {
      if (err instanceof FailFast || err instanceof ContractViolation) throw err;
      // 4xx is a wrong request or a missing endpoint, never transient. Surface it now.
      if (err instanceof HttpError && err.exchange.status && err.exchange.status < 500) throw err;
      lastErr = err; // 5xx or network: service may be restarting; keep polling
    }
    await sleep(intervalMs);
  }
  const lastText = JSON.stringify(last, null, 0)?.slice(0, 600);
  throw new Error(
    `timed out after ${timeoutMs / 1000}s waiting for: ${what}. Last observed: ${lastText}` +
      (lastErr ? `. Last error: ${String(lastErr)}` : ""),
  );
}

export class FailFast extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FailFast";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
