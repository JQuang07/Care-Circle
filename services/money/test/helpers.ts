import type { OrderRequest } from '../src/contracts';
import { buildService } from '../src/deps';
import { RecordingEvents } from '../src/events';
import { seedFamilyClient } from '../src/family';
import type { Llm } from '../src/llm';
import { mockPayments } from '../src/payments';
import { generateHistory } from '../src/seed';
import { MemoryStore } from '../src/store/store';

export const NOW = new Date('2026-11-18T19:00:00Z'); // Wed 2pm ET

export async function setup(opts: { llm?: Llm | null; mock?: boolean } = {}) {
  let now = NOW;
  const clock = { set: (d: Date) => { now = d; }, now: () => now };
  const store = new MemoryStore();
  await store.addLedger(generateHistory(NOW));
  const events = new RecordingEvents();
  const service = buildService({
    store, family: seedFamilyClient(clock.now), payments: mockPayments, events,
    llm: opts.llm ?? null, now: clock.now, mock: opts.mock,
  });
  return { store, events, service, clock };
}

export const DEMO_SCAM: OrderRequest = {
  seniorId: 'sen_rose', type: 'gift', payeeDescription: 'Target gift cards',
  items: [{ name: 'Target gift card', qty: 5, priceCents: 10000 }], amountCents: 50000,
  context: {
    transcriptExcerpt: "My grandson called, he's in jail and needs $500 in gift cards for bail right away, and he said don't tell his mom.",
    claimedRelative: 'my grandson Danny',
  },
};

export const GROCERIES: OrderRequest = {
  seniorId: 'sen_rose', type: 'groceries', merchantId: 'mer_freshmart',
  items: [{ name: 'weekly groceries', qty: 1, priceCents: 5800 }], amountCents: 5800,
  context: { transcriptExcerpt: 'My usual groceries from FreshMart please.' },
};

export const MIA: OrderRequest = {
  seniorId: 'sen_rose', type: 'gift', merchantId: 'mer_freshmart', recipientMemberId: 'mem_lisa',
  items: [{ name: 'FreshMart gift card', qty: 1, priceCents: 2500 }], amountCents: 2500,
  context: { statedReason: "for Mia's birthday", transcriptExcerpt: "Mia turns ten on Saturday, a $25 gift card sent to Lisa." },
};

/** Medium-risk: no hard stop, story + new merchant. */
export const MEDICARE: OrderRequest = {
  seniorId: 'sen_rose', type: 'other', payeeDescription: 'Medicare card renewal',
  items: [{ name: 'Medicare card renewal', qty: 1, priceCents: 4000 }], amountCents: 4000,
  context: { transcriptExcerpt: 'A man from Medicare called and said I have to pay $40 today to keep my benefits.' },
};
