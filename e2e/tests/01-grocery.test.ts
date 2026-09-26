/**
 * E2E 1 · Grocery: order `paid` → Lisa has an `add_to_order` message → delivery (mock)
 * is `dry_run_complete` → advanced to `delivered` → the family hears the groceries arrived.
 */
import { money, family, voice, delivery, idSet, newSince, inboxSnapshot, summarizeOrder, summarizeMsg } from "../src/api";
import { MEMBER_IDS } from "../src/ids";
import { scenario, waitFor, FailFast } from "../src/harness";
import { GROCERY } from "../src/scripts";

scenario("E2E 1 · grocery happy path", async (t) => {
  const ordersBefore = idSet(await money.orders());
  const lisaBefore = idSet(await family.inbox("mem_lisa"));
  const deliveriesBefore = new Set((await delivery.orders()).map((d) => d.deliveryId));

  await t.step("voice", "POST /demo/simulate-inbound accepts the grocery script and returns a callId", () =>
    voice.simulateInbound(GROCERY.script));

  const draft = await t.step("money", "voice's draft becomes a new `groceries` order that is not held", () =>
    waitFor("new groceries order", async (observe) => {
      const fresh = newSince(await money.orders(), ordersBefore);
      observe(fresh.map(summarizeOrder));
      const held = fresh.find((o) => o.status === "held" || o.status === "cancelled");
      if (held) throw new FailFast(`grocery order was ${held.status} (false positive): ${JSON.stringify(summarizeOrder(held))} signals=${JSON.stringify(held.fraud.signals)}`);
      return fresh.find((o) => o.request.type === "groceries");
    }));

  const order = await t.step("voice", "Rose's “yes” confirms the purchase (D16), so the order becomes `paid`", () =>
    waitFor("order paid", async (observe) => {
      const o = (await money.orders()).find((x) => x.id === draft.id);
      observe(o && summarizeOrder(o));
      return o?.status === "paid" ? o : undefined;
    }, { timeoutMs: 30_000 }));

  await t.step("money", "the paid order is low risk, not a hard stop, and has a receipt", async () => {
    if (order.fraud.hardStop) throw new Error(`hardStop=true on a grocery order: ${JSON.stringify(order.fraud.signals)}`);
    if (order.fraud.risk !== "low") throw new Error(`risk=${order.fraud.risk} (want low)`);
    if (!order.receiptUrl) throw new Error("paid order has no receiptUrl");
  });

  await t.step("family", "Lisa gets a new `add_to_order` message for this order", () =>
    waitFor("add_to_order in Lisa's inbox", async (observe) => {
      const fresh = newSince(await family.inbox("mem_lisa"), lisaBefore);
      observe(fresh.map(summarizeMsg));
      const hit = fresh.find((m) => m.kind === "add_to_order");
      if (!hit) return undefined;
      const linked = hit.actions?.map((a) => a.payload?.orderId).find(Boolean);
      if (linked && linked !== order.id) throw new FailFast(`add_to_order points at ${linked}, want ${order.id}`);
      return hit;
    }));

  const dry = await t.step("delivery", "delivery has a `dry_run_complete` order for this paid order (provider mock)", () =>
    waitFor("delivery dry run", async (observe) => {
      const fresh = (await delivery.orders()).filter((d) => !deliveriesBefore.has(d.deliveryId));
      observe(fresh.map((d) => ({ deliveryId: d.deliveryId, orderId: d.orderId, status: d.status, provider: d.provider })));
      const mine = fresh.find((d) => d.orderId === order.id);
      if (mine?.status === "failed") throw new FailFast(`delivery failed: ${mine.failureReason}`);
      if (mine && mine.provider !== "mock") throw new FailFast(`provider=${mine.provider} during E2E (must be mock)`);
      return mine?.status === "dry_run_complete" ? mine : undefined;
    }, { timeoutMs: 30_000 }));

  const circleBefore = await inboxSnapshot(MEMBER_IDS);

  await t.step("delivery", "POST /demo/advance/:id {to:\"delivered\"} moves the delivery to `delivered`", async () => {
    const d = await delivery.advance(dry.deliveryId, "delivered");
    if (d.status !== "delivered") throw new Error(`status=${d.status} after advance (want delivered)`);
  });

  await t.step("family", "the family gets a “Rose's groceries arrived” message", () =>
    waitFor("arrived message", async (observe) => {
      const fresh = (await Promise.all(MEMBER_IDS.map(async (m) => newSince(await family.inbox(m), circleBefore[m]!)))).flat();
      observe(fresh.map(summarizeMsg));
      return fresh.find((m) => /arriv/i.test(m.body));
    }, { timeoutMs: 30_000 }));

  await t.step("money", "GET /orders/:id shows fulfilment.delivery `delivered` (D9 + delivery event)", () =>
    waitFor("order.fulfilment.delivery delivered", async (observe) => {
      const o = await money.order(order.id);
      observe(o.fulfilment);
      return o.fulfilment?.delivery?.deliveryId === dry.deliveryId && o.fulfilment.delivery.status === "delivered" ? o : undefined;
    }, { timeoutMs: 30_000 }));
});
