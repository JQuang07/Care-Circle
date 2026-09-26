import { config } from "./config.js";
import { createApp } from "./app.js";
const c = config();
const { app } = await createApp(c);
await app.listen({ port: c.port, host: c.host });
console.log(
  `Care Circle voice listening on ${c.host}:${c.port}; mock=${c.mock}; mockDependencies=${c.mockDependencies}`,
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => void app.close());
