/**
 * family service — scaffold from Agent 4 (Phase 0). Owned by Agent 3 from here on.
 * Port 4003 is fixed by CONTRACTS.md §1. Types/schemas: import from "@care-circle/contracts".
 */
import Fastify from "fastify";
import { HealthSchema } from "@care-circle/contracts";

const SERVICE = "family";
const PORT = 4003;

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

// CONTRACTS.md §0: GET /health → { ok: true, service, mock }
app.get("/health", async () => HealthSchema.parse({ ok: true, service: SERVICE, mock: process.env.MOCK === "1" }));

// CONTRACTS.md §0 error shape for everything, including unknown routes.
app.setNotFoundHandler((req, reply) => {
  reply.code(404).send({ error: { code: "NOT_FOUND", message: `${req.method} ${req.url} is not a route on ${SERVICE}` } });
});
app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: { code: err.code ?? (status >= 500 ? "INTERNAL" : "BAD_REQUEST"), message: err.message } });
});

app.get("/", async () => ({ hello: `care-circle ${SERVICE}`, owner: "Agent 3" }));

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
