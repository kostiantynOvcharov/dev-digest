import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ProjectContextService } from './service.js';

/** Query for the doc-content read: a required repo-relative path. Validation +
 * the resolve-within-clone guard (in the facade) together reject traversal. */
const DocContentQuery = z.object({ path: z.string().min(1) });

/**
 * Project Context module (SPEC-01) — the Project Context page's read API for a
 * repo's discovered markdown docs.
 *
 *   GET  /repos/:id/context/docs         → DiscoveredDoc[] (path, badge, size, used-by)
 *   GET  /repos/:id/context/docs/content → DocContent (guarded markdown read, AC-5)
 *   GET  /repos/:id/context/index-state  → files count + last-indexed (NO chunks, D8)
 *   POST /repos/:id/context/reindex      → synchronous rescan → new index status
 *
 * No LLM call — discovery is a deterministic fs walk via the repo-intel facade.
 * Tenancy is enforced in the service (workspace-scoped repo lookup).
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  app.get('/repos/:id/context/docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listDocs(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/context/docs/content',
    { schema: { params: IdParams, querystring: DocContentQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDocContent(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get('/repos/:id/context/index-state', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getIndexState(workspaceId, req.params.id);
  });

  app.post('/repos/:id/context/reindex', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.reindex(workspaceId, req.params.id);
  });
}
