import { z } from 'zod';
/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */
// ---- Intent ----
export const Intent = z.object({
    intent: z.string(),
    in_scope: z.array(z.string()),
    out_of_scope: z.array(z.string()),
});
// ---- Blast radius ----
export const ChangedSymbol = z.object({
    name: z.string(),
    file: z.string(),
    kind: z.string(),
});
export const BlastCaller = z.object({
    name: z.string(),
    file: z.string(),
    line: z.number().int(),
});
export const DownstreamImpact = z.object({
    symbol: z.string(),
    callers: z.array(BlastCaller),
    endpoints_affected: z.array(z.string()),
    crons_affected: z.array(z.string()),
});
export const BlastRadius = z.object({
    changed_symbols: z.array(ChangedSymbol),
    downstream: z.array(DownstreamImpact),
    summary: z.string(),
});
// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export const Risk = z.object({
    kind: z.string(),
    title: z.string(),
    explanation: z.string(),
    severity: RiskSeverity,
    file_refs: z.array(z.string()),
});
export const Risks = z.object({
    risks: z.array(Risk),
});
// ---- Why+Risk Brief (SPEC-02 synthesis) -----------------------------------
// NOTE: this is a DIFFERENT contract from the composed `PrBrief` below (D1).
// `Brief` is the ONE-LLM-call synthesis persisted in `pr_brief.json`; Intent
// and Blast Radius stay separate INPUT cards, not fields of the brief.
/** One "read this first" location, most-important-first in `Brief.review_focus`. */
export const ReviewFocusItem = z.object({
    file: z.string(),
    line: z.number().int().optional(),
    reason: z.string(),
});
/** The synthesized Why+Risk brief for a PR (reuses `RiskSeverity` + `Risk`). */
export const Brief = z.object({
    what: z.string(),
    why: z.string(),
    risk_level: RiskSeverity,
    risks: z.array(Risk),
    review_focus: z.array(ReviewFocusItem),
});
// ---- PR History ----
export const PrHistoryItem = z.object({
    pr_number: z.number().int(),
    title: z.string(),
    merged_at: z.string(),
    author: z.string(),
    files_overlap: z.array(z.string()),
    notes: z.string(),
});
export const PrHistory = z.object({
    history: z.array(PrHistoryItem),
});
// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export const SmartDiffFile = z.object({
    path: z.string(),
    pseudocode_summary: z.string().nullish(),
    additions: z.number().int(),
    deletions: z.number().int(),
    finding_lines: z.array(z.number().int()),
});
export const SmartDiffGroup = z.object({
    role: SmartDiffRole,
    files: z.array(SmartDiffFile),
});
export const ProposedSplit = z.object({
    name: z.string(),
    files: z.array(z.string()),
});
export const SmartDiff = z.object({
    groups: z.array(SmartDiffGroup),
    split_suggestion: z.object({
        too_big: z.boolean(),
        total_lines: z.number().int(),
        proposed_splits: z.array(ProposedSplit),
    }),
});
// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
    intent: Intent,
    blast: BlastRadius,
    risks: Risks,
    history: PrHistory,
});
//# sourceMappingURL=brief.js.map