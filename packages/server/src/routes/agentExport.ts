import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { buildAgentExport } from '../insights/agentExport.js';

/** Constant-time bearer-token check against FINANCE_READ_TOKEN. */
function authorized(authHeader: string | undefined): boolean {
  const expected = config.readToken;
  if (!expected) return false; // not configured => nobody is authorized
  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
  if (!m) return false;
  // Hash both to a fixed length so the comparison is constant-time and doesn't
  // leak the token length.
  const provided = createHash('sha256').update(m[1]!).digest();
  const wanted = createHash('sha256').update(expected).digest();
  return timingSafeEqual(provided, wanted);
}

export async function agentExportRoutes(app: FastifyInstance): Promise<void> {
  // Read-only export for an external AI agent. No write behavior.
  app.get('/api/export.json', async (req, reply) => {
    if (!authorized(req.headers['authorization'] as string | undefined)) {
      reply.header('www-authenticate', 'Bearer');
      reply.code(401).type('application/json');
      return { error: 'unauthorized' };
    }
    reply.type('application/json; charset=utf-8');
    return buildAgentExport(new Date().toISOString().slice(0, 10));
  });
}
