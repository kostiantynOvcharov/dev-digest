import type {
  EvalCase,
  EvalCaseInput,
  EvalDashboard,
  EvalOwnerKind,
  EvalRun,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { EvalRepository } from './repository.js';
import { EvalRunner, type RunCaseResult } from './run.js';
import {
  EvalDashboardService,
  type EvalCompare,
  type EvalRunGroupSummary,
} from './dashboard.js';
import {
  deriveEvalCase,
  dedupeCaseName,
  toEvalCaseDto,
  type EvalDecision,
} from './helpers.js';

/**
 * Eval service — orchestration for the eval-case endpoints. Owns the
 * `EvalRepository` (eval tables) and reaches cross-cutting data ONLY through the
 * composition root: findings + PR patches via `container.reviewRepo`, agent
 * config via `container.agents` — never a sibling module's repository/service
 * (onion boundary, enforced by arch:check).
 *
 * Later units extend this service (run.ts → runs, dashboard.ts → aggregates)
 * without changing the case-management methods below.
 */
export class EvalService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  /**
   * Create one eval case from a DECIDED finding (AC-1). Derives the owner agent,
   * the diff fragment (hunk + context, capped), the expected output, and the
   * guard `input_meta` from the finding + its accept/dismiss decision.
   *
   * Tenancy (AC-15): the source finding AND its owning agent must both belong to
   * the caller's workspace — otherwise not-found, and nothing is written.
   * Never logs `input_diff` (it may hold secret-shaped strings — AC / A09).
   */
  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    // Expectation type is DERIVED from the decision (D1). A pending finding has
    // no decision → the client disables the button (AC-3); guard it here too.
    const decision: EvalDecision | null = finding.acceptedAt
      ? 'accepted'
      : finding.dismissedAt
        ? 'dismissed'
        : null;
    if (!decision) {
      throw new AppError(
        'finding_not_decided',
        'Finding must be accepted or dismissed before it can become an eval case',
        400,
      );
    }

    // The case is owned by the agent that produced the finding; verify it is in
    // the caller's workspace before writing (A01 tenancy).
    const agentId = review.agentId;
    if (!agentId) throw new NotFoundError('Finding has no owning agent');
    const agent = await this.container.agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // Slice the fragment from THIS file's patch only (not every file's patch).
    const files = await this.container.reviewRepo.getPrFiles(pull.id);
    const patch = files.find((f) => f.path === finding.file)?.patch ?? null;

    const derived = deriveEvalCase(
      {
        id: finding.id,
        file: finding.file,
        startLine: finding.startLine,
        endLine: finding.endLine,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
      },
      decision,
      patch,
    );

    const existingNames = await this.repo.listCaseNamesByOwner(workspaceId, 'agent', agentId);
    const name = dedupeCaseName(`From finding: ${finding.title}`, existingNames);

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name,
      inputDiff: derived.input_diff,
      inputMeta: derived.input_meta,
      expectedOutput: derived.expected_output,
    });
    return toEvalCaseDto(row);
  }

  /**
   * Derive an eval case from a finding + an EXPLICIT decision WITHOUT persisting
   * (powers the "New eval case" modal, seeded from a finding the reviewer just
   * accepted/dismissed — before that decision has settled). Returns the same
   * `EvalCaseInput` the modal edits and later POSTs back to `/eval-cases`.
   *
   * Tenancy (AC-15): the source finding AND its owning agent must both belong to
   * the caller's workspace — otherwise not-found. Unlike `createCaseFromFinding`
   * this does NOT require the finding to already be decided (the client passes
   * the decision) and does NOT dedupe the name (dedupe happens on Save). Never
   * logs `input_diff` (A09) and writes nothing.
   */
  async seedCaseFromFinding(
    workspaceId: string,
    findingId: string,
    decision: EvalDecision,
  ): Promise<EvalCaseInput> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    const agentId = review.agentId;
    if (!agentId) throw new NotFoundError('Finding has no owning agent');
    const agent = await this.container.agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // Slice the fragment from THIS file's patch only (mirrors createCaseFromFinding).
    const files = await this.container.reviewRepo.getPrFiles(pull.id);
    const patch = files.find((f) => f.path === finding.file)?.patch ?? null;

    const derived = deriveEvalCase(
      {
        id: finding.id,
        file: finding.file,
        startLine: finding.startLine,
        endLine: finding.endLine,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
      },
      decision,
      patch,
    );

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      name: `From finding: ${finding.title}`,
      input_diff: derived.input_diff,
      input_files: null,
      input_meta: derived.input_meta,
      expected_output: derived.expected_output,
      notes: null,
    };
  }

  /**
   * Create a case from a full (possibly hand-edited) `EvalCaseInput` payload —
   * the Save path for a seeded/edited case. Both agent- and skill-owned cases are
   * supported; the owner (agent OR skill) must be in the caller's workspace
   * (AC-15), else not-found and nothing is written. The name is deduped against
   * the owner's existing cases (scoped by owner_kind + owner_id).
   */
  async createCaseFromInput(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    // Tenancy: verify the owner is in the caller's workspace before writing.
    if (input.owner_kind === 'skill') {
      const skill = await this.container.skillsRepo.getById(workspaceId, input.owner_id);
      if (!skill) throw new NotFoundError('Skill not found');
    } else {
      const agent = await this.container.agents.get(workspaceId, input.owner_id);
      if (!agent) throw new NotFoundError('Agent not found');
    }

    const existingNames = await this.repo.listCaseNamesByOwner(
      workspaceId,
      input.owner_kind,
      input.owner_id,
    );
    const name = dedupeCaseName(input.name, existingNames);

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? null,
    });
    return toEvalCaseDto(row);
  }

  /** List every case owned by `(ownerKind, ownerId)` in the workspace (AC-4). */
  async listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCase[]> {
    const rows = await this.repo.listCasesByOwner(workspaceId, ownerKind, ownerId);
    return rows.map(toEvalCaseDto);
  }

  /**
   * Replace a case's editable fields (scaffold for the studio editor).
   * `expected_output` and the rest are validated as `EvalCaseInput` at the
   * boundary before arriving here. Returns undefined when the case is not in the
   * workspace (route → 404).
   */
  async updateCase(
    workspaceId: string,
    id: string,
    input: EvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const row = await this.repo.updateCase(workspaceId, id, {
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? null,
      notes: input.notes ?? null,
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** Delete a case (workspace-scoped). False when not in this workspace. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  /**
   * Run every eval case owned by `agentId` hermetically and return the
   * `EvalRun` aggregate (AC-2/AC-5/AC-6). The heavy orchestration lives in
   * `run.ts`; this stays a thin delegator so later units can extend the module
   * without colliding here. Tenancy (AC-15) + per-case error handling (AC-16)
   * are enforced by the runner.
   */
  async runEvals(workspaceId: string, agentId: string): Promise<EvalRun> {
    return new EvalRunner(this.container).run(workspaceId, agentId);
  }

  /**
   * Run ONE case EPHEMERALLY against `agentId` and return its scored result —
   * nothing is persisted (powers the studio "Run case" button on an unsaved or
   * edited case). Tenancy (AC-15) + per-case error handling (AC-16) live in the
   * runner. Never logs `input_diff` (A09).
   */
  async runCaseOnce(
    workspaceId: string,
    agentId: string,
    input: { input_diff: string; input_meta?: unknown; expected_output: unknown },
  ): Promise<RunCaseResult> {
    return new EvalRunner(this.container).runOnce(workspaceId, agentId, input);
  }

  /**
   * Run every eval case owned by `skillId` and return the aggregate (skill-eval
   * parity with `runEvals`). The model is resolved via the workspace
   * `conformance` feature model (held constant while the skill varies); the skill
   * body is the injected rubric. Tenancy (AC-15) + per-case error handling
   * (AC-16) live in the runner. Never logs `input_diff` (A09).
   */
  async runSkillEvals(workspaceId: string, skillId: string): Promise<EvalRun> {
    return new EvalRunner(this.container).runSkill(workspaceId, skillId);
  }

  /**
   * Run ONE case EPHEMERALLY against `skillId` and return its scored result —
   * nothing is persisted (the skill-eval twin of `runCaseOnce`). Tenancy (AC-15)
   * + per-case error handling (AC-16) live in the runner. Never logs `input_diff`.
   */
  async runSkillCaseOnce(
    workspaceId: string,
    skillId: string,
    input: { input_diff: string; input_meta?: unknown; expected_output: unknown },
  ): Promise<RunCaseResult> {
    return new EvalRunner(this.container).runSkillCaseOnce(workspaceId, skillId, input);
  }

  // ---- Read-only aggregation (dashboard / history / compare — Unit 5) -------
  // Thin delegators to `EvalDashboardService`; the read-heavy aggregation +
  // regression-alert derivation live there so this file stays small.

  /**
   * Run history for an owner (agent by default, or a skill via `ownerKind`),
   * grouped by `run_group_id` (AC-11). Tenancy-checked in the dashboard service.
   */
  async getRunHistory(
    workspaceId: string,
    ownerId: string,
    ownerKind: EvalOwnerKind = 'agent',
  ): Promise<EvalRunGroupSummary[]> {
    return new EvalDashboardService(this.container).history(workspaceId, ownerId, ownerKind);
  }

  /**
   * Eval dashboard — workspace overview, or one owner's detail via `ownerId`
   * (an agent by default, or a skill via `ownerKind`) (AC-11/AC-12).
   */
  async getDashboard(
    workspaceId: string,
    ownerId?: string,
    ownerKind: EvalOwnerKind = 'agent',
  ): Promise<EvalDashboard> {
    return new EvalDashboardService(this.container).dashboard(workspaceId, ownerId, ownerKind);
  }

  /** Compare two run groups: metric deltas + both stored prompt snapshots (AC-10). */
  async compareRuns(
    workspaceId: string,
    a: string,
    b: string,
  ): Promise<EvalCompare> {
    return new EvalDashboardService(this.container).compare(workspaceId, a, b);
  }
}
