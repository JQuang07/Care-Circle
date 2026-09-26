import type { Hold, Order } from '../contracts';

/** A completed purchase. Seeded history plus every order that gets paid. */
export interface LedgerEntry {
  id: string; seniorId: string; at: string;
  merchantId?: string; category: string; amountCents: number; label?: string;
}

export interface Store {
  init(): Promise<void>;
  reset(seed: LedgerEntry[]): Promise<void>;
  addLedger(entries: LedgerEntry[]): Promise<void>;
  getLedger(seniorId: string, sinceIso: string): Promise<LedgerEntry[]>;
  countLedger(seniorId: string): Promise<number>;
  saveOrder(o: Order): Promise<void>;
  getOrder(id: string): Promise<Order | undefined>;
  listOrders(seniorId: string): Promise<Order[]>;
  saveHold(h: Hold): Promise<void>;
  getHold(id: string): Promise<Hold | undefined>;
  listHolds(seniorId: string): Promise<Hold[]>;
  listOpenHoldsDue(nowIso: string): Promise<Hold[]>;
}

const clone = <T>(x: T): T => structuredClone(x);

export class MemoryStore implements Store {
  private ledger: LedgerEntry[] = [];
  private orders = new Map<string, Order>();
  private holds = new Map<string, Hold>();
  async init() {}
  async reset(seed: LedgerEntry[]) {
    this.orders.clear(); this.holds.clear(); this.ledger = seed.map(clone);
  }
  async addLedger(entries: LedgerEntry[]) { this.ledger.push(...entries.map(clone)); }
  async getLedger(seniorId: string, since: string) {
    return this.ledger.filter((e) => e.seniorId === seniorId && e.at >= since).map(clone);
  }
  async countLedger(seniorId: string) { return this.ledger.filter((e) => e.seniorId === seniorId).length; }
  async saveOrder(o: Order) { this.orders.set(o.id, clone(o)); }
  async getOrder(id: string) { const o = this.orders.get(id); return o && clone(o); }
  async listOrders(seniorId: string) {
    return [...this.orders.values()].filter((o) => o.seniorId === seniorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone);
  }
  async saveHold(h: Hold) { this.holds.set(h.id, clone(h)); }
  async getHold(id: string) { const h = this.holds.get(id); return h && clone(h); }
  async listHolds(seniorId: string) {
    return [...this.holds.values()].filter((h) => h.seniorId === seniorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone);
  }
  async listOpenHoldsDue(now: string) {
    return [...this.holds.values()].filter((h) => h.status === 'open' && h.coolingOffUntil <= now).map(clone);
  }
}
