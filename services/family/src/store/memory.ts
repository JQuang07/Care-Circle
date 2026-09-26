import { COLLECTIONS, type Collection, type Store } from "./types.js";

function memoryCollection<T extends { id: string }>(): Collection<T> {
  const docs = new Map<string, T>();
  const clone = <V>(v: V): V => structuredClone(v);
  return {
    async get(id) { const d = docs.get(id); return d ? clone(d) : undefined; },
    async put(doc) { docs.set(doc.id, clone(doc)); return clone(doc); },
    async list(filter) {
      const all = [...docs.values()];
      const entries = Object.entries(filter ?? {});
      return all.filter((d) => entries.every(([k, v]) => (d as any)[k] === v)).map(clone);
    },
    async delete(id) { docs.delete(id); },
    async clear() { docs.clear(); },
  };
}

export function createMemoryStore(): Store {
  const store: any = { kind: "memory", close: async () => {} };
  for (const name of COLLECTIONS) store[name] = memoryCollection();
  return store as Store;
}
