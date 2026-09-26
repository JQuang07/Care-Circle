/**
 * D1 · Demo reset: `POST /demo/reset` → `{ ok: true }` on family → money → delivery → voice
 * (the order web's "Reset all data" uses). Runs first, so later scenarios start from seed.
 * One scenario per service, so each failure is routed to its own owner.
 */
import { RESET_ORDER, reset, delivery } from "../src/api";
import { scenario } from "../src/harness";

for (const service of RESET_ORDER) {
  scenario(`E2E 0 · ${service} /demo/reset restores seed`, async (t) => {
    await t.step(service, `POST ${service} /demo/reset → { ok: true } (D1)`, () => reset(service));
    if (service === "delivery")
      await t.step("delivery", "after reset, delivery has no orders for Rose", async () => {
        const left = await delivery.orders();
        if (left.length) throw new Error(`${left.length} delivery order(s) survived reset: ${left.map((d) => d.deliveryId).join(", ")}`);
      });
  }, 30_000);
}
