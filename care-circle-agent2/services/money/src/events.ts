import type { Hold, Order } from './contracts';

export type EventName = 'order.paid' | 'fraud.hold_created' | 'fraud.hold_resolved';
const PATHS: Record<EventName, string> = {
  'order.paid': '/webhooks/order-paid',
  'fraud.hold_created': '/webhooks/fraud-hold',
  'fraud.hold_resolved': '/webhooks/fraud-resolved',
};

export type EventPayload = Order | { order: Order; hold: Hold };
export interface Events { emit(name: EventName, payload: EventPayload): void }

/** Collects events in memory (tests, eval, MOCK). */
export class RecordingEvents implements Events {
  sent: { name: EventName; path: string; payload: EventPayload }[] = [];
  constructor(private log?: (m: string) => void) {}
  emit(name: EventName, payload: EventPayload) {
    this.sent.push({ name, path: PATHS[name], payload });
    this.log?.(`event ${name} → family ${PATHS[name]}`);
  }
}

/** POST to Agent 3 with X-CC-Secret. Fire-and-forget, one retry. */
export function httpEvents(familyUrl: string, secret: string, log: (m: string) => void): Events {
  const post = (name: EventName, payload: EventPayload, attempt: number): void => {
    fetch(`${familyUrl}${PATHS[name]}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-CC-Secret': secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }).catch((e) => {
      log(`event ${name} failed (${e.message})${attempt === 0 ? ', retrying' : ''}`);
      if (attempt === 0) setTimeout(() => post(name, payload, 1), 1000);
    });
  };
  return { emit: (name, payload) => post(name, payload, 0) };
}
