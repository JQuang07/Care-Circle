import { Store } from "./store.js";
const store = new Store(process.env.DATABASE_URL);
await store.init();
console.log(
  "Voice schema ready. Senior and member seed data belongs to Agent 3; no other schema was read or changed.",
);
await store.close();
