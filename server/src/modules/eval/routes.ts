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
 *   POST   /eval-cases            {finding_id} | EvalCaseInput → create a case (from finding OR payload)
 *   GET    /eval-cases/seed?finding_id&decision       → derive a case from a finding (NO persist)
 *   GET    /eval-cases?owner_kind&owner_id             → list an owner's cases
 *   POST   /eval-cases/:id        EvalCaseInput        → replace a case's editable fields
 *   DELETE /eval-cases/:id                             → delete a case
 *   POST   /agents/:id/eval-runs                       → run all of an agent's cases (hermetic)
 *   POST   /agents/:id/eval-run-case  EvalRunCaseInput → run ONE case ephemerally (NO persist)
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

/** Query for seeding the "New eval case" modal from a finding + explicit decision (no persist). */
const SeedCaseQuery = z.object({
  finding_id: z.string().uuid(),
  decision: z.enum(['accepted', 'dismissed']),
});

/**
 * Body for the ephemeral single-case run ("Run case"): the same editable fields
 * a case carries. `expected_output` is tolerantly parsed (a malformed list
 * degrades to `[]` rather than 400ing an interactive editor).
 */
const EvalRunCaseInput = z.object({
  input_diff: z.string(),
  input_files: z.unknown().optional(),
  input_meta: z.unknown().optional(),
  expected_output: z
    .array(
      z.object({
        file: z.string(),
        start_line: z.number(),
        end_line: z.number(),
        severity: z.string().optional(),
        category: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .catch([]),
});

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

  // ---- Create a case: from a decided finding OR a full payload (AC-1, AC-15) -
  // The body is EITHER {finding_id} (derive everything from the finding) OR a
  // full EvalCaseInput (Save a seeded/edited case). Both are tenancy-scoped.
  app.post(
    '/eval-cases',
    { schema: { body: z.union([CreateCaseFromFinding, EvalCaseInput]) } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created =
        'finding_id' in req.body
          ? await service.createCaseFromFinding(workspaceId, req.body.finding_id)
          : await service.createCaseFromInput(workspaceId, req.body);
      reply.status(201);
      return created;
    },
  );

  // ---- Seed a case from a finding + explicit decision — NO persist (AC-15) ---
  // Static path declared before the `/eval-cases/:id` routes for tidiness. The
  // client passes the decision (it may not be persisted yet); nothing is written.
  app.get('/eval-cases/seed', { schema: { querystring: SeedCaseQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.seedCaseFromFinding(workspaceId, req.query.finding_id, req.query.decision);
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

  // ---- Run ONE case ephemerally — persists NOTHING (AC-15/AC-16) -----------
  // For the studio "Run case" button on an unsaved/edited case: hermetic single
  // execution, no eval_runs row. A model/config failure returns an errored
  // result (200), never a bare 500. Tenancy enforced in the service (agent
  // outside the workspace → 404 before any LLM call).
  app.post('/agents/:id/eval-run-case', { schema: { params: IdParams, body: EvalRunCaseInput } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runCaseOnce(workspaceId, req.params.id, req.body);
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
