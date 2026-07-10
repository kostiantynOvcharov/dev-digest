import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast Radius module — the PR impact map (the Blast tab).
 *
 *   GET /pulls/:id/blast → BlastRadiusResponse (changed symbols → callers →
 *                          impacted endpoints/crons, + index status/counts)
 *
 * No LLM call — the response is read straight from the pre-built repo-intel
 * index, so no per-route rate limit is needed (unlike the intent compute route).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });
}
