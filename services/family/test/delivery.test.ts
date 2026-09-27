import { beforeEach, describe, expect, it } from "vitest";
import type { Message } from "../src/contracts-local.js";
import { ServiceError } from "../src/adapters/services.js";
import { json, makeCtx, type TestCtx } from "./helpers.js";

// Task 5: POST /webhooks/delivery-status (D14 events from services/delivery).
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeCtx(); });

const ev = (status: string, extra: Record<string, unknown> = {}) => ({
  deliveryId: "dlv_1", orderId: "ord_g1", seniorId: "sen_rose", storeName: "FreshMart", status, ...extra,
});

async function post(body: unknown, headers?: Record<string, string>) {
  const r = await json(ctx, "POST", "/webhooks/delivery-status", body, headers);
  await ctx.app.flushJobs();
  return r;
}

const inbox = async (memberId: string) => (await json<Message[]>(ctx, "GET", `/messages?memberId=${memberId}`)).body;
const texts = async (memberId: string) => (await inbox(memberId)).map((m) => m.body);

describe("delivery-status webhook", () => {
  it("requires the secret and a well-formed event", async () => {
    expect((await post(ev("placed"), {})).status).toBe(401);
    expect((await post({ status: "placed" })).status).toBe(400);
    expect((await post(ev("placed"))).body).toEqual({ ok: true });
  });

  it("dry_run_complete → only Lisa hears the groceries are ready", async () => {
    await post(ev("dry_run_complete"));
    expect(await texts("mem_lisa")).toEqual(["✅ Order confirmed: Rose's groceries are ordered from FreshMart. (Demo: DoorDash checkout reached, no real charge.)"]);
    expect(await texts("mem_danny")).toEqual([]);
    expect(await texts("mem_mark")).toEqual([]);
  });

  it("placed and picked_up → a short ETA note to the whole circle, with tracking when given", async () => {
    await post(ev("placed", { etaText: "around 2:40 PM", trackingUrl: "https://track.test/dlv_1" }));
    await post(ev("picked_up", { etaText: "in about 15 minutes" }));
    for (const m of ["mem_lisa", "mem_danny", "mem_mark"]) {
      const msgs = await inbox(m);
      expect(msgs.map((x) => x.body)).toEqual([
        "Rose's groceries from FreshMart are on the way, arriving around 2:40 PM.",
        "The driver picked up Rose's groceries from FreshMart, arriving in about 15 minutes.",
      ]);
      expect(msgs[0].actions).toEqual([{ label: "Track delivery", action: "open_url", payload: { url: "https://track.test/dlv_1" } }]);
    }
  });

  it("delivered → the circle hears it and voice is asked to tell Rose; a voice 400 is ignored", async () => {
    ctx.voice.outbound = async (body) => { ctx.voice.outbounds.push(body); throw new ServiceError(400, "BAD_REQUEST", "unknown purpose"); };
    const r = await post(ev("delivered"));
    expect(r.status).toBe(200);
    for (const m of ["mem_lisa", "mem_danny", "mem_mark"]) expect(await texts(m)).toEqual(["Rose's groceries arrived."]);
    expect(ctx.voice.outbounds).toEqual([{ seniorId: "sen_rose", purpose: "delivery_arrived", orderId: "ord_g1" }]);
  });

  it("failed → verifiers only, with the reason", async () => {
    await post(ev("failed", { failureReason: "cart total $31.20 is over the approved $28.00 + 10%" }));
    const body = "Rose's grocery delivery from FreshMart didn't go through. Reason: cart total $31.20 is over the approved $28.00 + 10%.";
    expect(await texts("mem_lisa")).toEqual([body]);
    expect(await texts("mem_danny")).toEqual([body]);
    expect(await texts("mem_mark")).toEqual([]);
  });

  it("is idempotent by deliveryId + status; other statuses are ignored", async () => {
    await post(ev("delivered"));
    await post(ev("delivered"));
    await post(ev("cart_ready"));
    await post(ev("awaiting_live_checkout"));
    expect(await texts("mem_danny")).toEqual(["Rose's groceries arrived."]);
    expect(ctx.voice.outbounds).toHaveLength(1);
  });

  it("an event with only the documented fields is routed by looking the delivery up", async () => {
    ctx.delivery.orders.push({ deliveryId: "dlv_9", orderId: "ord_9", seniorId: "sen_rose", storeName: "Corner Grocer", status: "dry_run_complete" });
    await post({ deliveryId: "dlv_9", orderId: "ord_9", status: "dry_run_complete" });
    expect(await texts("mem_lisa")).toEqual(["✅ Order confirmed: Rose's groceries are ordered from Corner Grocer. (Demo: DoorDash checkout reached, no real charge.)"]);
  });
});
