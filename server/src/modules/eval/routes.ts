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
 *   POST   /agents/:id/eval-runs                       → run all of an agent's cases (hermetic)
 *   GET    /agents/:id/eval-runs                       → run history grouped by run_group_id
 *   GET    /eval-dashboard?owner_id                    → dashboard (workspace / per-agent)
 *   GET    /eval-runs/compare?a&b                      → two run groups: deltas + prompts
 *
 * Full onion module (routes → service → repository). Every handler resolves
 * tenancy with `getContext` and delegates to `EvalService`; no SQL here. The
 * read-only aggregation for the last three routes lives in `dashboard.ts`.
 */

/** Body for "Turn into eval case": just the source finding id (the rest is derived). */
const CreateCaseFromFinding = z.object({ finding_id: z.string().uuid() });

/** Query for listing an owner's cases. */
const ListCasesQuery = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string().uuid(),
});

/** Query for the dashboard: optional per-agent detail via `owner_id`. */
const DashboardQuery = z.object({ owner_id: z.string().uuid().optional() });

/** Query for comparing two run groups (each a `run_group_id`). */
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

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

  // ---- Run all of an agent's cases hermetically (AC-2/AC-5/AC-6/AC-16) -----
  // Tenancy (AC-15) is enforced in the service: an agent outside the caller's
  // workspace → 404 before any LLM call. A per-case model/config failure is
  // recorded errored and the run continues (AC-16) — never a bare 500.
  app.post('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runEvals(workspaceId, req.params.id);
  });

  // ---- Run history for an agent, grouped by run_group_id (AC-11, AC-15) -----
  // Tenancy at the boundary: workspaceId from getContext; the service 404s an
  // agent outside the workspace (or a deleted one) — never a 500.
  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getRunHistory(workspaceId, req.params.id);
  });

  // ---- Eval dashboard: workspace overview, or per-agent detail (AC-11/AC-12) -
  app.get('/eval-dashboard', { schema: { querystring: DashboardQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getDashboard(workspaceId, req.query.owner_id);
  });

  // ---- Compare two run groups: deltas + stored prompt snapshots (AC-10) -----
  app.get('/eval-runs/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.compareRuns(workspaceId, req.query.a, req.query.b);
  });
}
