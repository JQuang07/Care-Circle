import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig, type Config } from "../src/config";
import { MockProvider } from "../src/providers/mock";
import type { Provider } from "../src/providers/provider";
import { DeliveryService, type MoneyClient, type MoneyOrder } from "../src/service";

const SECRET = "test-secret-that-is-long-enough-123";
const H = { "x-cc-secret": SECRET };

function setup(o: { cfg?: Partial<Config>; money?: Record<string, MoneyOrder>; provider?: Provider } = {}) {
  const cfg = loadConfig({ secret: SECRET, ...o.cfg }, {});
  const orders = o.money ?? { ord_1: { id: "ord_1", seniorId: "sen_rose", status: "paid", amountCents: 1500 } };
  const money: MoneyClient = { getOrder: async (id) => orders[id] };
  const events: any[] = [];
  const svc = new DeliveryService(cfg, o.provider ?? new MockProvider(), money, (e) => events.push(e), () => {});
  return { app: buildApp(svc, cfg), svc, events, orders };
}

const groceries = { kind: "grocery", items: [{ name: "a gallon of whole milk", qty: 1 }, { name: "bananas", qty: 1 }, { name: "large eggs", qty: 1 }, { name: "unicorn steaks", qty: 1 }] };

describe("delivery · quote", () => {
  it("prices matched items, flags unknown ones, never invents a price", async () => {
    const { app } = setup();
    const r = await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries });
    expect(r.statusCode).toBe(200);
    const q = r.json();
    expect(q.provider).toBe("mock");
    expect(q.lines.filter((l: any) => l.status === "matched")).toHaveLength(3);
    expect(q.lines.find((l: any) => l.requested === "unicorn steaks").status).toBe("not_found");
    expect(q.subtotalCents).toBe(429 + 189 + 379);
    expect(q.feesCents).toBe(299);
    expect(q.totalCents).toBe(429 + 189 + 379 + 299);
  });

  it("requires the shared secret on everything but /health", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "POST", url: "/quote", payload: groceries })).statusCode).toBe(401);
    const h = await app.inject({ method: "GET", url: "/health" });
    expect(h.json()).toMatchObject({ ok: true, service: "delivery", mock: true, provider: "mock", liveCheckout: false });
  });
});

describe("delivery · orders (money-gated)", () => {
  const order = async (app: any, quoteId: string, extra: any = {}) =>
    app.inject({ method: "POST", url: "/orders", headers: H, payload: { orderId: "ord_1", seniorId: "sen_rose", quoteId, approvedAmountCents: 1500, ...extra } });

  it("dry run by default: builds the cart, never places an order, and emits status", async () => {
    const { app, events } = setup();
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const r = await order(app, q.quoteId);
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("dry_run_complete");
    expect(r.json().externalOrderId).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ orderId: "ord_1", seniorId: "sen_rose", storeName: q.storeName, status: "dry_run_complete" });
  });

  it("refuses when money says the order isn't paid", async () => {
    const { app } = setup({ money: { ord_1: { id: "ord_1", seniorId: "sen_rose", status: "held", amountCents: 1500 } } });
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const r = await order(app, q.quoteId);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("ORDER_NOT_PAID");
  });

  it("refuses to approve more than money charged", async () => {
    const { app } = setup();
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    expect((await order(app, q.quoteId, { approvedAmountCents: 99999 })).json().error.code).toBe("AMOUNT_MISMATCH");
  });

  it("fails the delivery when the cart costs more than approved + tolerance", async () => {
    const { app } = setup({ money: { ord_1: { id: "ord_1", seniorId: "sen_rose", status: "paid", amountCents: 500 } } });
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const r = await order(app, q.quoteId, { approvedAmountCents: 500 });
    expect(r.json().status).toBe("failed");
    expect(r.json().failureReason).toMatch(/above the approved/);
  });

  it("fails the delivery when the cart is over the hard cap", async () => {
    const { app } = setup({ cfg: { maxOrderCents: 1000, tolerancePct: 1000 } });
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const r = await order(app, q.quoteId);
    expect(r.json().status).toBe("failed");
    expect(r.json().failureReason).toMatch(/hard cap/);
  });

  it("is idempotent per money order", async () => {
    const { app } = setup();
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const a = (await order(app, q.quoteId)).json(), b = (await order(app, q.quoteId)).json();
    expect(a.deliveryId).toBe(b.deliveryId);
  });

  it("live checkout is refused on the mock, even if someone sets the flag", async () => {
    const { app } = setup({ cfg: { liveCheckout: true } });
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const d = (await order(app, q.quoteId)).json();
    expect(d.status).toBe("dry_run_complete");
    const r = await app.inject({ method: "POST", url: `/orders/${d.deliveryId}/checkout`, headers: H, payload: { confirmedBy: "Andy" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("LIVE_CHECKOUT_DISABLED");
  });

  it("demo advance simulates the Dasher on the mock", async () => {
    const { app, events } = setup();
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const d = (await order(app, q.quoteId)).json();
    const r = await app.inject({ method: "POST", url: `/demo/advance/${d.deliveryId}`, headers: H, payload: { to: "delivered" } });
    expect(r.json().status).toBe("delivered");
    expect(events.at(-1).status).toBe("delivered");
  });
});

describe("delivery · live gate with a (fake) real provider", () => {
  class FakeLive extends MockProvider { readonly name = "doordash_thirdparty" as any; placedCount = 0;
    override async checkout() { this.placedCount++; return super.checkout(); } }

  it("needs live flag + secret + confirmedBy + paid order, then places exactly once", async () => {
    const p = new FakeLive();
    const { app, orders } = setup({ provider: p, cfg: { provider: "doordash_thirdparty", liveCheckout: true } });
    const q = (await app.inject({ method: "POST", url: "/quote", headers: H, payload: groceries })).json();
    const d = (await app.inject({ method: "POST", url: "/orders", headers: H, payload: { orderId: "ord_1", quoteId: q.quoteId, approvedAmountCents: 1500 } })).json();
    expect(d.status).toBe("awaiting_live_checkout");
    expect((await app.inject({ method: "POST", url: `/orders/${d.deliveryId}/checkout`, payload: { confirmedBy: "Andy" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/orders/${d.deliveryId}/checkout`, headers: H, payload: {} })).json().error.code).toBe("CONFIRMATION_REQUIRED");
    orders.ord_1!.status = "cancelled";
    expect((await app.inject({ method: "POST", url: `/orders/${d.deliveryId}/checkout`, headers: H, payload: { confirmedBy: "Andy" } })).json().error.code).toBe("ORDER_NOT_PAID");
    orders.ord_1!.status = "paid";
    const ok = await app.inject({ method: "POST", url: `/orders/${d.deliveryId}/checkout`, headers: H, payload: { confirmedBy: "Andy" } });
    expect(ok.json().status).toBe("placed");
    expect((await app.inject({ method: "POST", url: `/orders/${d.deliveryId}/checkout`, headers: H, payload: { confirmedBy: "Andy" } })).json().error.code).toBe("NOT_AWAITING_CHECKOUT");
    expect(p.placedCount).toBe(1);
    expect((await app.inject({ method: "POST", url: `/demo/advance/${d.deliveryId}`, headers: H, payload: { to: "delivered" } })).json().error.code).toBe("MOCK_ONLY");
  });
});
