import { and, asc, eq } from 'drizzle-orm';
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

  /** Delete a case (workspace-scoped). Returns false if not in this workspace. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }
}
