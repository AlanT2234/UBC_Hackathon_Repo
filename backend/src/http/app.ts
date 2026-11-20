import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import type { Services } from '../services.js';
import { VaultError } from '../vault/errors.js';
import { apiRoutes } from './routes/api.js';
import { toolRoutes } from './routes/tools.js';
import { webhookRoutes } from './routes/webhooks.js';

const NOT_FOUND_CODES = new Set(['VaultNotFound', 'HoldNotFound', 'PayeeNotFound']);

export function buildApp(s: Services) {
  const app = Fastify({ loggerInstance: s.log as FastifyBaseLogger });

  app.register(cors, { origin: s.config.corsOrigins.includes('*') ? true : s.config.corsOrigins });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof VaultError) {
      return reply.code(NOT_FOUND_CODES.has(err.code) ? 404 : 409).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'bad_request', issues: err.issues });
    }
    if (err instanceof RangeError) {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    req.log.error({ err }, 'request failed');
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status >= 500 ? 'internal_error' : 'bad_request' });
  });

  app.get('/health', async () => ({ ok: true, vault: s.defaultVault, scheduler: s.scheduler.pending() }));

  app.register((r) => toolRoutes(r, s), { prefix: '/tools' });
  app.register((r) => apiRoutes(r, s), { prefix: '/api' });
  app.register((r) => webhookRoutes(r, s), { prefix: '/webhooks' });

  return app;
}
