// Drives the live family service (+ `npm run fakes`) through the demo's scheduling + scam path over HTTP.
// Usage: npx tsx dev/scenario.ts        (service on FAMILY_URL, fakes on VOICE_URL / MONEY_URL)
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const H = { "content-type": "application/json", "X-CC-Secret": cfg.internalSecret };
async function call(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json as any;
}
const fam = (m: string, p: string, b?: unknown) => call(cfg.familyUrl, m, p, b);
const step = (s: string) => console.log(`\n▶ ${s}`);

step("reset");
await fam("POST", "/demo/reset");

step("Rose: \"I'd love to see the kids\" → schedule request");
const t0 = Date.now();
const p = await fam("POST", "/schedule/request", { seniorId: "sen_rose", kind: "video_call", initiatedBy: "senior", includeDependents: true });
console.log(`  ${p.id} in ${Date.now() - t0}ms`);
for (const s of p.slots) console.log(`  - ${s.localTimes.sen_rose} (Mark ${s.localTimes.mem_mark}): ${s.reason}`);

step("family taps a slot on WhatsApp");
const slot = p.slots.find((s: any) => s.localTimes.sen_rose.startsWith("Sun")) ?? p.slots[0];
for (const m of p.memberIds) {
  const inbox = await fam("GET", `/messages?memberId=${m}`);
  const msg = inbox.find((x: any) => x.kind === "schedule_proposal");
  await fam("POST", `/messages/${msg.id}/act`, { action: "accept_slot", payload: { slotId: slot.id } });
}
console.log("  pending-senior:", (await fam("GET", "/proposals/sen_rose/pending-senior")).map((x: any) => `${x.id} ${x.status}`));

step("Rose confirms by voice → LiveKit room");
const sc = await fam("POST", `/schedule/proposals/${p.id}/confirm-senior`, { slotId: slot.id });
console.log(`  ${sc.id} room=${sc.roomName} join=${sc.roomJoinUrl}`);
const join = await fam("GET", `/schedule/calls/${sc.id}/join?memberId=mem_lisa`);
console.log(`  Lisa token (${join.token.length} chars) for ${join.serverUrl}`);

step("fast-forward to T-60, T-30, T-0");
for (const before of [60, 30, 0]) {
  const r = await fam("POST", "/demo/time-travel", { to: "next_call", minutesBefore: before });
  console.log(`  T-${before}:`, JSON.stringify(r.tick));
}
try {
  const due = await call(cfg.voiceUrl, "GET", "/__fake/due-events");
  console.log("  fake voice received:", due.map((d: any) => `${d.phase}:${d.call.id}`));
} catch { console.log("  (real voice service running; check its logs)"); }

step("scam: fraud hold → cards → Danny cancels");
const order = {
  id: `ord_scam_${Date.now()}`, seniorId: "sen_rose", status: "held", createdAt: new Date().toISOString(),
  request: { seniorId: "sen_rose", type: "gift", payeeDescription: "Target gift cards", amountCents: 50000, items: [{ name: "Target gift card", qty: 5 }],
    context: { transcriptExcerpt: "He said not to tell his mom.", claimedRelative: "my grandson", urgencyOrSecrecy: true } },
  fraud: { risk: "high", score: 95, hardStop: true, typology: "grandparent_impostor", signals: [], recommendedAction: "hold", suggestedVerifierId: "mem_danny",
    seniorFacingMessage: "Let's check with Danny first.", familyFacingSummary: "Rose was asked for $500 in gift cards by someone claiming to be her grandson, with 'don't tell your mom' language. Danny last called Sunday and has never asked for money." },
};
const hold = { id: `hold_${Date.now()}`, orderId: order.id, seniorId: "sen_rose", status: "open", createdAt: new Date().toISOString(), coolingOffUntil: new Date(Date.now() + 86_400_000).toISOString() };
try { await call(cfg.moneyUrl, "POST", "/__fake/register", { order, hold }); } catch { console.log("  (real money running: skipping fake registration)"); }
await fam("POST", "/webhooks/fraud-hold", { order, hold });
await new Promise((r) => setTimeout(r, 500));
const card = (await fam("GET", "/messages?memberId=mem_danny")).find((m: any) => m.kind === "fraud_card");
console.log("  Danny's card:", card.body.slice(0, 90), "…", card.actions.map((a: any) => a.label));
console.log("  cancel →", (await fam("POST", `/messages/${card.id}/act`, { action: "cancel_hold" })).hold.status);
await new Promise((r) => setTimeout(r, 800));
console.log("  Mark:", (await fam("GET", "/messages?memberId=mem_mark")).filter((m: any) => /All clear/.test(m.body)).map((m: any) => m.body.split("\n")[0]));
console.log("  moments:", JSON.stringify(await fam("GET", "/moments/sen_rose")));
