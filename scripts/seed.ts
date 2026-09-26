/**
 * pnpm seed — orchestrates each service's own seed script, in contract order:
 *   family → money → voice
 * Each service seeds ONLY its own schema (CONTRACTS.md §1–2). This script never
 * touches service tables; it only makes sure the four schemas exist first.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORDER = [
  { pkg: "@care-circle/family", owner: "Agent 3" },
  { pkg: "@care-circle/money", owner: "Agent 2" },
  { pkg: "@care-circle/voice", owner: "Agent 1" },
] as const;

async function ensureSchemas() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
  const sql = readFileSync(join(root, "scripts/init-schemas.sql"), "utf8");
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query(sql);
      await client.end();
      console.log("✓ schemas voice, money, family, web exist");
      return;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(
    `Postgres not reachable at DATABASE_URL after 30s. Start it with \`docker compose up -d\`.\n  ${String(lastErr)}`,
  );
}

async function main() {
  await ensureSchemas();
  for (const { pkg, owner } of ORDER) {
    console.log(`\n▶ seeding ${pkg} (${owner})`);
    const res = spawnSync("pnpm", ["--filter", pkg, "run", "seed"], { stdio: "inherit", cwd: root, env: process.env });
    if (res.status !== 0) {
      console.error(`\n✗ ${pkg} seed failed (exit ${res.status}). Owner: ${owner}. Later seeds were skipped.`);
      process.exit(res.status ?? 1);
    }
  }
  console.log("\n✓ seed complete: family → money → voice");
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
