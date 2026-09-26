import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import { ApiError, type DeliveryService } from "./service.js";

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Every route except /health requires X-CC-Secret (callers: money, family, the web proxy). */
export function buildApp(svc: DeliveryService, cfg: Config, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const given = String(req.headers["x-cc-secret"] ?? "");
    if (!cfg.secret || !same(given, cfg.secret)) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "X-CC-Secret missing or wrong" } });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: { code: err.code ?? (status >= 500 ? "INTERNAL" : "BAD_REQUEST"), message: err.message } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: `${req.method} ${req.url} is not a route on delivery` } }));

  app.get("/health", async () => {
    const p = await svc.providerStatus();
    return {
      ok: true as const, service: "delivery", mock: svc.providerName === "mock",
      provider: svc.providerName, liveCheckout: cfg.liveCheckout,
      doordash: svc.providerName === "mock" ? undefined : p,
    };
  });

  app.post<{ Body: any }>("/quote", async (req) => svc.quote(req.body as any));
  app.post<{ Body: any }>("/orders", async (req) => svc.createOrder(req.body as any));
  app.post<{ Params: { id: string }; Body: any }>("/orders/:id/checkout", async (req) => svc.checkout(req.params.id, req.body ?? {}));
  app.get<{ Params: { id: string } }>("/orders/:id", async (req) => svc.get(req.params.id));
  app.get<{ Querystring: { seniorId?: string } }>("/orders", async (req) => svc.list(req.query.seniorId));
  app.post<{ Params: { id: string }; Body: { to?: string } }>("/demo/advance/:id", async (req) => svc.advance(req.params.id, String(req.body?.to ?? "")));
  app.post("/demo/reset", async () => { svc.reset(); return { ok: true }; });

  return app;
}
