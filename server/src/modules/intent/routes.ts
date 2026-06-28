import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * Intent Layer module — derive + read a PR's motivation/scope (the Intent card).
 *
 *   GET  /pulls/:id/intent          → the stored Intent, or null if not computed yet
 *   POST /pulls/:id/intent/compute  → (re)compute the intent now and return it
 *
 * The review flow generates intent on demand (IntentService.generateIfMissing);
 * the compute route is the explicit Recompute/Generate button.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return (await service.get(workspaceId, req.params.id)) ?? null;
  });

  // Tight per-route limit: each call makes an LLM request.
  app.post(
    '/pulls/:id/intent/compute',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.compute(workspaceId, req.params.id);
    },
  );
}
