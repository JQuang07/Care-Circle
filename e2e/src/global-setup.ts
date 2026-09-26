/**
 * Before: fail fast if a service is down (one clear line, not five timeouts).
 * After: turn failure records into e2e/reports/latest.md, grouped by owning agent,
 * ready to paste under `## BUGS FROM INTEGRATION`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE } from "./http";
import { REPORT_DIR, RECORDS_FILE, type FailureRecord, type Owner } from "./report";

const STATUS_FILE: Record<Owner, string> = {
  voice: "status/AGENT-1.md",
  money: "status/AGENT-2.md",
  family: "status/AGENT-3.md",
  web: "status/AGENT-4.md",
  contract: "the human coordinator (CONTRACT CHANGE REQUEST)",
};

export async function setup() {
  mkdirSync(REPORT_DIR, { recursive: true });
  rmSync(RECORDS_FILE, { force: true });
  const down: string[] = [];
  for (const [svc, url] of Object.entries(BASE)) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      const b = (await r.json()) as { ok?: boolean };
      if (!r.ok || b.ok !== true) down.push(`${svc} (${url}) unhealthy`);
    } catch {
      down.push(`${svc} (${url}) unreachable`);
    }
  }
  if (down.length) throw new Error(`E2E needs all services up. Run \`pnpm dev\` first.\n  ${down.join("\n  ")}`);
}

const fence = (x: unknown) => "```json\n" + (JSON.stringify(x, null, 2) ?? "(empty)").slice(0, 2500) + "\n```";

export async function teardown() {
  const out = join(REPORT_DIR, "latest.md");
  const when = new Date().toISOString();
  if (!existsSync(RECORDS_FILE)) {
    writeFileSync(out, `# E2E report · ${when}\n\nAll scenarios passed.\n`);
    return;
  }
  const records = readFileSync(RECORDS_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l) as FailureRecord);
  const byOwner = new Map<Owner, FailureRecord[]>();
  for (const r of records) byOwner.set(r.owner, [...(byOwner.get(r.owner) ?? []), r]);
  let md = `# E2E report · ${when}\n\n${records.length} failing scenario(s). Paste each block under \`## BUGS FROM INTEGRATION\` in the file named.\n`;
  for (const [owner, rs] of byOwner) {
    md += `\n## → ${STATUS_FILE[owner]}\n`;
    for (const r of rs) {
      md += `\n### ${r.scenario} · ${when.slice(0, 16)}Z\n- **Expected:** ${r.expected}\n- **Actual:** ${r.actual}\n`;
      for (const ex of r.exchanges) {
        md += `\n\`${ex.method} ${ex.service}${ex.path}\` → ${ex.status ?? ex.error}\n`;
        if (ex.reqBody !== undefined) md += `Request:\n${fence(ex.reqBody)}\n`;
        md += `Response:\n${fence(ex.resBody)}\n`;
      }
    }
  }
  writeFileSync(out, md);
  console.log(`\nE2E failures written to ${out}`);
}
