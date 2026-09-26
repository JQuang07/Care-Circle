/** E2E 4 · Legit gift card for Mia's birthday: order `paid`, risk `low`. */
import { money, voice, idSet, newSince, summarizeOrder } from "../src/api";
import { scenario, waitFor, FailFast } from "../src/harness";
import { MIA_GIFT } from "../src/scripts";

scenario("E2E 4 · Mia's birthday gift card passes", async (t) => {
  const ordersBefore = idSet(await money.orders());

  await t.step("voice", "simulate-inbound accepts the Mia gift script", () => voice.simulateInbound(MIA_GIFT.script));

  const order = await t.step("money", "a new `gift` order reaches `paid` without being held", () =>
    waitFor("paid gift order", async (observe) => {
      const fresh = newSince(await money.orders(), ordersBefore);
      observe(fresh.map((o) => ({ ...summarizeOrder(o), signals: o.fraud.signals.map((s) => `${s.layer}:${s.code}`) })));
      const held = fresh.find((o) => o.status === "held" || o.status === "cancelled");
      if (held) throw new FailFast(`FALSE HOLD on Mia's gift: ${JSON.stringify(summarizeOrder(held))} signals=${JSON.stringify(held.fraud.signals)}`);
      return fresh.find((o) => o.request.type === "gift" && o.status === "paid");
    }));

  await t.step("money", "risk is `low` and no hard stop fired", async () => {
    if (order.fraud.risk !== "low" || order.fraud.hardStop)
      throw new Error(`risk=${order.fraud.risk} hardStop=${order.fraud.hardStop} signals=${JSON.stringify(order.fraud.signals)}`);
  });

  await t.step("voice", "the voice agent heard “twenty-five dollars” as 2500 cents, gifted via Lisa", async () => {
    if (order.request.amountCents !== 2500) throw new Error(`amountCents=${order.request.amountCents} (want 2500)`);
    if (order.request.recipientMemberId !== "mem_lisa")
      t.warn(`recipientMemberId=${order.request.recipientMemberId}; Mia isn't a member, so the gift should route via mem_lisa (CCR-08)`);
  });
});
