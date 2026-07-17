import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalOwnerKind } from '@devdigest/shared';

/**
 * Eval data-access. The ONLY layer touching the DB for the eval domain; owns
 * `eval_cases` (and, from later units, `eval_runs`). Every query is scoped by
 * `workspace_id` — the multi-tenancy guard — so a case can never be read or
 * written across workspaces (AC-15).
 */

/** A persisted `eval_cases` row (kept local; the eval module owns this table). */
export type EvalCaseRow = typeof t.evalCases.$inferSelect;

/** A persisted `eval_runs` row (one per case per "run all" execution). */
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

/**
 * Values for inserting one per-case `eval_runs` row. All rows of a single "run
 * all cases" execution share `runGroupId` and carry an identical
 * `agentVersion` + `systemPrompt` snapshot (AC-6). Metrics are nullable so an
 * ERRORED case can be recorded WITHOUT fabricating a passing/zero metric
 * (AC-16). `caseId` already resolves to a workspace-scoped case (the run loader
 * only ever passes cases it read under the workspace guard).
 */
export interface InsertEvalRun {
  caseId: string;
  runGroupId: string;
  agentVersion: number;
  systemPrompt: string;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
  actualOutput: unknown;
}

/** Values for inserting a new eval case (workspace-scoped by the caller). */
export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

/** Fields an update may replace (owner + workspace are immutable). */
export interface UpdateEvalCase {
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

/**
 * One "run all cases" execution collapsed to a single row: every per-case
 * `eval_runs` row sharing a `run_group_id` is aggregated in SQL. The metric
 * means are over the SCORED (non-errored, non-null) rows — mirroring the
 * runtime aggregate in `run.ts` — and `traces_total` counts ALL rows in the
 * group (errored included), so `pass_rate = traces_passed / traces_total`. The
 * `agent_version` + `system_prompt` snapshot is identical across a group's rows
 * (read via `max(...)`), so this doubles as Compare's per-group prompt source.
 */
export interface EvalRunGroupAgg {
  runGroupId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  /** Latest per-case insert time in the group (ISO), the group's `ran_at`. */
  ranAt: string;
  agentVersion: number | null;
  systemPrompt: string;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  tracesPassed: number;
  tracesTotal: number;
  costUsd: number | null;
}

/** A per-case `eval_runs` row joined to its case name (for `recent_runs`). */
export interface EvalRunRecordRow {
  id: string;
  caseId: string;
  caseName: string;
  ranAt: Date;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  runGroupId: string | null;
  agentVersion: number | null;
  systemPrompt: string | null;
}

/** Narrowing filter for the grouped/recent read queries (all workspace-scoped). */
export interface EvalRunFilter {
  ownerKind?: EvalOwnerKind;
  ownerId?: string;
  runGroupId?: string;
}

export class EvalRepository {
  constructor(private db: Db) {}

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  /** All cases owned by `(ownerKind, ownerId)` in this workspace, name-ordered. */
  async listCasesByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(asc(t.evalCases.name));
  }

  async getCaseById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /** Existing case names for an owner — used to dedupe a new case's name. */
  async listCaseNamesByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ name: t.evalCases.name })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return rows.map((r) => r.name);
  }

  async updateCase(
    workspaceId: string,
    id: string,
    values: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput ?? null,
        notes: values.notes ?? null,
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Insert one per-case eval-run row (shares `runGroupId` across the batch). */
  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        runGroupId: values.runGroupId,
        agentVersion: values.agentVersion,
        systemPrompt: values.systemPrompt,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        actualOutput: values.actualOutput ?? null,
      })
      .returning();
    return row!;
  }

  // ---- Read-only aggregation (dashboard / history / compare — Unit 5) -------
  // Every query joins `eval_runs → eval_cases` and filters by the case's
  // `workspace_id`, so a run can never be read across workspaces (AC-15). The
  // join carries `owner_kind`/`owner_id`, so an orphaned case (its agent later
  // deleted — `owner_id` is not FK-enforced) is still read gracefully rather
  // than 500ing on an agent lookup.

  /**
   * All run groups matching `filter`, aggregated in SQL and ordered by the
   * group's `ran_at` ASCENDING (oldest → newest) so the caller can take the
   * last element as "latest" and derive the delta from its predecessor.
   */
  async listRunGroups(
    workspaceId: string,
    filter: EvalRunFilter = {},
  ): Promise<EvalRunGroupAgg[]> {
    const conds = [
      eq(t.evalCases.workspaceId, workspaceId),
      isNotNull(t.evalRuns.runGroupId),
    ];
    if (filter.ownerKind) conds.push(eq(t.evalCases.ownerKind, filter.ownerKind));
    if (filter.ownerId) conds.push(eq(t.evalCases.ownerId, filter.ownerId));
    if (filter.runGroupId) conds.push(eq(t.evalRuns.runGroupId, filter.runGroupId));

    const rows = await this.db
      .select({
        runGroupId: t.evalRuns.runGroupId,
        ownerKind: t.evalCases.ownerKind,
        ownerId: t.evalCases.ownerId,
        // `avg`/`sum`/`count`/`max` are cast to concrete pg types so
        // node-postgres returns JS numbers/Date, not numeric-as-string.
        ranAt: sql<string>`max(${t.evalRuns.ranAt})`,
        agentVersion: sql<number | null>`max(${t.evalRuns.agentVersion})::int`,
        systemPrompt: sql<string | null>`max(${t.evalRuns.systemPrompt})`,
        recall: sql<number | null>`avg(${t.evalRuns.recall})::float8`,
        precision: sql<number | null>`avg(${t.evalRuns.precision})::float8`,
        citationAccuracy: sql<number | null>`avg(${t.evalRuns.citationAccuracy})::float8`,
        tracesPassed: sql<number>`count(*) filter (where ${t.evalRuns.pass})::int`,
        tracesTotal: sql<number>`count(*)::int`,
        costUsd: sql<number | null>`sum(${t.evalRuns.costUsd})::float8`,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(and(...conds))
      .groupBy(t.evalRuns.runGroupId, t.evalCases.ownerKind, t.evalCases.ownerId)
      .orderBy(sql`max(${t.evalRuns.ranAt}) asc`);

    return rows.map((r) => ({
      runGroupId: r.runGroupId!, // isNotNull guarantees non-null in the GROUP BY
      ownerKind: r.ownerKind,
      ownerId: r.ownerId,
      ranAt: new Date(r.ranAt).toISOString(),
      agentVersion: r.agentVersion ?? null,
      systemPrompt: r.systemPrompt ?? '',
      recall: r.recall ?? null,
      precision: r.precision ?? null,
      citationAccuracy: r.citationAccuracy ?? null,
      tracesPassed: r.tracesPassed ?? 0,
      tracesTotal: r.tracesTotal ?? 0,
      costUsd: r.costUsd ?? null,
    }));
  }

  /** One aggregated run group (workspace-scoped), or undefined if not found. */
  async getRunGroup(
    workspaceId: string,
    runGroupId: string,
  ): Promise<EvalRunGroupAgg | undefined> {
    const [group] = await this.listRunGroups(workspaceId, { runGroupId });
    return group;
  }

  /** Most-recent per-case run rows (with case name), newest first, capped. */
  async listRecentRuns(
    workspaceId: string,
    opts: { ownerId?: string; limit: number },
  ): Promise<EvalRunRecordRow[]> {
    const conds = [eq(t.evalCases.workspaceId, workspaceId)];
    if (opts.ownerId) conds.push(eq(t.evalCases.ownerId, opts.ownerId));
    return this.db
      .select({
        id: t.evalRuns.id,
        caseId: t.evalRuns.caseId,
        caseName: t.evalCases.name,
        ranAt: t.evalRuns.ranAt,
        actualOutput: t.evalRuns.actualOutput,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        durationMs: t.evalRuns.durationMs,
        costUsd: t.evalRuns.costUsd,
        runGroupId: t.evalRuns.runGroupId,
        agentVersion: t.evalRuns.agentVersion,
        systemPrompt: t.evalRuns.systemPrompt,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(and(...conds))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(opts.limit);
  }

  /** Count eval cases in the workspace (optionally scoped to one owner). */
  async countCases(
    workspaceId: string,
    filter: { ownerKind?: EvalOwnerKind; ownerId?: string } = {},
  ): Promise<number> {
    const conds = [eq(t.evalCases.workspaceId, workspaceId)];
    if (filter.ownerKind) conds.push(eq(t.evalCases.ownerKind, filter.ownerKind));
    if (filter.ownerId) conds.push(eq(t.evalCases.ownerId, filter.ownerId));
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(...conds));
    return row?.n ?? 0;
  }

  /** Delete a case (workspace-scoped). Returns false if not in this workspace. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }
}
