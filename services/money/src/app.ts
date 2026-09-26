import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { ApiError } from './errors';
import type { MoneyService } from './service';
import { parseOrderRequest } from './validate';

export interface AppOptions {
  service: MoneyService;
  mock: boolean;
  secret?: string;
  evalResultsPath: string;
  logger?: boolean;
}

export function buildApp(o: AppOptions): FastifyInstance {
  const app = Fastify({ logger: o.logger ?? false });

  // CONTRACTS §0: X-CC-Secret on every internal call. /health stays open.
  app.addHook('onRequest', async (req, reply) => {
    if (!o.secret || req.url === '/health') return;
    if (req.headers['x-cc-secret'] !== o.secret) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or wrong X-CC-Secret' } });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number; code?: string };
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    const code = e instanceof ApiError ? e.code : status < 500 && e.code ? String(e.code) : status < 500 ? 'BAD_REQUEST' : 'INTERNAL';
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: { code, message: status >= 500 && !(e instanceof ApiError) ? 'Internal error' : e.message } });
  });

  const seniorQuery = (q: unknown) => {
    const s = (q as { seniorId?: string })?.seniorId;
    if (!s) throw new ApiError(400, 'BAD_REQUEST', 'seniorId query param is required');
    return s;
  };

  app.get('/health', async () => ({ ok: true, service: 'money', mock: o.mock }));

  app.post('/demo/reset', async () => {
    if (!o.secret) throw new ApiError(503, 'SECRET_REQUIRED', 'Configure the internal secret');
    return o.service.reset();
  });
  app.post('/webhooks/delivery-status', async (req) => {
    if (!o.secret) throw new ApiError(503, 'SECRET_REQUIRED', 'Configure the internal secret');
    return o.service.deliveryStatus(req.body);
  });
  app.post('/fraud/assess', async (req) => o.service.assess(parseOrderRequest(req.body)));
  app.post('/orders/draft', async (req) => o.service.draft(parseOrderRequest(req.body)));
  app.post<{ Params: { id: string } }>('/orders/:id/confirm', async (req) => o.service.confirm(req.params.id));
  app.post<{ Params: { id: string } }>('/holds/:id/resolve', async (req) => o.service.resolveHold(req.params.id, req.body));
  app.get('/holds', async (req) => o.service.listHolds(seniorQuery(req.query)));
  app.get<{ Params: { id: string } }>('/orders/:id', async (req) => o.service.getOrder(req.params.id));
  app.get('/orders', async (req) => o.service.listOrders(seniorQuery(req.query)));
  app.get<{ Params: { seniorId: string } }>('/credentials/:seniorId', async (req) => o.service.credentials(req.params.seniorId));

  app.get('/eval/results', async (_req, reply) => {
    try {
      return JSON.parse(await readFile(o.evalResultsPath, 'utf8'));
    } catch {
      return reply.code(404).send({ error: { code: 'NO_EVAL_RESULTS', message: 'Run `pnpm eval` first' } });
    }
  });

  return app;
}
