import type { Deps } from "../deps.js";

/** Idempotency guard for webhook side effects. Returns true the first time `key` is seen. */
export async function once(deps: Deps, key: string): Promise<boolean> {
  if (await deps.store.processed.get(key)) return false;
  await deps.store.processed.put({ id: key, at: deps.clock.now().toISOString() });
  return true;
}
