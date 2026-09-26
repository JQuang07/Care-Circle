import { Store } from "./store.js";
const store = new Store(process.env.DATABASE_URL);
await store.init();
const values = [...store.sessions.values()]
  .flatMap((s) => s.latencies)
  .sort((a, b) => a - b);
if (values.length < 10) {
  console.log(
    `Need at least 10 live turns; have ${values.length}. No latency claim can be made.`,
  );
  process.exitCode = 1;
} else {
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2
      ? values[middle]!
      : (values[middle - 1]! + values[middle]!) / 2;
  console.log(
    JSON.stringify(
      {
        turns: values.length,
        medianMs: Math.round(median),
        p95Ms: Math.round(values[Math.ceil(values.length * 0.95) - 1]!),
        targetMet: median <= 1500,
        measurement:
          "STT final received to first TTS media sent; excludes STT endpointing and phone network latency",
      },
      null,
      2,
    ),
  );
}
await store.close();
