import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Agent,
  EvalPerTrace,
  EvalRun,
  Finding,
  FindingCategory,
  LLMProvider,
  Severity,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { EvalRepository } from './repository.js';
import { passCase, score, type ExpectedFinding } from './scoring.js';

/**
 * Per-run orchestration for the eval pipeline (SPEC-04 / L06, Unit 4).
 *
 * `POST /agents/:id/eval-runs` runs EVERY case in an agent's set HERMETICALLY
 * (D7 / AC-5): each case's stored `input_diff` + the agent's OWN
 * provider/model/system_prompt/strategy/skills only — NO repo-intel, NO Intent
 * Layer, NO feature-model call. The case diff reaches the model exclusively
 * through the reviewer-core engine's untrusted-wrapping / injection guard
 * (AC-13) — this module builds NO bypass path around the engine, and never logs
 * the `input_diff` body (A09).
 *
 * Scoring is the pure `scoring.ts` core (zero LLM — AC-8). Every case is
 * persisted as one `eval_runs` row under a single `run_group_id` carrying the
 * agent version + system-prompt snapshot (AC-6). A per-case model/config failure
 * marks that case ERRORED with a reason (surfaced in `per_trace`/`actual_output`)
 * and the run CONTINUES — never a fabricated passing/zero metric, never a bare
 * 500 (AC-16). An empty set yields an empty aggregate with ZERO LLM calls.
 */

/**
 * Tolerant parse of a case's stored `expected_output` jsonb. Only the location
 * (`file` + `[start_line, end_line]`) drives matching, so severity/category/title
 * are optional here; malformed/absent output degrades to an empty list rather
 * than crashing the whole run.
 */
const ExpectedOutputSchema = z
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
  .catch([]);

/** Tolerant parse of a case's `input_meta` — only the guard file is read here. */
const InputMetaSchema = z
  .object({ guard: z.object({ file: z.string() }).partial().optional() })
  .partial()
  .catch({});

/**
 * Turn a stored `input_diff` into a `UnifiedDiff` the engine can ground against.
 *
 * A case fragment is captured as a BARE hunk (`extractHunkFragment` strips the
 * `+++` file header, and GitHub file patches carry none), so `parseUnifiedDiff`
 * yields zero files and grounding would drop every finding. When we know the
 * guard file from `input_meta`, wrap the SAME stored fragment in a minimal
 * `diff --git`/`+++` envelope so the hunk binds to its path — this normalizes
 * the fragment, it does NOT bypass the engine's untrusted handling (the diff
 * still flows through `reviewPullRequest`'s wrapping — AC-13).
 */
function buildDiff(inputDiff: string, guardFile: string | undefined): UnifiedDiff {
  const parsed = parseUnifiedDiff(inputDiff);
  if (parsed.files.length > 0) return parsed;
  if (guardFile && /^@@ /m.test(inputDiff)) {
    const header = `diff --git a/${guardFile} b/${guardFile}\n--- a/${guardFile}\n+++ b/${guardFile}\n`;
    return parseUnifiedDiff(header + inputDiff);
  }
  return parsed;
}

/** An empty aggregate — an agent with zero cases makes ZERO LLM calls. */
function emptyAggregate(): EvalRun {
  return {
    recall: 0,
    precision: 0,
    citation_accuracy: 0,
    traces_passed: 0,
    traces_total: 0,
    duration_ms: 0,
    cost_usd: 0,
    per_trace: [],
  };
}

/** Produced findings → the compact, stored/serialized `actual_output` shape. */
function toActual(findings: readonly Finding[]) {
  return findings.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: f.title,
  }));
}

/**
 * The outcome of scoring ONE case against the agent (used by both the batch
 * `run()` and the ephemeral `runOnce()`). Metrics are nullable so an ERRORED
 * case (`pass: null`) is recorded WITHOUT a fabricated passing/zero value
 * (AC-16); a scored case always carries a boolean `pass`.
 */
export interface RunCaseResult {
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  actual_output: unknown;
  duration_ms: number;
  cost_usd: number | null;
}

/** The per-case inputs a single execution needs (agent config is passed separately). */
interface RunCaseInput {
  inputDiff: string;
  inputMeta: unknown;
  expectedOutput: unknown;
  /** Engine session id (`eval:<group>:<case>` for a batch, `eval:once:<uuid>` ephemeral). */
  sessionId: string;
}

export class EvalRunner {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  /**
   * Run every eval case owned by `agentId` and return the `EvalRun` aggregate.
   * Tenancy (AC-15): the agent must belong to the caller's workspace — otherwise
   * not-found and no LLM call is made.
   */
  async run(workspaceId: string, agentId: string): Promise<EvalRun> {
    const agent = await this.container.agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.repo.listCasesByOwner(workspaceId, 'agent', agentId);

    // Snapshot the agent's version + prompt ONCE — identical across the batch so
    // a later prompt edit never rewrites the story of this run (AC-6/AC-10).
    const runGroupId = randomUUID();
    const agentVersion = agent.version;
    const systemPrompt = agent.system_prompt;

    // Empty set → empty aggregate, ZERO LLM calls, no provider resolution.
    if (cases.length === 0) return emptyAggregate();

    // Resolve the agent's OWN provider (never a feature model — D7/AC-5).
    const llm = await this.container.llm(agent.provider);

    // Resolved skill bodies (optional): the agent's enabled, ordered linked
    // skills — same block real reviews inject. Omitted when empty so the prompt
    // is byte-identical to the no-skills baseline.
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    const skills = links
      .filter((l) => l.skill.enabled)
      .map((l) => `### ${l.skill.name}\n\n${l.skill.body}`);

    const perTrace: EvalPerTrace[] = [];
    let recallSum = 0;
    let precisionSum = 0;
    let citationSum = 0;
    let scoredCount = 0;
    let passed = 0;
    let totalDuration = 0;
    let totalCost: number | null = 0;

    for (const c of cases) {
      // Same per-case execution the ephemeral run uses (AC-16 error handling is
      // inside the helper). The batch adds persistence + aggregation around it.
      const result = await this.runOneCase(agent, llm, skills, systemPrompt, {
        inputDiff: c.inputDiff ?? '',
        inputMeta: c.inputMeta ?? {},
        expectedOutput: c.expectedOutput ?? [],
        sessionId: `eval:${runGroupId}:${c.id}`,
      });
      const errored = result.pass === null;

      const insert = this.repo.insertRun({
        caseId: c.id,
        runGroupId,
        agentVersion,
        systemPrompt,
        pass: result.pass,
        recall: result.recall,
        precision: result.precision,
        citationAccuracy: result.citation_accuracy,
        durationMs: result.duration_ms,
        costUsd: result.cost_usd,
        actualOutput: result.actual_output,
      });
      // AC-16: an errored case must still record + continue — never surface the
      // insert failure of an already-failed case as a 500.
      if (errored) await insert.catch(() => undefined);
      else await insert;

      totalDuration += result.duration_ms;
      if (!errored) {
        recallSum += result.recall!;
        precisionSum += result.precision!;
        citationSum += result.citation_accuracy!;
        scoredCount += 1;
        if (result.pass) passed += 1;
        totalCost =
          totalCost == null || result.cost_usd == null ? null : totalCost + result.cost_usd;
      }
      // An errored case is neither passed nor scored (excluded from the metric
      // mean) but still counts toward traces_total; its per_trace pass is false.
      perTrace.push({
        name: c.name,
        pass: result.pass ?? false,
        expected: c.expectedOutput ?? [],
        actual: result.actual_output,
      });
    }

    // Aggregate metrics are the mean over SCORED (non-errored) cases; all-errored
    // → 0 (no measurements) rather than a fabricated value.
    return {
      recall: scoredCount ? recallSum / scoredCount : 0,
      precision: scoredCount ? precisionSum / scoredCount : 0,
      citation_accuracy: scoredCount ? citationSum / scoredCount : 0,
      traces_passed: passed,
      traces_total: cases.length,
      duration_ms: totalDuration,
      cost_usd: totalCost,
      per_trace: perTrace,
    };
  }

  /**
   * Run ONE eval case EPHEMERALLY against `agentId` and return its result —
   * NOTHING is persisted (no `eval_runs` row, no `run_group_id`). Powers the
   * "Run case" studio button on an unsaved/edited case.
   *
   * Tenancy (AC-15): the agent must belong to the caller's workspace — otherwise
   * not-found and NO LLM call is made. A model/config failure returns an errored
   * result (AC-16), never a bare 500.
   */
  async runOnce(
    workspaceId: string,
    agentId: string,
    input: { input_diff: string; input_meta?: unknown; expected_output: unknown },
  ): Promise<RunCaseResult> {
    const agent = await this.container.agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // Same agent-owned config the batch run resolves (D7/AC-5): the agent's OWN
    // provider + enabled, ordered linked skills — never a feature model.
    const llm = await this.container.llm(agent.provider);
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    const skills = links
      .filter((l) => l.skill.enabled)
      .map((l) => `### ${l.skill.name}\n\n${l.skill.body}`);

    return this.runOneCase(agent, llm, skills, agent.system_prompt, {
      inputDiff: input.input_diff,
      inputMeta: input.input_meta ?? {},
      expectedOutput: input.expected_output,
      sessionId: `eval:once:${randomUUID()}`,
    });
  }

  /**
   * Execute ONE case against the agent + return its scored result. Shared by the
   * batch `run()` (which persists + aggregates around it) and the ephemeral
   * `runOnce()` (which does neither). HERMETIC: the diff + agent config only —
   * NO specs / intent / callers / repoMap / prDescription; the (untrusted) diff
   * reaches the model ONLY through the engine's INJECTION_GUARD wrapping (AC-13).
   * A per-case model/config failure returns an errored result (`pass: null`,
   * metrics null, `actual_output: { error }`) instead of throwing (AC-16). Never
   * logs the `input_diff` body (A09).
   */
  private async runOneCase(
    agent: Agent,
    llm: LLMProvider,
    skills: string[],
    systemPrompt: string,
    caseInput: RunCaseInput,
  ): Promise<RunCaseResult> {
    const parsedExpected = ExpectedOutputSchema.parse(caseInput.expectedOutput ?? []);
    const guardFile = InputMetaSchema.parse(caseInput.inputMeta ?? {}).guard?.file;
    const start = Date.now();
    try {
      const diff = buildDiff(caseInput.inputDiff ?? '', guardFile);
      const outcome = await reviewPullRequest({
        systemPrompt,
        model: agent.model,
        diff,
        llm,
        strategy: agent.strategy,
        ...(skills.length ? { skills } : {}),
        sessionId: caseInput.sessionId,
      });
      const durationMs = Date.now() - start;

      // `kept` (post-grounding) is authoritative — grounding-exempt kinds are
      // already inside `kept`, so we do NOT re-ground (spec / AC-6).
      const produced = outcome.review.findings;
      const expected = coerceExpected(parsedExpected);
      const scores = score(produced, expected, produced.length, outcome.dropped.length);
      const pass = passCase(produced, expected);
      const actual = toActual(produced);

      return {
        pass,
        recall: scores.recall,
        precision: scores.precision,
        citation_accuracy: scores.citation_accuracy,
        actual_output: actual,
        duration_ms: durationMs,
        cost_usd: outcome.costUsd,
      };
    } catch (err) {
      // AC-16: the model/config failed for THIS case — return it errored WITH a
      // reason. NEVER a fabricated passing/zero metric, NEVER a thrown 500.
      const durationMs = Date.now() - start;
      const reason = err instanceof Error ? err.message : 'unknown error';
      return {
        pass: null,
        recall: null,
        precision: null,
        citation_accuracy: null,
        actual_output: { error: reason },
        duration_ms: durationMs,
        cost_usd: null,
      };
    }
  }
}

/**
 * Coerce a tolerantly-parsed expected list into the scoring `ExpectedFinding`
 * shape. Only the location is read by the matcher, so severity/category/title
 * are filled with harmless placeholders when the stored JSON omits them.
 */
function coerceExpected(
  parsed: readonly {
    file: string;
    start_line: number;
    end_line: number;
    severity?: string;
    category?: string;
    title?: string;
  }[],
): ExpectedFinding[] {
  return parsed.map((e) => ({
    file: e.file,
    start_line: e.start_line,
    end_line: e.end_line,
    severity: (e.severity ?? 'WARNING') as Severity,
    category: (e.category ?? 'bug') as FindingCategory,
    title: e.title ?? '',
  }));
}
