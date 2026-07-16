import type {
  EvalDashboard,
  EvalOwnerKind,
  EvalRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  EvalRepository,
  type EvalRunGroupAgg,
  type EvalRunRecordRow,
} from './repository.js';

/**
 * Read-only aggregation for the eval pipeline (SPEC-04 / L06, Unit 5):
 * history, dashboard, and compare. NO LLM, NO writes — it only reads persisted
 * `eval_runs` (aggregated per `run_group_id` in SQL by the repository) and
 * derives the deltas + the regression alert. All reads are workspace-scoped by
 * the repository join (AC-15); the run-group / latest resolution is done in SQL,
 * this layer only shapes the DTOs and derives the alert (AC-10/AC-11/AC-12).
 *
 * The heavy logic lives here (not in `run.ts`) so the two units never collide.
 */

/** How many recent per-case run rows the dashboard lists. */
const RECENT_RUNS_LIMIT = 20;

/** A single run group flattened for history + the Compare view. */
export interface EvalRunGroupSummary {
  run_group_id: string;
  ran_at: string;
  agent_version: number;
  recall: number;
  precision: number;
  citation_accuracy: number;
  cost_usd: number | null;
  traces_passed: number;
  traces_total: number;
  system_prompt: string;
}

/** Compare two run groups: four metric deltas + the two STORED prompt snapshots. */
export interface EvalCompare {
  a: EvalRunGroupSummary;
  b: EvalRunGroupSummary;
  /** old→new deltas (b − a). `cost_usd` null when either side has no cost. */
  delta: {
    recall: number;
    precision: number;
    citation_accuracy: number;
    cost_usd: number | null;
  };
  system_prompt_a: string;
  system_prompt_b: string;
}

/** An aggregated group → the flat summary DTO (history / compare sides). */
function toGroupSummary(g: EvalRunGroupAgg): EvalRunGroupSummary {
  return {
    run_group_id: g.runGroupId,
    ran_at: g.ranAt,
    agent_version: g.agentVersion ?? 0,
    recall: g.recall ?? 0,
    precision: g.precision ?? 0,
    citation_accuracy: g.citationAccuracy ?? 0,
    cost_usd: g.costUsd,
    traces_passed: g.tracesPassed,
    traces_total: g.tracesTotal,
    system_prompt: g.systemPrompt,
  };
}

/** An aggregated group → one chronological trend point. */
function toTrendPoint(g: EvalRunGroupAgg): EvalTrendPoint {
  return {
    ran_at: g.ranAt,
    recall: g.recall ?? 0,
    precision: g.precision ?? 0,
    citation_accuracy: g.citationAccuracy ?? 0,
    pass_rate: g.tracesTotal ? g.tracesPassed / g.tracesTotal : 0,
    cost_usd: g.costUsd,
  };
}

/** A persisted per-case row → the `EvalRunRecord` API shape. */
function toRunRecord(row: EvalRunRecordRow): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput ?? null,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    // Legacy rows predating Unit 1 have NULL group/version/prompt; coerce so the
    // contract (non-null) still parses. Rows written by `run.ts` always set them.
    run_group_id: row.runGroupId ?? '',
    agent_version: row.agentVersion ?? 0,
    system_prompt: row.systemPrompt ?? '',
  };
}

/**
 * Regression alert (AC-12): a non-null string WHEN the latest precision dropped
 * versus the previous run for the owner, else null. Derived purely from the two
 * STORED precisions — never time-inferred. Exported for direct unit coverage.
 */
export function regressionAlert(
  previousPrecision: number | null | undefined,
  currentPrecision: number | null | undefined,
): string | null {
  if (previousPrecision == null || currentPrecision == null) return null;
  if (currentPrecision >= previousPrecision) return null;
  const pts = Math.max(1, Math.round((previousPrecision - currentPrecision) * 100));
  return `Precision dipped ${pts}pts — a new false positive slipped in`;
}

/** The zeroed `current` block for an owner/workspace with no runs yet. */
function emptyCurrent(): EvalDashboard['current'] {
  return {
    recall: 0,
    precision: 0,
    citation_accuracy: 0,
    traces_passed: 0,
    traces_total: 0,
    cost_usd: null,
  };
}

export class EvalDashboardService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  /**
   * Run history for one agent, grouped by `run_group_id`, newest first (AC-11).
   * Tenancy-checked: the agent must belong to the workspace, else not-found —
   * a deleted agent yields a graceful 404, never a 500.
   */
  async history(workspaceId: string, agentId: string): Promise<EvalRunGroupSummary[]> {
    const agent = await this.container.agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const groups = await this.repo.listRunGroups(workspaceId, {
      ownerKind: 'agent',
      ownerId: agentId,
    });
    // Repository returns ASC (oldest → newest); history reads newest first.
    return groups.map(toGroupSummary).reverse();
  }

  /**
   * The eval dashboard (AC-11/AC-12). With `ownerId` → that agent's detail;
   * without → a workspace overview whose `current`/`delta`/`trend`/`alert` track
   * the most recently-run owner while `recent_runs` spans ALL agents. Every read
   * is workspace-scoped, so a foreign/deleted owner_id simply yields empty data.
   */
  async dashboard(workspaceId: string, ownerId?: string): Promise<EvalDashboard> {
    if (ownerId) {
      const [groups, recent, casesTotal] = await Promise.all([
        this.repo.listRunGroups(workspaceId, { ownerKind: 'agent', ownerId }),
        this.repo.listRecentRuns(workspaceId, { ownerId, limit: RECENT_RUNS_LIMIT }),
        this.repo.countCases(workspaceId, { ownerKind: 'agent', ownerId }),
      ]);
      return this.build(groups, recent, casesTotal, 'agent', ownerId);
    }

    const [allGroups, recent, casesTotal] = await Promise.all([
      this.repo.listRunGroups(workspaceId),
      this.repo.listRecentRuns(workspaceId, { limit: RECENT_RUNS_LIMIT }),
      this.repo.countCases(workspaceId),
    ]);
    // Focus the headline metrics on the most recently-run owner so current /
    // delta / alert stay coherent; `recent_runs` still spans every agent.
    const latest = allGroups[allGroups.length - 1];
    const ownerGroups = latest
      ? allGroups.filter(
          (g) => g.ownerKind === latest.ownerKind && g.ownerId === latest.ownerId,
        )
      : [];
    return this.build(ownerGroups, recent, casesTotal, null, null);
  }

  /**
   * Compare two run groups (AC-10): the four metric deltas (recall / precision /
   * citation / cost, old→new) plus BOTH stored `system_prompt` snapshots. The
   * prompt diff the client renders is built from these snapshots — never
   * time-inferred. A group not in the workspace resolves to undefined → 404.
   */
  async compare(workspaceId: string, aId: string, bId: string): Promise<EvalCompare> {
    const [a, b] = await Promise.all([
      this.repo.getRunGroup(workspaceId, aId),
      this.repo.getRunGroup(workspaceId, bId),
    ]);
    if (!a || !b) throw new NotFoundError('Run group not found');

    return {
      a: toGroupSummary(a),
      b: toGroupSummary(b),
      delta: {
        recall: (b.recall ?? 0) - (a.recall ?? 0),
        precision: (b.precision ?? 0) - (a.precision ?? 0),
        citation_accuracy: (b.citationAccuracy ?? 0) - (a.citationAccuracy ?? 0),
        cost_usd:
          a.costUsd != null && b.costUsd != null ? b.costUsd - a.costUsd : null,
      },
      system_prompt_a: a.systemPrompt,
      system_prompt_b: b.systemPrompt,
    };
  }

  /** Assemble an `EvalDashboard` from an owner's ASC-ordered run groups. */
  private build(
    groups: EvalRunGroupAgg[],
    recent: EvalRunRecordRow[],
    casesTotal: number,
    ownerKind: EvalOwnerKind | null,
    ownerId: string | null,
  ): EvalDashboard {
    const current = groups[groups.length - 1];
    const previous = groups[groups.length - 2];

    return {
      owner_kind: ownerKind,
      owner_id: ownerId,
      cases_total: casesTotal,
      current: current
        ? {
            recall: current.recall ?? 0,
            precision: current.precision ?? 0,
            citation_accuracy: current.citationAccuracy ?? 0,
            traces_passed: current.tracesPassed,
            traces_total: current.tracesTotal,
            cost_usd: current.costUsd,
          }
        : emptyCurrent(),
      delta:
        current && previous
          ? {
              recall: (current.recall ?? 0) - (previous.recall ?? 0),
              precision: (current.precision ?? 0) - (previous.precision ?? 0),
              citation_accuracy:
                (current.citationAccuracy ?? 0) - (previous.citationAccuracy ?? 0),
            }
          : { recall: 0, precision: 0, citation_accuracy: 0 },
      trend: groups.map(toTrendPoint),
      recent_runs: recent.map(toRunRecord),
      alert: regressionAlert(previous?.precision, current?.precision),
    };
  }
}
