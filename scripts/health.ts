export {};
/**
 * pnpm health — the H8 checkpoint check. Hits GET /health on all four services and
 * validates the contract shape { ok: true, service, mock: boolean } (CONTRACTS.md §0).
 */
const targets = [
  { name: "voice", url: process.env.VOICE_URL ?? "http://localhost:4001", owner: "Agent 1" },
  { name: "money", url: process.env.MONEY_URL ?? "http://localhost:4002", owner: "Agent 2" },
  { name: "family", url: process.env.FAMILY_URL ?? "http://localhost:4003", owner: "Agent 3" },
  { name: "delivery", url: process.env.DELIVERY_URL ?? "http://localhost:4004", owner: "Agent 3" },
  { name: "web", url: process.env.WEB_URL ?? "http://localhost:3000", owner: "Agent 4" },
];

type Row = { service: string; owner: string; status: string; mock: string; detail: string };

// 15s timeout: the first hit on a cold `next dev` compiles the route.
async function check(t: (typeof targets)[number]): Promise<Row> {
  const base = { service: t.name, owner: t.owner, mock: "-" };
  try {
    const res = await fetch(`${t.url}/health`, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { ...base, status: "✗", detail: `HTTP ${res.status}` };
    const problems: string[] = [];
    if (body?.ok !== true) problems.push("ok !== true");
    if (body?.service !== t.name) problems.push(`service="${String(body?.service)}" (want "${t.name}")`);
    if (typeof body?.mock !== "boolean") problems.push("mock is not boolean");
    return {
      ...base,
      status: problems.length ? "✗" : "✓",
      mock: typeof body?.mock === "boolean" ? String(body.mock) : "-",
      detail: problems.join("; ") || "contract shape OK",
    };
  } catch (err) {
    return { ...base, status: "✗", detail: `unreachable at ${t.url} (${(err as Error).name})` };
  }
}

const rows = await Promise.all(targets.map(check));
console.table(rows);
const bad = rows.filter((r) => r.status !== "✓");
if (bad.length) {
  console.error(`✗ ${bad.length} of ${rows.length} unhealthy: ${bad.map((b) => b.service).join(", ")}`);
  process.exit(1);
}
console.log("✓ all four /health endpoints green");
