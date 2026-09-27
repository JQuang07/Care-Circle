// Run from repo root: node --env-file=.env services/money/src/scripts/integration-check.mjs
// Requires running local services. Only mock payments and dry-run deliveries are allowed.
import assert from 'node:assert/strict';
const secret = process.env.CC_INTERNAL_SECRET;
assert(secret, 'CC_INTERNAL_SECRET is required');
const bases = Object.fromEntries(['money', 'family', 'delivery'].map((s, i) => [s, process.env[`${s.toUpperCase()}_URL`] ?? `http://localhost:${4002 + i}`]));
async function call(service, path, body) {
  const response = await fetch(`${bases[service]}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-cc-secret': secret, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
  assert(response.ok, `${service}${path}: HTTP ${response.status}`);
  return response.json();
}
async function until(label, probe) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
const moneyHealth = await call('money', '/health');
const deliveryHealth = await call('delivery', '/health');
assert.equal(moneyHealth.mock, true);
assert.equal(deliveryHealth.provider, 'mock');
assert.equal(deliveryHealth.liveCheckout, false);
const beforeLisa = new Set((await call('family', '/messages?memberId=mem_lisa')).map(m => m.id));
const groceries = await call('money', '/orders/draft', {
  seniorId: 'sen_rose', type: 'groceries', merchantId: 'mer_freshmart',
  items: [{ name: 'whole milk', qty: 1 }, { name: 'wheat bread', qty: 1 }, { name: 'bananas', qty: 2 }],
  amountCents: 0, context: { transcriptExcerpt: 'my usual groceries please' },
});
assert.equal(groceries.request.amountCents, 1455);
assert(groceries.fulfilment.quoteId);
assert.equal(groceries.fraud.risk, 'low');
assert.equal((await call('money', `/orders/${groceries.id}/confirm`, {})).status, 'paid');
const delivery = await until('dry-run delivery', async () => (await call('delivery', '/orders?seniorId=sen_rose')).find(d => d.orderId === groceries.id && d.status === 'dry_run_complete'));
assert.equal(delivery.approvedAmountCents, 1455);
await until('Lisa add-to-order', async () => (await call('family', '/messages?memberId=mem_lisa')).find(m => !beforeLisa.has(m.id) && m.kind === 'add_to_order'));
await call('delivery', `/demo/advance/${delivery.deliveryId}`, { to: 'delivered' });
await until('money delivered callback', async () => (await call('money', `/orders/${groceries.id}`)).fulfilment?.delivery?.status === 'delivered');
console.log('PASS groceries: quote $14.55 → paid → dry_run_complete → delivered; Lisa notified');
const beforeDanny = new Set((await call('family', '/messages?memberId=mem_danny')).map(m => m.id));
const scam = await call('money', '/orders/draft', { seniorId: 'sen_rose', type: 'gift', payeeDescription: 'Target gift cards',
  items: [{ name: 'Target gift card', qty: 5, priceCents: 10000 }], amountCents: 50000,
  context: { transcriptExcerpt: "My grandson Danny needs $500 in gift cards for bail right away; don't tell his mom.", claimedRelative: 'my grandson Danny' } });
assert.equal(scam.status, 'held');
assert.equal(scam.fraud.hardStop, true);
await until('Danny fraud card', async () => (await call('family', '/messages?memberId=mem_danny')).find(m => !beforeDanny.has(m.id) && m.kind === 'fraud_card'));
assert.equal((await call('money', `/holds/${scam.holdId}/resolve`, { decision: 'cancel', byMemberId: 'mem_danny', method: 'verbal_on_verification_call' })).status, 'cancelled');
console.log('PASS scam: held + hard stop → Danny fraud card → verbal cancel');
const gift = await call('money', '/orders/draft', { seniorId: 'sen_rose', type: 'gift', merchantId: 'mer_crumb', recipientMemberId: 'mem_lisa',
  items: [{ name: 'Sweet Crumb Bakery gift card', qty: 1, priceCents: 2500 }], amountCents: 2500,
  context: { statedReason: "for Mia's birthday", transcriptExcerpt: "Mia turns ten; a $25 gift card sent to Lisa." } });
assert.equal(gift.fraud.risk, 'low');
assert.equal((await call('money', `/orders/${gift.id}/confirm`, {})).status, 'paid');
console.log('PASS Mia: gift through Lisa → low risk → paid');
