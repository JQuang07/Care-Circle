/**
 * `pnpm dd:check [--quote "milk,bananas,bread"] [--store "Kroger"] [--dry-run] [--clear-cart]`
 * Connects to the DoorDash MCP server from .env, verifies the tools and the login, and optionally
 * prices a few items. `--dry-run` also fills the real cart with the matches and runs the checkout
 * preview, which stops after pressing Checkout. `--clear-cart` empties the cart. It NEVER places an order.
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
  const cat = await p.catalog(store, q.split(",").map((s) => s.trim()).filter(Boolean));
  console.log(`catalog items read: ${cat.length}`);
  const matched: { name: string; qty: number }[] = [];
  for (const item of q.split(",").map((s) => s.trim()).filter(Boolean)) {
    const c = classify(item, cat);
    console.log(`  ${item} → ${c.status === "matched" ? `${c.item.name} $${(c.item.priceCents / 100).toFixed(2)}` : c.status}`);
    if (c.status === "matched") matched.push({ name: c.item.name, qty: 1 });
  }
  if (process.argv.includes("--dry-run") && matched.length) {
    const cart = await p.buildCart(store, matched);
    console.log(`✓ cart built: ${cart.itemNames.join(", ")} · subtotal $${(cart.subtotalCents / 100).toFixed(2)}`);
    const preview = await p.preview(); // presses Checkout and stops; never places the order
    console.log(`✓ checkout preview reached (DRY RUN, nothing ordered)${preview.totalCents ? ` · total $${(preview.totalCents / 100).toFixed(2)}` : ""}. Empty the cart with --clear-cart.`);
  }
}
if (process.argv.includes("--clear-cart") && st.loggedIn) {
  const r: any = await tools.call("doordash_clear_cart", {});
  console.log(r?.success ? `✓ cart emptied (${r.removed} removed)` : `✗ cart not empty: ${r?.error ?? `${r?.remaining} left (removed ${r?.removed}, page ${r?.page})`}`);
}
await tools.close?.();
process.exit(missing.length || !st.loggedIn ? 1 : 0);
