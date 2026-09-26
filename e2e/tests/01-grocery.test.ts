/** E2E 1 · Grocery: order `paid` → Lisa has an `add_to_order` message. */
import { money, family, voice, idSet, newSince, summarizeOrder, summarizeMsg } from "../src/api";
import { scenario, waitFor, FailFast } from "../src/harness";
import { GROCERY } from "../src/scripts";

scenario("E2E 1 · grocery happy path", async (t) => {
  const ordersBefore = idSet(await money.orders());
  const lisaBefore = idSet(await family.inbox("mem_lisa"));

  await t.step("voice", "POST /demo/simulate-inbound accepts the grocery script and returns a callId", () =>
    voice.simulateInbound(GROCERY.script));

  const order = await t.step("money", "a new `groceries` order reaches status `paid` (not held)", () =>
    waitFor("new groceries order with status paid", async (observe) => {
      const fresh = newSince(await money.orders(), ordersBefore);
      observe(fresh.map(summarizeOrder));
      const held = fresh.find((o) => o.status === "held" || o.status === "cancelled");
      if (held) throw new FailFast(`grocery order was ${held.status} (false positive): ${JSON.stringify(summarizeOrder(held))} signals=${JSON.stringify(held.fraud.signals)}`);
      return fresh.find((o) => o.request.type === "groceries" && o.status === "paid");
    }));

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
});
