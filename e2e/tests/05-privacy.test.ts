/**
 * E2E 5 · Privacy: the script includes "keep this between us" plus a detail →
 * that detail appears in NO message to anyone. A positive control (said outside the
 * private span) shows the pipeline actually ran, so an empty inbox can't pass by luck.
 */
import type { Message } from "@care-circle/contracts";
import { money, family, voice, idSet, newSince, inboxSnapshot, summarizeOrder } from "../src/api";
import { scenario, waitFor, sleep } from "../src/harness";
import { MEMBER_IDS } from "../src/ids";
import { PRIVACY, PRIVATE_DETAIL_TERMS, PRIVACY_CONTROL_TERMS } from "../src/scripts";

const leaks = (msgs: Message[]) =>
  msgs.flatMap((m) => {
    const hay = `${m.body} ${JSON.stringify(m.actions ?? [])}`.toLowerCase();
    return PRIVATE_DETAIL_TERMS.filter((term) => hay.includes(term)).map((term) => ({ id: m.id, to: m.toMemberId, kind: m.kind, term, body: m.body }));
  });

scenario("E2E 5 · “keep this between us” never reaches family", async (t) => {
  const ordersBefore = idSet(await money.orders());
  const inboxBefore = await inboxSnapshot(MEMBER_IDS);

  await t.step("voice", "simulate-inbound accepts the privacy script", () => voice.simulateInbound(PRIVACY.script));

  await t.step("money", "the grocery order in the same call is paid (so post-call hooks run)", () =>
    waitFor("paid order", async (observe) => {
      const fresh = newSince(await money.orders(), ordersBefore);
      observe(fresh.map(summarizeOrder));
      return fresh.find((o) => o.status === "paid");
    }));

  const allNew = async () =>
    (await Promise.all(MEMBER_IDS.map(async (m) => newSince(await family.inbox(m), inboxBefore[m]!)))).flat();

  await t.step("family", "the post-call pipeline produces at least one new family message", () =>
    waitFor("any new message from this call", async (observe) => {
      const fresh = await allNew();
      observe(fresh.length);
      return fresh.length ? fresh : undefined;
    }));

  // Hooks and nudges can trail the order. Give them time to arrive before judging.
  await sleep(8_000);
  const fresh = await allNew();

  await t.step("family", "no new message contains the private detail (or a paraphrase)", async () => {
    const found = leaks(fresh);
    if (found.length) throw new Error(`PRIVACY LEAK: ${JSON.stringify(found)}`);
  });

  await t.step("family", "the whole inbox of every member is also clean (catches leaks from earlier runs)", async () => {
    const all = (await Promise.all(MEMBER_IDS.map((m) => family.inbox(m)))).flat();
    const found = leaks(all);
    if (found.length) throw new Error(`PRIVACY LEAK in history: ${JSON.stringify(found.slice(0, 3))}`);
  });

  const control = fresh.some((m) => PRIVACY_CONTROL_TERMS.some((c) => m.body.toLowerCase().includes(c)));
  if (!control) t.warn(`positive control (“${PRIVACY_CONTROL_TERMS.join("/")}”) never surfaced; hook extraction may not have run, so this pass is weaker evidence`);
});
