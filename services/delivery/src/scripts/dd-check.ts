/**
 * `pnpm --filter @care-circle/delivery dd:check [--quote "milk,bananas,bread"] [--store "Safeway"]`
 * Connects to the DoorDash MCP server from .env, verifies the tools and the login, and optionally
 * prices a few items. It NEVER adds to cart and NEVER checks out.
 */
import { loadConfig } from "../config.js";
import { DoorDashMcpProvider, REQUIRED_TOOLS, connectMcp } from "../providers/doordash-mcp.js";
import { classify } from "../match.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const cfg = loadConfig({ provider: "doordash_thirdparty" });
console.log(`MCP: ${cfg.mcpUrl ?? cfg.mcpCommand ?? "(not configured)"}`);
const tools = await connectMcp({ url: cfg.mcpUrl, token: cfg.mcpToken, command: cfg.mcpCommand });
const names = await tools.listTools();
console.log(`tools (${names.length}): ${names.join(", ")}`);
const missing = REQUIRED_TOOLS.filter((t) => !names.includes(t));
console.log(missing.length ? `✗ missing required tools: ${missing.join(", ")}` : "✓ all required tools present");
const p = new DoorDashMcpProvider(tools, { dropoffAddress: cfg.dropoffAddress, defaultGroceryStore: cfg.defaultGroceryStore });
const st = await p.status();
console.log(st.loggedIn ? "✓ logged in to DoorDash" : `✗ not logged in (${st.detail}). Run \`npm run login\` in the MCP server folder.`);
const q = arg("--quote");
if (q && st.loggedIn && !missing.length) {
  const store = await p.findStore("grocery", arg("--store"));
  console.log(`store: ${store.name} (${store.id})`);
  const cat = await p.catalog(store);
  console.log(`catalog items read: ${cat.length}`);
  for (const item of q.split(",").map((s) => s.trim()).filter(Boolean)) {
    const c = classify(item, cat);
    console.log(`  ${item} → ${c.status === "matched" ? `${c.item.name} $${(c.item.priceCents / 100).toFixed(2)}` : c.status}`);
  }
}
await tools.close?.();
process.exit(missing.length || !st.loggedIn ? 1 : 0);
