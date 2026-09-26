import type { DeliveryClient } from './delivery';
import { assess } from './fraud/assess';
import { heuristicClassifier, museClassifier } from './fraud/layer2';
import type { Events } from './events';
import type { FamilyClient } from './family';
import { museLlm, type Llm } from './llm';
import type { OrderRequest } from './contracts';
import { simulatedPasskey } from './passkey';
import type { PaymentsProvider } from './payments';
import { SEED_CREDENTIAL, ROSE_ID, generateHistory } from './seed';
import { MoneyService } from './service';
import type { Store } from './store/store';

export const credentialFor = (seniorId: string) => (seniorId === ROSE_ID ? SEED_CREDENTIAL : undefined);

export function makeLlm(env: NodeJS.ProcessEnv): Llm | null {
  return env.META_API_KEY ? museLlm({ META_API_KEY: env.META_API_KEY, MUSE_MODEL: env.MUSE_MODEL, MUSE_BASE_URL: env.MUSE_BASE_URL }) : null;
}

export interface BuildServiceOptions {
  delivery?: DeliveryClient;
  store: Store; family: FamilyClient; payments: PaymentsProvider; events: Events;
  llm: Llm | null; now: () => Date; mock?: boolean; log?: (m: string) => void;
}

export function buildService(o: BuildServiceOptions): MoneyService {
  const classifier = o.llm ? museClassifier(o.llm, o.log) : heuristicClassifier;
  // MOCK changes external providers, never the deterministic fraud gates.
  const assessFn = (req: OrderRequest) =>
    assess(req, { store: o.store, family: o.family, classifier, llm: o.llm, credential: credentialFor, now: o.now });
  return new MoneyService({
    delivery: o.delivery, log: o.log, store: o.store, family: o.family, payments: o.payments, events: o.events,
    passkey: simulatedPasskey, assess: assessFn, credential: credentialFor, now: o.now,
  });
}

/** Seed Rose's 60-day history once (Agent 2 owns it). */
export async function seedIfEmpty(store: Store, now: Date) {
  if ((await store.countLedger(ROSE_ID)) === 0) await store.addLedger(generateHistory(now));
}
