import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/** POST body: the optional designated-agent whose specs seed the synthesis (D6). */
const GenerateBriefBody = z.object({
  context_agent_id: z.string().uuid().optional(),
});

/**
 * Why+Risk Brief module (SPEC-02) — read + (re)generate the PR Brief card.
 *
 *   GET  /pulls/:id/brief  → the cached BriefResponse, or null if none yet (AC-9)
 *   POST /pulls/:id/brief  → (re)generate the brief now (rate-limited, AC-16)
 *
 * Mirrors `intent/routes.ts`: Zod at the boundary, `getContext` for tenancy, and
 * a tight per-route rate limit because every POST is one LLM request. The
 * service's per-PR in-flight guard surfaces as an `AppError(409)`, mapped to
 * HTTP 409 by the global error handler.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get('/pulls/:id/brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return (await service.get(workspaceId, req.params.id)) ?? null;
  });

  // Tight per-route limit: each call makes an LLM request (mirrors intent).
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: GenerateBriefBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id, req.body.context_agent_id, {
        info: (msg: string) => req.log.info(msg),
      });
    },
  );
}
