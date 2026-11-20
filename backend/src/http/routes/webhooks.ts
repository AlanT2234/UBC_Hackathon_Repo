import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VAULT_EVENT_KINDS } from '../../events/types.js';
import type { Services } from '../../services.js';
import { requireToken } from '../auth.js';

const VaultEventSchema = z.object({
  kind: z.enum(VAULT_EVENT_KINDS),
  vault: z.string().min(32).max(44),
  signature: z.string().min(1),
  slot: z.number().int().optional(),
  at: z.number().int(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

/** The Stream filter returns `{ events: [...] }`; accept a bare array too. */
const Payload = z.union([z.object({ events: z.array(VaultEventSchema) }), z.array(VaultEventSchema)]);

/**
 * Optional chain-event webhook, built as a destination for a chain indexer (such as a QuickNode
 * Stream) that keeps `safespend_vault` transactions and decodes their Anchor events. Nothing is
 * connected in the demo; events come from the vault client. Fans out to alerts, dashboard and scheduler.
 */
export async function webhookRoutes(app: FastifyInstance, s: Services): Promise<void> {
  app.addHook('preHandler', requireToken(s.config.webhookToken, 'x-safespend-webhook-token'));

  app.post('/quicknode', async (req) => {
    const parsed = Payload.parse(req.body);
    const events = Array.isArray(parsed) ? parsed : parsed.events;
    let accepted = 0;
    for (const e of events) if (s.bus.publish(e)) accepted++;
    return { received: events.length, accepted };
  });
}
