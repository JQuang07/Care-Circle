import { RecordingEvents, httpEvents } from './events';
import { httpFamilyClient, seedFamilyClient } from './family';

export function selectNeighbors(env: NodeJS.ProcessEnv, now: () => Date, log: (m: string) => void) {
  const fake = env.MOCK_DEPENDENCIES === '1' || !env.FAMILY_URL;
  return {
    family: fake ? seedFamilyClient(now) : httpFamilyClient(env.FAMILY_URL!, env.CC_INTERNAL_SECRET ?? '', now, log),
    events: fake ? new RecordingEvents(log) : httpEvents(env.FAMILY_URL!, env.CC_INTERNAL_SECRET ?? '', log),
  };
}
