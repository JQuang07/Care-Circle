/**
 * E2E 3 · Scam: order `held`, `hardStop` true → verifier has a `fraud_card` →
 * scripted Danny says "cancel" → hold `cancelled` → moments show 1 more scam stopped.
 */
import { MESSAGE_ACTIONS } from "@care-circle/contracts";
import { money, family, voice, idSet, newSince, inboxSnapshot, summarizeOrder, summarizeMsg } from "../src/api";
import { scenario, waitFor, FailFast } from "../src/harness";
import { VERIFIER_IDS } from "../src/ids";
import { GRANDPARENT_SCAM, DANNY_CANCELS } from "../src/scripts";

scenario("E2E 3 · grandparent scam → hold → verified cancel", async (t) => {
  const ordersBefore = idSet(await money.orders());
  const inboxBefore = await inboxSnapshot(VERIFIER_IDS);
  const momentsBefore = await t.step("family", "GET /moments/:seniorId returns scamsStopped and savedCents", () => family.moments());

  await t.step("voice", "simulate-inbound accepts the grandparent-scam script", () => voice.simulateInbound(GRANDPARENT_SCAM.script));

  const order = await t.step("money", "a new order is `held` with hardStop=true and risk high", () =>
    waitFor("held scam order", async (observe) => {
      const fresh = newSince(await money.orders(), ordersBefore);
      observe(fresh.map(summarizeOrder));
      const paid = fresh.find((o) => o.status === "paid" || o.status === "approved");
      if (paid) throw new FailFast(`SCAM GOT THROUGH: ${JSON.stringify(summarizeOrder(paid))}`);
      const held = fresh.find((o) => o.status === "held");
      if (held && (!held.fraud.hardStop || held.fraud.risk !== "high" || !held.holdId))
        throw new FailFast(`held but hardStop=${held.fraud.hardStop} risk=${held.fraud.risk} holdId=${held.holdId}`);
      return held;
    }));

  await t.step("money", "the assessment shows a layer-1 signal and names a verifier who isVerifier", async () => {
    if (!order.fraud.signals.some((s) => s.layer === 1)) throw new Error(`no layer-1 signal: ${JSON.stringify(order.fraud.signals)}`);
    const v = order.fraud.suggestedVerifierId;
    if (!v || !(VERIFIER_IDS as string[]).includes(v)) throw new Error(`suggestedVerifierId=${v} is not a verifier (${VERIFIER_IDS})`);
    const layers = [...new Set(order.fraud.signals.map((s) => s.layer))].sort();
    if (layers.length < 3) t.warn(`only layers ${layers} fired; the demo drawer shows all four`);
    if (order.fraud.typology !== "grandparent_impostor") t.warn(`typology=${order.fraud.typology} (want grandparent_impostor)`);
  });
  const verifier = order.fraud.suggestedVerifierId!;

  await t.step("family", `the verifier (${verifier}) receives a \`fraud_card\``, () =>
    waitFor("fraud_card", async (observe) => {
      const fresh = newSince(await family.inbox(verifier), inboxBefore[verifier] ?? new Set());
      observe(fresh.map(summarizeMsg));
      const cards = fresh.filter((m) => m.kind === "fraud_card");
      for (const a of cards.flatMap((m) => m.actions ?? []))
        if (!MESSAGE_ACTIONS.fraud_card.payload.safeParse(a.payload).success)
          throw new FailFast(`fraud_card ${a.action} payload violates D5 ({ orderId, holdId }): ${JSON.stringify(a.payload)}`);
      return cards.find((m) => (m.actions ?? []).some((a) => a.payload.holdId === order.holdId && a.payload.orderId === order.id));
    }));

  await t.step("voice", "the verifier says “cancel” via POST /demo/simulate-verification (D3)", () =>
    voice.simulateVerification(order.holdId!, verifier, DANNY_CANCELS));

  const hold = await t.step("money", "the hold becomes `cancelled` by the verifier, verbally", () =>
    waitFor("hold cancelled", async (observe) => {
      const h = (await money.holds()).find((x) => x.id === order.holdId);
      observe(h);
      if (h?.status === "released") throw new FailFast(`HIGH-RISK HOLD RELEASED: ${JSON.stringify(h)}`);
      return h?.status === "cancelled" ? h : undefined;
    }));

  await t.step("money", "the resolution records decision=cancel, the verifier, and method verbal_on_verification_call", async () => {
    const r = hold.resolution;
    if (r?.decision !== "cancel" || r.byMemberId !== verifier || r.method !== "verbal_on_verification_call")
      throw new Error(`resolution=${JSON.stringify(r)}`);
    const o = (await money.orders()).find((x) => x.id === order.id);
    if (o?.status !== "cancelled") throw new Error(`order status=${o?.status} after cancel (want cancelled)`);
  });

  await t.step("family", "moments show exactly one more scam stopped and the amount saved", () =>
    waitFor("moments updated", async (observe) => {
      const m = await family.moments();
      observe({ scamsStopped: m.scamsStopped, savedCents: m.savedCents, before: { s: momentsBefore.scamsStopped, c: momentsBefore.savedCents } });
      if (m.scamsStopped > momentsBefore.scamsStopped + 1) throw new FailFast(`scamsStopped jumped by ${m.scamsStopped - momentsBefore.scamsStopped}`);
      if (m.scamsStopped !== momentsBefore.scamsStopped + 1) return undefined;
      if (m.savedCents - momentsBefore.savedCents !== order.request.amountCents)
        throw new FailFast(`savedCents +${m.savedCents - momentsBefore.savedCents}, want +${order.request.amountCents}`);
      return m;
    }, { timeoutMs: 30_000 }));
});
