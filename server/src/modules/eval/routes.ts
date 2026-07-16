import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalOwnerKind } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * eval module — the regression-protection harness (L06 / SPEC-04).
 *
 *   POST   /eval-cases            {finding_id}         → create a case from a decided finding
 *   GET    /eval-cases?owner_kind&owner_id             → list an owner's cases
 *   POST   /eval-cases/:id        EvalCaseInput        → replace a case's editable fields
 *   DELETE /eval-cases/:id                             → delete a case
 *
 * Full onion module (routes → service → repository). Every handler resolves
 * tenancy with `getContext` and delegates to `EvalService`; no SQL here. The
 * run + dashboard/compare endpoints are added by later units in `run.ts` /
 * `dashboard.ts` and registered below alongside these.
 */

/** Body for "Turn into eval case": just the source finding id (the rest is derived). */
const CreateCaseFromFinding = z.object({ finding_id: z.string().uuid() });

/** Query for listing an owner's cases. */
const ListCasesQuery = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string().uuid(),
});

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);

  // ---- Create a case from a decided finding (AC-1, AC-15) -----------------
  app.post('/eval-cases', { schema: { body: CreateCaseFromFinding } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const created = await service.createCaseFromFinding(workspaceId, req.body.finding_id);
    reply.status(201);
    return created;
  });

  // ---- List an owner's cases (AC-4) ---------------------------------------
  app.get('/eval-cases', { schema: { querystring: ListCasesQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listCases(workspaceId, req.query.owner_kind, req.query.owner_id);
  });

  // ---- Update a case (studio editor scaffold; EvalCaseInput validated) -----
  app.post(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  // ---- Delete a case ------------------------------------------------------
  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok };
  });
}
