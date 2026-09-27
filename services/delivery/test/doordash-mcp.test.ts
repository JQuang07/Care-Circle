import { describe, expect, it } from "vitest";
import { DoorDashMcpProvider, REQUIRED_TOOLS, type ToolCaller } from "../src/providers/doordash-mcp";

/** A fake of the davidgibbons/striderlabs DoorDash MCP server's tool results. */
function fakeServer(o: { loggedIn?: boolean; tools?: string[]; startCart?: any[] } = {}) {
  const calls: { name: string; args: any }[] = [];
  let cart: any[] = o.startCart ?? [];
  const tools = o.tools ?? [...REQUIRED_TOOLS, "doordash_set_address"];
  const caller: ToolCaller = {
    async listTools() { return tools; },
    async call(name, args) {
      calls.push({ name, args });
      switch (name) {
        case "doordash_auth_check": return { success: true, isLoggedIn: o.loggedIn ?? true };
        case "doordash_set_address": return { success: true };
        case "doordash_search": return { success: true, restaurants: [{ id: "store_42", name: "Safeway" }] };
        case "doordash_menu": return { success: true, categories: [{ name: "Dairy", items: [{ id: "1", name: "Whole Milk 1 gal", price: 4.29 }, { id: "2", name: "Bananas", price: 1.89 }] }] };
        case "doordash_add_to_cart": cart.push({ name: args.itemName, quantity: args.quantity, price: 0 }); return { success: true };
        case "doordash_cart": return { success: true, items: cart, subtotal: 6.18, total: 9.99 };
        case "doordash_checkout": return args.confirm ? { success: true, orderId: "dd_987", summary: { total: 9.99 } } : { success: true, requiresConfirmation: true, summary: { total: 9.99, estimatedDelivery: "30-40 min" } };
        case "doordash_track_order": return { success: true, status: { status: "Dasher is heading to you" } };
        default: return { success: false, error: "unknown tool" };
      }
    },
  };
  return { caller, calls };
}

describe("DoorDash MCP provider (tool mapping)", () => {
  it("search → menu → cart → preview, and never checks out on its own", async () => {
    const { caller, calls } = fakeServer();
    const p = new DoorDashMcpProvider(caller, { dropoffAddress: "1 Demo St, Atlanta, GA", defaultGroceryStore: "grocery" });
    const store = await p.findStore("grocery");
    expect(store).toEqual({ id: "store_42", name: "Safeway" });
    const cat = await p.catalog(store);
    expect(cat).toContainEqual({ name: "Bananas", priceCents: 189 });
    const cart = await p.buildCart(store, [{ name: "Whole Milk 1 gal", qty: 1 }, { name: "Bananas", qty: 1 }]);
    expect(cart.totalCents).toBe(999);
    const pv = await p.preview();
    expect(pv).toEqual({ totalCents: 999, etaText: "30-40 min" });
    expect(calls.filter((c) => c.name === "doordash_checkout").every((c) => c.args.confirm === false)).toBe(true);
    expect(calls.filter((c) => c.name === "doordash_set_address")).toHaveLength(1);
  });

  it("refuses a cart that already has someone else's items", async () => {
    const { caller } = fakeServer({ startCart: [{ name: "Pizza", quantity: 1 }] });
    const p = new DoorDashMcpProvider(caller, { defaultGroceryStore: "grocery" });
    await expect(p.buildCart({ id: "store_42", name: "Safeway" }, [{ name: "Bananas", qty: 1 }])).rejects.toThrow(/already has items/);
  });

  it("fails loudly when not logged in or when tools are missing", async () => {
    const a = new DoorDashMcpProvider(fakeServer({ loggedIn: false }).caller, { defaultGroceryStore: "grocery" });
    await expect(a.findStore("grocery")).rejects.toThrow(/not logged in/);
    const b = new DoorDashMcpProvider(fakeServer({ tools: ["doordash_search"] }).caller, { defaultGroceryStore: "grocery" });
    await expect(b.findStore("grocery")).rejects.toThrow(/missing tools/);
  });

  it("maps tracking text to statuses", async () => {
    const p = new DoorDashMcpProvider(fakeServer().caller, { defaultGroceryStore: "grocery" });
    expect((await p.track("dd_987")).status).toBe("picked_up");
  });

  it("health polls never queue browser work behind (or ahead of) an order", async () => {
    const { caller, calls } = fakeServer();
    let release!: () => void;
    const slow: ToolCaller = {
      listTools: caller.listTools,
      async call(name, args) {
        if (name === "doordash_search") await new Promise<void>((r) => { release = r; });
        return caller.call(name, args);
      },
    };
    const p = new DoorDashMcpProvider(slow, { defaultGroceryStore: "grocery" });
    const first = await p.status();
    expect(first).toMatchObject({ connected: true, loggedIn: true });
    const store = p.findStore("grocery");
    await new Promise((r) => setTimeout(r, 0));
    const authBefore = calls.filter((c) => c.name === "doordash_auth_check").length;
    const polls = await Promise.all(Array.from({ length: 20 }, () => p.status()));
    expect(polls.every((s) => s.connected && s.loggedIn)).toBe(true);
    expect(calls.filter((c) => c.name === "doordash_auth_check").length).toBe(authBefore);
    release();
    expect(await store).toEqual({ id: "store_42", name: "Safeway" });
  });
});
