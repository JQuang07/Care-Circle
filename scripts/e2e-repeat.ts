/**
 * pnpm e2e:10 — the H62 freeze gate: all five scenarios must pass N runs in a row.
 * Stops at the first failing run so the report in e2e/reports/latest.md is from it.
 */
import { spawnSync } from "node:child_process";

const n = Number(process.argv[2] ?? 10);
const started = Date.now();
for (let i = 1; i <= n; i++) {
  console.log(`\n━━━ e2e run ${i}/${n} ━━━`);
  const res = spawnSync("pnpm", ["--filter", "@care-circle/e2e", "test"], { stdio: "inherit", env: process.env });
  if (res.status !== 0) {
    console.error(`\n✗ run ${i}/${n} failed after ${i - 1} consecutive passes. See e2e/reports/latest.md`);
    process.exit(1);
  }
}
console.log(`\n✓ ${n}/${n} consecutive passes in ${Math.round((Date.now() - started) / 1000)}s`);
