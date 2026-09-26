/**
 * Guard · every script that ends a purchase ends with a line that confirms under D16.
 * E2E 1 once failed because its "yes" line was wordier than voice accepted; the rule is
 * now in the addendum, and this keeps our own scripts on the right side of it.
 */
import { expect, test } from "vitest";
import { confirmsPurchase } from "../src/d16";
import { GROCERY, MIA_GIFT, PRIVACY } from "../src/scripts";

test.each([GROCERY, MIA_GIFT, PRIVACY])("D16 guard · “$label” ends with a confirming line", (s) => {
  const last = s.script.at(-1)!;
  expect(confirmsPurchase(last), `“${last}”`).toEqual({ ok: true });
});

test("D16 guard · the addendum's own examples", () => {
  expect(confirmsPurchase("Yes, that's everything. Please go ahead and order it.").ok).toBe(true);
  expect(confirmsPurchase("Yes, but add eggs").ok).toBe(false);
  expect(confirmsPurchase("Wait, yes").ok).toBe(false);
  expect(confirmsPurchase("Yes, hold on a second").ok).toBe(false);
});
