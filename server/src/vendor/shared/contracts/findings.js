import { z } from 'zod';
/**
 * Review / Findings contracts.
 * These Zod schemas are the single source of truth for:
 *  - API request/response validation,
 *  - LLM structured output (`response_format` / forced tool-use),
 *  - shared web↔api types.
 */
export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export const FindingKind = z.enum([
    'finding',
    'secret_leak',
    'lethal_trifecta',
    'phantom',
    'hook',
]);
export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export const TrifectaComponent = z.enum([
    'private_data_access',
    'untrusted_input',
    'exfil_path',
]);
export const TrifectaEvidence = z.object({
    component: TrifectaComponent,
    file: z.string(),
    line: z.number().int(),
});
/**
 * Finding — the atomic review unit. `start_line`/`end_line` are used by the
 * citation-grounding gate (must intersect a real diff hunk for diff-findings).
 */
export const Finding = z.object({
    id: z.string(),
    severity: Severity,
    category: FindingCategory,
    title: z.string(),
    file: z.string(),
    start_line: z.number().int(),
    end_line: z.number().int(),
    rationale: z.string(), // markdown
    suggestion: z.string().nullish(), // markdown
    confidence: z.number().min(0).max(1),
    kind: FindingKind.nullish(),
    // Lethal-trifecta variant fields (present only when kind === 'lethal_trifecta')
    trifecta_components: z.array(TrifectaComponent).nullish(),
    evidence: z.array(TrifectaEvidence).nullish(),
});
/** Review — the consolidated structured output of a single agent run. */
export const Review = z.object({
    verdict: Verdict,
    summary: z.string(),
    score: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe('Overall PR quality from 0 to 100, where HIGHER is better. 90–100 = no or only trivial issues (approve); 60–89 = minor suggestions; 30–59 = warnings worth addressing; 0–29 = critical problems. Must be consistent with `findings`: if there are no findings, the score is 90 or above.'),
    findings: z.array(Finding),
});
/** Action taken on a finding (accept/dismiss/learn/reply). */
export const FindingActionKind = z.enum(['accept', 'dismiss', 'learn', 'reply']);
export const FindingAction = z.object({
    action: FindingActionKind,
    reply: z.string().optional(),
});
//# sourceMappingURL=findings.js.map