// Re-seeds the family schema: circle (CONTRACTS §2) + 8 weeks of call history.
// Usage: npm run seed   (safe to run repeatedly; wipes only family.* data)
import { loadConfig } from "../config.js";
import { createDeps } from "../bootstrap.js";
import { seedAll } from "../domain/circle.js";

const deps = await createDeps(loadConfig(), { info: console.log, warn: console.warn, error: console.error });
const res = await seedAll(deps);
console.log(`family seed done (${deps.store.kind}): circle sen_rose + ${res.calls} historical calls`);
await deps.store.close();
