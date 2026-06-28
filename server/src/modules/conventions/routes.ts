import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module — scan a repo for house-convention candidates, verify each
 * candidate's evidence in code (grounding gate), let the user accept/reject/edit,
 * and merge the accepted ones into a draft skill body.
 *
 *   POST /repos/:id/conventions/extract       → run extraction (sync), return candidates
 *   GET  /repos/:id/conventions               → list persisted candidates
 *   PATCH /conventions/:id                     → accept/reject/edit one candidate
 *   POST /repos/:id/conventions/skill-draft    → compose (NO persist) a merged skill draft
 */

const UpdateConventionBody = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  rule: z.string().min(1).optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention candidate not found');
      return updated;
    },
  );

  app.post(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillDraft(workspaceId, req.params.id);
    },
  );
}
