import type { Config } from "./config.js";
import { DoorDashMcpProvider, connectMcp } from "./providers/doordash-mcp.js";
import { MockProvider } from "./providers/mock.js";
import type { Provider } from "./providers/provider.js";

export async function buildProvider(cfg: Config): Promise<Provider> {
  if (cfg.provider === "mock") return new MockProvider();
  const tools = await connectMcp({ url: cfg.mcpUrl, token: cfg.mcpToken, command: cfg.mcpCommand });
  return new DoorDashMcpProvider(tools, { dropoffAddress: cfg.dropoffAddress, defaultGroceryStore: cfg.defaultGroceryStore, feeBaseCents: cfg.feeBaseCents, feePct: cfg.feePct });
}
