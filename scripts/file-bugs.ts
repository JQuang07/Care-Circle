/**
 * pnpm e2e:file [--write] — Part 1 task 7, integration duty. Files the failures from the
 * last `pnpm e2e` run under `## BUGS FROM INTEGRATION` in each owner's status file.
 * Dry run by default (prints what it would add); `--write` edits the files.
 * Each entry carries a marker, so re-running after another failing run doesn't duplicate it.
 * Only files under that heading are touched, which is all Agent 4 may write in others' files.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { FailureRecord, Owner } from "../e2e/src/report";

const RECORDS = "e2e/reports/records.jsonl";
const HEADING = "## BUGS FROM INTEGRATION";
const FILE: Partial<Record<Owner, string>> = {
  voice: "status/AGENT-1.md",
  money: "status/AGENT-2.md",
  family: "status/AGENT-3.md",
  delivery: "status/AGENT-3.md",
};
/** Lines that only say "nothing yet"; removed when the first real bug lands. */
const PLACEHOLDER = /^(None reported yet\..*|_\(none yet\)_|_\(Agent 4 writes here\.\)_)\s*$/;

const write = process.argv.includes("--write");
if (!existsSync(RECORDS)) {
  console.log("No failures recorded: the last `pnpm e2e` run passed (or hasn't run). Nothing to file.");
  process.exit(0);
}
const records = readFileSync(RECORDS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as FailureRecord);
const rev = execSync("git rev-parse --abbrev-ref HEAD").toString().trim() + "@" + execSync("git rev-parse --short HEAD").toString().trim();
const today = new Date().toISOString().slice(0, 10);

const clip = (x: unknown, n: number) => {
  const s = typeof x === "string" ? x : JSON.stringify(x);
  return s === undefined ? "(empty)" : s.length > n ? s.slice(0, n) + "…" : s;
};
const key = (r: FailureRecord) => `<!-- e2e:${`${r.scenario} | ${r.expected}`.replace(/-{2,}/g, "-")} -->`;

function entry(r: FailureRecord): string {
  const ex = r.exchanges.at(-1);
  const call = ex
    ? `\n  - Last call: \`${ex.method} ${ex.service}${ex.path}\` → ${ex.status ?? ex.error}` +
      (ex.reqBody !== undefined ? `\n    - Request: \`${clip(ex.reqBody, 300)}\`` : "") +
      `\n    - Response: \`${clip(ex.resBody, 500)}\``
    : "";
  return `- [ ] **${r.scenario}** (${today}, E2E on \`${rev}\`, filed by Agent 4) ${key(r)}\n` +
    `  - Expected: ${r.expected}\n  - Actual: ${clip(r.actual, 600)}${call}\n`;
}

const byFile = new Map<string, FailureRecord[]>();
const unrouted: FailureRecord[] = [];
for (const r of records) {
  const f = FILE[r.owner];
  if (f) byFile.set(f, [...(byFile.get(f) ?? []), r]);
  else unrouted.push(r);
}

for (const [file, rs] of byFile) {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(HEADING);
  if (start < 0) { console.error(`✗ ${file} has no "${HEADING}" section; add the heading, then re-run.`); continue; }
  const bodyStart = start + HEADING.length;
  const next = text.indexOf("\n## ", bodyStart);
  const bodyEnd = next < 0 ? text.length : next;
  const body = text.slice(bodyStart, bodyEnd);
  const fresh = rs.filter((r) => !text.includes(key(r)));
  const skipped = rs.length - fresh.length;
  console.log(`\n${file}: ${fresh.length} new${skipped ? `, ${skipped} already filed` : ""}`);
  if (!fresh.length) continue;
  const added = fresh.map(entry).join("");
  console.log(added);
  if (!write) continue;
  const kept = body.split("\n").filter((l) => !PLACEHOLDER.test(l)).join("\n").trimEnd();
  writeFileSync(file, text.slice(0, bodyStart) + (kept ? kept + "\n" : "\n") + added + "\n" + text.slice(bodyEnd).replace(/^\n+/, ""));
}

if (unrouted.length) {
  console.log(`\nNot filed automatically (${unrouted.length}): owner is web (fix it yourself) or contract (raise with the coordinator):`);
  for (const r of unrouted) console.log(`  - [${r.owner}] ${r.scenario}: ${r.expected}`);
}
console.log(write ? "\n✓ written. Review with `git diff status/`, then commit." : "\nDry run. Re-run with --write to edit the status files.");
