import { Brief } from '@devdigest/shared';
import type { BriefResponse, BriefStored, Intent, SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { AppError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { composeSmartDiff } from '../pulls/smart-diff.js';
import {
  buildBriefMessages,
  formatSmartDiffStats,
  groundBrief,
  type BriefInputs,
  type BriefSpecDoc,
  type BriefTitleBody,
} from './helpers.js';

/** Minimal log sink (Fastify's `req.log` satisfies this). */
export interface BriefLog {
  info(msg: string): void;
}

/**
 * Why+Risk Brief service (SPEC-02) — synthesizes ONE structured brief for a PR
 * from already-computed DETERMINISTIC inputs, grounds the model's file/line
 * citations, and caches the result per-PR in `pr_brief`.
 *
 * Mirrors `IntentService`: cross-cutting data is reached ONLY through
 * `container.*` (reviewRepo / repoIntel / agents / github / llm) — never a
 * cross-module code import (onion boundary). Spec docs are read via the
 * `container.repoIntel.readDocContent` FACADE (the within-clone path-traversal
 * guard), never `reviews/helpers.ts readDocWithinClone`.
 *
 * Error semantics: generation (`generate`) is a PRIMARY user action, so LLM /
 * config failures SURFACE (rethrow `AppError`, wrap the rest in
 * `ExternalServiceError`) and NEVER persist an empty row (AC-10). Each INPUT,
 * by contrast, is best-effort: a missing one is skipped, never failing
 * generation (AC-11).
 */
export class BriefService {
  /** Per-PR in-flight guard (X-review #1): a second concurrent generate for the
   *  same PR is rejected with a 409 instead of firing a second (expensive) LLM
   *  call. Single-node only — a Redis lock is a future multi-node upgrade. */
  private readonly inFlight = new Set<string>();

  constructor(private container: Container) {}

  private get repo() {
    return this.container.reviewRepo;
  }

  /**
   * The cached brief for a PR (workspace-scoped) as a `BriefResponse`, or `null`
   * when none is cached yet (AC-9 — an empty state, never an error). `outdated`
   * is computed server-side: the stored `head_sha` vs the PR's current head
   * (AC-8). No LLM call.
   */
  async get(workspaceId: string, prId: string): Promise<BriefResponse | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const stored = await this.repo.getBrief(prId);
    if (!stored) return null;
    return this.toResponse(stored, pull.headSha);
  }

  /**
   * (Re)generate the brief and persist it. Assembles every deterministic input
   * best-effort (missing → skipped, AC-11), makes EXACTLY ONE structured LLM
   * call, grounds the output (drops dead file/line refs, AC-6), and upserts the
   * cached row with the generation `head_sha` + observability + a reproducible
   * `inputs` snapshot (X-review #2).
   */
  async generate(
    workspaceId: string,
    prId: string,
    contextAgentId?: string,
    log?: BriefLog,
  ): Promise<BriefResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // Concurrent-generation guard (X-review #1): one in-flight generate per PR.
    if (this.inFlight.has(prId)) {
      throw new AppError('conflict', 'A brief is already being generated for this PR', 409);
    }
    this.inFlight.add(prId);
    try {
      // ---- (1) Assemble the deterministic inputs — each best-effort (AC-11) --
      const prFiles = await this.repo.getPrFiles(prId);
      const changedFiles = prFiles.map((f) => f.path);

      const intent = await this.loadIntent(prId);
      const smartDiff = this.composeSmartDiff(prFiles);
      const { summary: blastSummary, endpoints } = await this.loadBlast(
        workspaceId,
        pull.repoId,
        prId,
        changedFiles,
      );
      const linkedIssue = await this.loadLinkedIssue(pull.repoId, pull.number);
      const specs = await this.loadSpecs(pull.repoId, contextAgentId);

      const pr: BriefTitleBody | undefined = pull.title
        ? { title: pull.title, body: pull.body }
        : undefined;

      const inputs: BriefInputs = {
        ...(pr ? { pr } : {}),
        ...(intent ? { intent } : {}),
        ...(blastSummary ? { blastSummary } : {}),
        ...(smartDiff ? { smartDiff } : {}),
        ...(linkedIssue ? { linkedIssue } : {}),
        ...(specs.length ? { specs } : {}),
      };

      // Reproducibility snapshot — the deterministic inputs actually fed to the
      // model (the brief has no run-trace like reviews do). Server-only; kept in
      // `pr_brief.json`, NOT returned in `BriefResponse`. Smart-diff is reduced
      // to per-group file stats only (no diff bodies).
      const inputsSnapshot: Record<string, unknown> = {
        pr: pr ?? null,
        intent: intent ?? null,
        blast_summary: blastSummary ?? null,
        smart_diff_stats: smartDiff ? formatSmartDiffStats(smartDiff) : null,
        linked_issue: linkedIssue ?? null,
        specs: specs.map((s) => ({ path: s.path, body: s.body })),
      };

      log?.info(
        `brief: assembling inputs (intent=${!!intent}, blast=${!!blastSummary}, ` +
          `issue=${!!linkedIssue}, specs=${specs.length}, changed_files=${changedFiles.length})`,
      );

      // ---- (2) ONE structured LLM call. Config errors (missing key) surface --
      const messages = buildBriefMessages(inputs);
      const model = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
      const llm = await this.container.llm(model.provider);

      let raw: Brief;
      let costUsd: number | null = null;
      let tokensIn = 0;
      let tokensOut = 0;
      try {
        const res = await llm.completeStructured({
          model: model.model,
          schema: Brief,
          schemaName: 'Brief',
          messages,
        });
        raw = res.data;
        costUsd = res.costUsd;
        tokensIn = res.tokensIn;
        tokensOut = res.tokensOut;
      } catch (err) {
        if (err instanceof AppError) throw err; // e.g. ConfigError(missing key) — AC-10
        throw new ExternalServiceError(
          `Risk-brief model call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // ---- (3) Empty-output guard (X-review #4) -----------------------------
      // A schema-valid but empty `what`+`why` shell is treated as a FAILED
      // generation: surface an error and DO NOT overwrite a previously good
      // brief. (Empty `risks`/`review_focus` alone stays a valid "no risks"
      // brief and is NOT guarded here.)
      if (raw.what.trim() === '' && raw.why.trim() === '') {
        throw new ExternalServiceError(
          'Risk-brief generation returned an empty result (no "what"/"why")',
        );
      }

      // ---- (4) Grounding gate — drop dead file/line refs before persist -----
      const grounded = await this.ground(pull.repoId, raw, changedFiles, endpoints);

      // ---- (5) Persist the superset + return the shaped response ------------
      const stored: BriefStored = {
        what: grounded.what,
        why: grounded.why,
        risk_level: grounded.risk_level,
        risks: grounded.risks,
        review_focus: grounded.review_focus,
        head_sha: pull.headSha,
        generated_at: new Date().toISOString(),
        model: model.model,
        cost: costUsd,
        tokens: { in: tokensIn, out: tokensOut },
        inputs: inputsSnapshot,
      };
      await this.repo.upsertBrief(prId, stored);

      log?.info(
        `brief: synthesized — ${grounded.risks.length} risk(s), ` +
          `${grounded.review_focus.length} focus item(s), risk_level=${grounded.risk_level}`,
      );

      return this.toResponse(stored, pull.headSha);
    } finally {
      this.inFlight.delete(prId);
    }
  }

  // ---- input loaders (each best-effort; a failure NEVER fails generation) ----

  private async loadIntent(prId: string): Promise<Intent | undefined> {
    try {
      return await this.repo.getIntent(prId);
    } catch {
      return undefined;
    }
  }

  private composeSmartDiff(
    prFiles: { path: string; additions: number; deletions: number; patch?: string | null }[],
  ): SmartDiff | undefined {
    try {
      // No findings — the brief is built ONLY from deterministic inputs and must
      // not consume review findings (AC-12).
      return composeSmartDiff(
        prFiles.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        [],
      );
    } catch {
      return undefined;
    }
  }

  /** Blast summary (one line) + the affected-endpoint set used for grounding. */
  private async loadBlast(
    workspaceId: string,
    repoId: string,
    prId: string,
    changedFiles: string[],
  ): Promise<{ summary?: string; endpoints: Set<string> }> {
    const endpoints = new Set<string>();
    try {
      const blast = await this.container.repoIntel.getBlastRadius(repoId, changedFiles);
      for (const e of blast.impactedEndpoints) endpoints.add(e);

      const priorPrs = await this.repo
        .priorPrsTouchingFiles(workspaceId, repoId, prId, changedFiles)
        .catch(() => []);

      const uniqueEndpoints = [...endpoints];
      const hasAny =
        blast.changedSymbols.length > 0 ||
        blast.callers.length > 0 ||
        uniqueEndpoints.length > 0 ||
        priorPrs.length > 0;
      if (!hasAny) return { endpoints };

      const parts = [
        `${blast.changedSymbols.length} changed symbol(s)`,
        `${blast.callers.length} downstream caller(s)`,
        `${uniqueEndpoints.length} affected endpoint(s)`,
      ];
      if (priorPrs.length > 0) parts.push(`${priorPrs.length} prior PR(s) touched these files`);
      let summary = parts.join('; ');
      if (uniqueEndpoints.length > 0) {
        summary += `\nAffected endpoints: ${uniqueEndpoints.join(', ')}`;
      }
      return { summary, endpoints };
    } catch {
      // Unindexed / degraded repo → skip the blast section (AC-11).
      return { endpoints };
    }
  }

  private async loadLinkedIssue(
    repoId: string,
    prNumber: number,
  ): Promise<BriefTitleBody | undefined> {
    try {
      const repoRow = await this.repo.getRepo(repoId);
      if (!repoRow) return undefined;
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, prNumber);
      if (!detail.linked_issue) return undefined;
      return { title: detail.linked_issue.title, body: detail.linked_issue.body ?? null };
    } catch {
      // Offline / no token / no linkage → skip the issue section (AC-11).
      return undefined;
    }
  }

  /**
   * Designated-agent spec docs (AC-14). Resolve the merged D2 doc PATHS via the
   * SHARED `container.agents.resolveContextDocPaths` (never a re-implementation),
   * then read each within-clone via the `repoIntel.readDocContent` FACADE. An
   * unreadable / missing / traversal path is omitted; generation never fails.
   */
  private async loadSpecs(repoId: string, contextAgentId?: string): Promise<BriefSpecDoc[]> {
    if (!contextAgentId) return [];
    const specs: BriefSpecDoc[] = [];
    let paths: string[] = [];
    try {
      paths = await this.container.agents.resolveContextDocPaths(contextAgentId);
    } catch {
      return [];
    }
    for (const path of paths) {
      try {
        const body = await this.container.repoIntel.readDocContent(repoId, path);
        specs.push({ path, body });
      } catch {
        // Guard rejected / doc missing / unreadable → omit (AC-14, best-effort).
      }
    }
    return specs;
  }

  /**
   * Run the pure grounding gate (Unit 2) against the model's output. The cited
   * files are read best-effort via the `repoIntel.readDocContent` facade so the
   * gate can verify line bounds; a file that can't be read is still grounded via
   * the changed-files set (its `line`, if any, is dropped).
   */
  private async ground(
    repoId: string,
    raw: Brief,
    changedFiles: string[],
    endpoints: Set<string>,
  ): Promise<Brief> {
    const cited = new Set<string>();
    for (const risk of raw.risks) for (const ref of risk.file_refs) cited.add(ref);
    for (const item of raw.review_focus) cited.add(item.file);

    const contents = new Map<string, string>();
    for (const path of cited) {
      try {
        contents.set(path, await this.container.repoIntel.readDocContent(repoId, path));
      } catch {
        // Not readable from the clone — grounding falls back to the changed-files
        // set for this ref (line, if cited, is dropped as unverifiable).
      }
    }
    return groundBrief(raw, new Set(changedFiles), contents, endpoints);
  }

  /** Shape a stored brief into the transport `BriefResponse` (drops `inputs`). */
  private toResponse(stored: BriefStored, currentHeadSha: string): BriefResponse {
    return {
      brief: {
        what: stored.what,
        why: stored.why,
        risk_level: stored.risk_level,
        risks: stored.risks,
        review_focus: stored.review_focus,
      },
      head_sha: stored.head_sha,
      outdated: stored.head_sha !== currentHeadSha,
      generated_at: stored.generated_at,
      ...(stored.model !== undefined ? { model: stored.model } : {}),
      ...(stored.cost !== undefined ? { cost: stored.cost } : {}),
      ...(stored.tokens !== undefined ? { tokens: stored.tokens } : {}),
    };
  }
}
