import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Constant-time compare. An unset `expected` means auth is disabled (local dev). */
export function tokenMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function queryToken(req: FastifyRequest): unknown {
  return (req.query as Record<string, unknown> | undefined)?.token;
}

/** Header first, then `?token=` (EventSource and webhook URLs can't always set headers). */
export function requireToken(expected: string | undefined, header: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    let provided: unknown = req.headers[header];
    if (header === 'authorization' && typeof provided === 'string') provided = provided.replace(/^Bearer\s+/i, '');
    if (!tokenMatches(provided ?? queryToken(req), expected)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  };
}
