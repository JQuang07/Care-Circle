import { buildApp } from "./app.js";
import { buildProvider } from "./build.js";
import { loadConfig } from "./config.js";
import { DeliveryService, httpEmitter, httpMoneyClient } from "./service.js";

const cfg = loadConfig();
const log = (m: string) => console.log(`[delivery] ${m}`);
if (cfg.secret.length < 24) console.warn("[delivery] CC_INTERNAL_SECRET is missing or shorter than 24 chars; every call except /health will be rejected");

const provider = await buildProvider(cfg).catch((e) => {
  console.error(`[delivery] could not connect to the DoorDash MCP server: ${e.message}\n` +
    "  Start it first (see services/delivery/README.md), or set DELIVERY_PROVIDER=mock.");
  process.exit(1);
});
const svc = new DeliveryService(cfg, provider, httpMoneyClient(cfg.moneyUrl, cfg.secret),
  httpEmitter([cfg.moneyUrl, cfg.familyUrl], cfg.secret, log), log);
const app = buildApp(svc, cfg, { logger: true });
await app.listen({ port: cfg.port, host: cfg.host });
log(`up on :${cfg.port} provider=${cfg.provider} liveCheckout=${cfg.liveCheckout} cap=$${(cfg.maxOrderCents / 100).toFixed(2)}`);
if (cfg.liveCheckout) console.warn("[delivery] ⚠ LIVE CHECKOUT IS ARMED: a human-confirmed order will spend real money on DoorDash");

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => { svc.stop(); await app.close(); process.exit(0); });
