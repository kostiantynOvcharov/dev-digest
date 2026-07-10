import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff, BlastRadius, Brief } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/** Intent persisted for a PR (the Intent plus the pr_id it scopes). */
export const PrIntentRecord = Intent.extend({ pr_id: z.string() });
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/** A prior PR that touched one of the changed files (blast "prior PRs"). */
export const BlastPriorPr = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  opened_at: z.string().nullable(),
  status: z.string(),
});
export type BlastPriorPr = z.infer<typeof BlastPriorPr>;

/**
 * Blast-radius response for a PR (`GET /pulls/:id/blast`): the impact map
 * (`BlastRadius`) plus the repo-intel index `status`/`degraded`/`reason` so the
 * UI can render a partial/degraded badge, top-level `counts` for the stat row,
 * and `prior_prs` (other PRs that touched the same files). Read straight from
 * the pre-built repo-intel index + the PR history — no model call.
 * `status: 'none'` means there's no usable index (→ empty state).
 */
export const BlastRadiusResponse = BlastRadius.extend({
  status: z.enum(['full', 'partial', 'degraded', 'failed', 'none']),
  degraded: z.boolean(),
  reason: z.string().nullable(),
  counts: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
  prior_prs: z.array(BlastPriorPr),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

/**
 * Why+Risk-brief response (`GET`/`POST /pulls/:id/brief`): the grounded `Brief`
 * (`null` when no brief is cached → empty state) plus the metadata the card
 * renders — `head_sha` the brief was generated against, the server-computed
 * `outdated` flag (current PR head ≠ stored `head_sha`), `generated_at`, and the
 * optional observability fields (`model`/`cost`/`tokens`) read from the LLM
 * outcome. Mirrors `BlastRadiusResponse`: a core contract + UI/observability
 * fields around it. (The server-only `inputs` snapshot is NOT part of this
 * transport shape, so `BriefStored` is not mirrored on the client.)
 */
export const BriefResponse = z.object({
  brief: Brief.nullable(),
  head_sha: z.string(),
  outdated: z.boolean(),
  generated_at: z.string(),
  model: z.string().optional(),
  cost: z.number().nullable().optional(),
  tokens: z.object({ in: z.number().int(), out: z.number().int() }).optional(),
});
export type BriefResponse = z.infer<typeof BriefResponse>;
