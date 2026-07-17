import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DiffSummaryService } from './service.js';

/**
 * Diff Summary module — the "What this does" per-file summary on the Files
 * changed tab. Deliberately POST-only: the Smart Diff GET (`pulls/routes.ts`)
 * reads the cache this writes and fills `SmartDiffFile.pseudocode_summary`
 * when the cached entry's hash still matches the file's current patch.
 *
 *   POST /pulls/:id/smart-diff/summaries → (re)generate the cache now
 *
 * Tight per-route rate limit — every call makes an LLM request (mirrors
 * `brief`/`intent`).
 */
export default async function diffSummaryRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DiffSummaryService(app.container);

  app.post(
    '/pulls/:id/smart-diff/summaries',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id, {
        info: (msg: string) => req.log.info(msg),
      });
    },
  );
}
