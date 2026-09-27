/**
 * E2E 4 · Legit gift card for Mia's birthday: order `paid`, risk `low`.
 * Selects only the order THIS scenario created (gift, via mem_lisa per D7, created after the
 * scenario started). A late-arriving order from E2E 3 is never mistaken for a false hold.
 */
import type { Order } from "@care-circle/contracts";
import { money, voice, idSet, newSince, summarizeOrder } from "../src/api";
import { scenario, waitFor, FailFast } from "../src/harness";
import { MIA_GIFT } from "../src/scripts";

/** Services share this machine's clock; allow a little slack for rounding. */
const CLOCK_SLACK_MS = 2_000;

scenario("E2E 4 · Mia's birthday gift card passes", async (t) => {
  const ordersBefore = idSet(await money.orders());
  const startedAt = Date.now() - CLOCK_SLACK_MS;
  const isMine = (o: Order) =>
    o.request.type === "gift" && o.request.recipientMemberId === "mem_lisa" && Date.parse(o.createdAt) >= startedAt;

  await t.step("voice", "simulate-inbound accepts the Mia gift script", () => voice.simulateInbound(MIA_GIFT.script));

  const draft = await t.step("voice", "voice drafts a `gift` order with recipientMemberId mem_lisa (D7)", () =>
    waitFor("gift order for Mia via Lisa", async (observe) => {
      const fresh = newSince(await money.orders(), ordersBefore);
      observe(fresh.map((o) => ({ ...summarizeOrder(o), recipient: o.request.recipientMemberId, createdAt: o.createdAt, mine: isMine(o) })));
      return fresh.find(isMine);
    }));

  await t.step("money", "Mia's gift is not held (no false positive)", async () => {
    if (draft.status === "held" || draft.status === "cancelled")
      throw new Error(`FALSE HOLD on Mia's gift: ${JSON.stringify(summarizeOrder(draft))} signals=${JSON.stringify(draft.fraud.signals)}`);
  });

  const order = await t.step("voice", "Rose's “yes” confirms the purchase (D16), so the gift becomes `paid`", () =>
    waitFor("gift paid", async (observe) => {
      const o = (await money.orders()).find((x) => x.id === draft.id);
      observe(o && summarizeOrder(o));
      if (o?.status === "held" || o?.status === "cancelled") throw new FailFast(`gift became ${o.status}: ${JSON.stringify(o.fraud.signals)}`);
      return o?.status === "paid" ? o : undefined;
    }, { timeoutMs: 30_000 }));

  await t.step("money", "risk is `low` and no hard stop fired", async () => {
    if (order.fraud.risk !== "low" || order.fraud.hardStop)
      throw new Error(`risk=${order.fraud.risk} hardStop=${order.fraud.hardStop} signals=${JSON.stringify(order.fraud.signals)}`);
  });

  await t.step("voice", "the voice agent heard “twenty-five dollars” as 2500 cents", async () => {
    if (order.request.amountCents !== 2500) throw new Error(`amountCents=${order.request.amountCents} (want 2500)`);
  });
});
