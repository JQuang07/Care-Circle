/**
 * Third-party DoorDash MCP provider (UNOFFICIAL). Talks to a locally running MCP server
 * (tested tool names: davidgibbons/mcp-doordash, a fork of @striderlabs/mcp-doordash):
 *   doordash_auth_check, doordash_set_address, doordash_search, doordash_menu,
 *   doordash_add_to_cart, doordash_cart, doordash_checkout{confirm}, doordash_track_order
 *
 * Safety: this file never decides to spend money. `checkout()` is only reachable through
 * the service's live-checkout gate (DOORDASH_LIVE_CHECKOUT=1 + secret + human confirm).
 */
import type { Kind } from "../types.js";
import type { Priced } from "../match.js";
import { score, tokens } from "../match.js";
import { ProviderError, type CartResult, type Provider, type Store, type TrackStatus } from "./provider.js";

export const REQUIRED_TOOLS = [
  "doordash_auth_check", "doordash_search", "doordash_menu", "doordash_add_to_cart",
  "doordash_cart", "doordash_checkout", "doordash_track_order",
] as const;

/** Minimal surface over an MCP client, so tests can fake it. */
export interface ToolCaller {
  listTools(): Promise<string[]>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<void>;
}

const cents = (dollars: unknown) => (typeof dollars === "number" && Number.isFinite(dollars) ? Math.round(dollars * 100) : 0);

export class DoorDashMcpProvider implements Provider {
  readonly name = "doordash_thirdparty" as const;
  private queue: Promise<unknown> = Promise.resolve();
  private checkedTools = false;
  private addressSet = false;

  constructor(private tools: ToolCaller, private opts: { dropoffAddress?: string; defaultGroceryStore: string; feeBaseCents?: number; feePct?: number }) {}

  /** DoorDash only shows fees/tax in the cart, so quote a conservative estimate; the price gate catches surprises. */
  estimateFeesCents(subtotalCents: number) {
    return (this.opts.feeBaseCents ?? 799) + Math.round(subtotalCents * (this.opts.feePct ?? 15) / 100);
  }

  /** Every call runs one at a time: the server drives a single browser tab. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++;
    const next = this.queue.then(fn, fn).finally(() => { this.pending--; });
    this.queue = next.catch(() => undefined);
    return next;
  }
  private pending = 0;
  private lastStatus?: { connected: boolean; loggedIn?: boolean; detail?: string; at: number };
  private probing?: Promise<{ connected: boolean; loggedIn?: boolean; detail?: string }>;
  static readonly STATUS_TTL_MS = 60_000;
  static readonly AUTH_REUSE_MS = 5 * 60_000;
  static readonly STORE_TTL_MS = 30 * 60_000;
  private stores = new Map<string, Store & { at: number }>();

  private async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res: any = await this.tools.call(name, args);
    if (res && typeof res === "object" && res.success === false) {
      throw new ProviderError("DOORDASH_ERROR", `${name}: ${res.error ?? "failed"}`);
    }
    return res;
  }

  private async ready() {
    if (!this.checkedTools) {
      const have = new Set(await this.tools.listTools());
      const missing = REQUIRED_TOOLS.filter((t) => !have.has(t));
      if (missing.length) {
        throw new ProviderError("MCP_TOOLS_MISSING", `DoorDash MCP server is missing tools: ${missing.join(", ")}. Wrong server? See services/delivery/docs/DOORDASH-SPIKE.md`);
      }
      this.checkedTools = true;
    }
    // Each auth check is ~10-20 s of browser time; a recent "logged in" is good enough.
    const recent = this.lastStatus?.loggedIn && Date.now() - this.lastStatus.at < DoorDashMcpProvider.AUTH_REUSE_MS;
    if (recent) return this.setAddressOnce();
    const auth = await this.call("doordash_auth_check");
    this.lastStatus = { connected: true, loggedIn: Boolean(auth?.isLoggedIn), detail: auth?.isLoggedIn ? "logged in" : "not logged in", at: Date.now() };
    if (!auth?.isLoggedIn) {
      throw new ProviderError("DOORDASH_NOT_LOGGED_IN", "DoorDash session is not logged in. Run `npm run login` in the MCP server folder, then restart it.");
    }
    await this.setAddressOnce();
  }

  private async setAddressOnce() {
    if (this.opts.dropoffAddress && !this.addressSet) {
      await this.call("doordash_set_address", { address: this.opts.dropoffAddress });
      this.addressSet = true;
    }
  }

  /**
   * /health is polled every few seconds by web. A probe costs ~20 s of browser time, so it must
   * never queue behind (or ahead of) a real order: answer from the last result, probe at most
   * once at a time, and only when the browser is idle.
   */
  status(): Promise<{ connected: boolean; loggedIn?: boolean; detail?: string }> {
    const last = this.lastStatus;
    const view = (s: NonNullable<typeof last>, extra = "") => ({ connected: s.connected, loggedIn: s.loggedIn, detail: (s.detail ?? "") + extra });
    if (this.pending > 0 && !this.probing) {
      return Promise.resolve(last ? view(last, " (busy with a DoorDash order)") : { connected: true, detail: "busy with a DoorDash order" });
    }
    if (last && Date.now() - last.at < DoorDashMcpProvider.STATUS_TTL_MS) return Promise.resolve(view(last));
    if (!this.probing) {
      this.probing = this.probe()
        .then((s) => { this.lastStatus = { ...s, at: Date.now() }; return s; })
        .finally(() => { this.probing = undefined; });
    }
    return last ? Promise.resolve(view(last)) : this.probing;
  }

  private probe() {
    return this.run(async () => {
      try {
        const names = await this.tools.listTools();
        const missing = REQUIRED_TOOLS.filter((t) => !names.includes(t));
        if (missing.length) return { connected: true, loggedIn: false, detail: `missing tools: ${missing.join(", ")}` };
        const auth: any = await this.tools.call("doordash_auth_check", {});
        return { connected: true, loggedIn: Boolean(auth?.isLoggedIn), detail: auth?.isLoggedIn ? "logged in" : "not logged in" };
      } catch (e) {
        return { connected: false, detail: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  findStore(kind: Kind, hint?: string) {
    return this.run(async () => {
      await this.ready();
      const query = hint?.trim() || (kind === "grocery" ? this.opts.defaultGroceryStore : "dinner");
      const key = `${kind}:${query.toLowerCase()}`;
      const cached = this.stores.get(key);
      if (cached && Date.now() - cached.at < DoorDashMcpProvider.STORE_TTL_MS) return { id: cached.id, name: cached.name } satisfies Store;
      const res = await this.call("doordash_search", { query });
      const list: any[] = Array.isArray(res?.restaurants) ? res.restaurants : [];
      const first = list.find((r) => r?.id && r?.name);
      if (!first) throw new ProviderError("NO_STORE", `DoorDash search for "${query}" returned no stores near the delivery address`);
      const store = { id: String(first.id), name: String(first.name) } satisfies Store;
      this.stores.set(key, { ...store, at: Date.now() });
      return store;
    });
  }

  /**
   * Restaurants: one menu read. Grocery stores have thousands of products, so with `wanted`
   * each item is looked up with the store's own search (`query`). Among the results that match
   * the words best, the one DoorDash ranks first is marked `staple`, settling ties between
   * near-identical products ("wheat bread") in the store's own order.
   */
  catalog(store: Store, wanted: string[] = []) {
    return this.run(async () => {
      await this.ready();
      const read = (res: any): Priced[] =>
        (Array.isArray(res?.categories) ? res.categories : [])
          .flatMap((c: any) => (Array.isArray(c?.items) ? c.items : []))
          .filter((i: any) => i?.name && typeof i?.price === "number")
          .map((i: any) => ({ name: String(i.name), priceCents: cents(i.price) }));
      const items: Priced[] = [];
      const add = (list: Priced[], query?: string) => {
        const best = query ? Math.max(0, ...list.map((it) => score(query, it.name))) : 0;
        const pick = query && best >= 0.5 ? list.find((it) => score(query, it.name) === best) : undefined;
        for (const it of list) {
          if (items.some((x) => x.name === it.name)) continue;
          items.push(it === pick ? { ...it, staple: true } : it);
        }
      };
      for (const q of [...new Set(wanted.map((w) => w.trim()).filter(Boolean))])
        add(read(await this.call("doordash_menu", { restaurantId: store.id, query: q })), q);
      if (!items.length) add(read(await this.call("doordash_menu", { restaurantId: store.id })));
      if (!items.length) throw new ProviderError("EMPTY_MENU", `Couldn't read items for ${store.name}`);
      return items;
    });
  }

  buildCart(store: Store, lines: { name: string; qty: number }[]) {
    return this.run(async (): Promise<CartResult> => {
      await this.ready();
      // The server has no "clear cart" tool: refuse to build on top of someone else's cart.
      const before = await this.call("doordash_cart");
      if (Array.isArray(before?.items) && before.items.length) {
        throw new ProviderError("CART_NOT_EMPTY", "The DoorDash cart already has items. Empty it in the DoorDash app/browser profile first.");
      }
      for (const l of lines) {
        await this.call("doordash_add_to_cart", { restaurantId: store.id, itemName: l.name, quantity: l.qty });
      }
      const cart = await this.call("doordash_cart");
      const got: any[] = Array.isArray(cart?.items) ? cart.items : [];
      // Every requested line must be in the cart, and nothing else.
      const want = lines.map((l) => tokens(l.name).join(" "));
      const have = got.map((i) => tokens(String(i?.name ?? "")).join(" "));
      const unexpected = have.filter((h) => !want.some((w) => h === w || h.includes(w) || w.includes(h)));
      if (got.length < lines.length || unexpected.length) {
        throw new ProviderError("CART_MISMATCH", `Cart doesn't match the approved items (have: ${got.map((i) => i?.name).join(", ") || "nothing"})`);
      }
      return { subtotalCents: cents(cart?.subtotal), totalCents: cents(cart?.total), itemNames: got.map((i) => String(i.name)) };
    });
  }

  preview() {
    return this.run(async () => {
      await this.ready();
      const res = await this.call("doordash_checkout", { confirm: false });
      return { totalCents: cents(res?.summary?.total) || undefined, etaText: res?.summary?.estimatedDelivery || undefined };
    });
  }

  checkout() {
    return this.run(async () => {
      await this.ready();
      const res = await this.call("doordash_checkout", { confirm: true });
      if (!res?.orderId) throw new ProviderError("CHECKOUT_UNCONFIRMED", "DoorDash did not return an order id. Check the DoorDash account before retrying.");
      return { externalOrderId: String(res.orderId), etaText: res?.summary?.estimatedDelivery || undefined };
    });
  }

  track(externalOrderId: string) {
    return this.run(async () => {
      const res = await this.call("doordash_track_order", { orderId: externalOrderId });
      const text = JSON.stringify(res ?? {}).toLowerCase();
      const status: TrackStatus = /delivered/.test(text) ? "delivered"
        : /picked up|on the way|heading to you|dasher/.test(text) ? "picked_up" : "placed";
      return { status, etaText: res?.status?.estimatedDelivery ?? res?.estimatedDelivery ?? undefined };
    });
  }
}

/** Real MCP client: Streamable HTTP (DOORDASH_MCP_URL + token) or stdio (DOORDASH_MCP_COMMAND). */
/**
 * Tools that only read: safe to run again after a hiccup. Cart changes and checkout are never
 * retried, so an item can't be added twice.
 */
export const RETRYABLE_TOOLS = new Set(["doordash_auth_check", "doordash_set_address", "doordash_search", "doordash_menu", "doordash_cart"]);
/** The browser was closed or a page was mid-navigation: the MCP server relaunches it, so one retry recovers. */
export const transientToolError = (res: any) =>
  res?.success === false && /closed|detached|Timeout \d+ms exceeded|navigation|Execution context was destroyed/i.test(String(res?.error ?? res?.raw ?? ""));

/**
 * Wraps a connect function: when the MCP server restarts, the old session is gone and every call
 * fails. A connection-level failure reconnects once; a read-only tool is then retried once.
 */
export function resilient(connect: () => Promise<ToolCaller>, log: (m: string) => void = () => {}): ToolCaller {
  let current: Promise<ToolCaller> | undefined;
  const get = () => (current ??= connect().catch((e) => { current = undefined; throw e; }));
  const reconnect = async (why: string) => {
    log(`DoorDash MCP: reconnecting (${why})`);
    const old = current;
    current = undefined;
    void old?.then((c) => c.close?.()).catch(() => undefined);
    return get();
  };
  return {
    async listTools() {
      try { return await (await get()).listTools(); }
      catch (e) { return (await reconnect(e instanceof Error ? e.message : String(e))).listTools(); }
    },
    async call(name, args) {
      let res: any;
      try { res = await (await get()).call(name, args); }
      catch (e) {
        if (!RETRYABLE_TOOLS.has(name)) throw e;
        return (await reconnect(e instanceof Error ? e.message : String(e))).call(name, args);
      }
      if (RETRYABLE_TOOLS.has(name) && transientToolError(res)) {
        log(`DoorDash MCP: retrying ${name} once (${String(res.error ?? "").split("\n")[0]})`);
        res = await (await get()).call(name, args);
      }
      return res;
    },
    async close() { await (await current)?.close?.(); },
  };
}

export async function connectMcp(o: { url?: string; token?: string; command?: string }, log?: (m: string) => void): Promise<ToolCaller> {
  const tools = resilient(() => connectOnce(o), log);
  await tools.listTools(); // fail at startup if the server isn't there, as before
  return tools;
}

async function connectOnce(o: { url?: string; token?: string; command?: string }): Promise<ToolCaller> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new Client({ name: "care-circle-delivery", version: "0.1.0" });
  if (o.url) {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const headers: Record<string, string> = o.token ? { Authorization: `Bearer ${o.token}` } : {};
    await client.connect(new StreamableHTTPClientTransport(new URL(o.url), { requestInit: { headers } }));
  } else if (o.command) {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const [cmd, ...args] = o.command.split(" ").filter(Boolean);
    await client.connect(new StdioClientTransport({ command: cmd!, args, env: process.env as Record<string, string> }));
  } else {
    throw new ProviderError("MCP_NOT_CONFIGURED", "Set DOORDASH_MCP_URL (+ DOORDASH_MCP_TOKEN) or DOORDASH_MCP_COMMAND");
  }
  return {
    async listTools() { return (await client.listTools()).tools.map((t) => t.name); },
    async call(name, args) {
      const res: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
      const text = res?.content?.find?.((c: any) => c.type === "text")?.text;
      let parsed: any = undefined;
      try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = { success: !res?.isError, raw: text }; }
      if (res?.isError && parsed && parsed.success !== false) parsed.success = false;
      return parsed;
    },
    async close() { await client.close(); },
  };
}
