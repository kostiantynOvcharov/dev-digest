import { z } from 'zod';
/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */
// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export const ConformanceItem = z.object({
    requirement: z.string(),
    status: ConformanceStatus,
    evidence_file: z.string().nullish(),
    notes: z.string().nullish(),
});
export const Conformance = z.object({
    spec_id: z.string(),
    spec_title: z.string(),
    items: z.array(ConformanceItem),
    completeness_pct: z.number().min(0).max(100),
});
// ---- Onboarding ----
export const OnboardingLink = z.object({
    label: z.string(),
    path: z.string(),
});
export const OnboardingSection = z.object({
    kind: z.string(),
    title: z.string(),
    body: z.string(), // markdown
    diagram: z.string().nullish(), // mermaid
    links: z.array(OnboardingLink),
});
export const Onboarding = z.object({
    sections: z.array(OnboardingSection),
});
// ---- Eval ----
export const EvalPerTrace = z.object({
    name: z.string(),
    pass: z.boolean(),
    expected: z.unknown(),
    actual: z.unknown(),
});
export const EvalRun = z.object({
    recall: z.number().min(0).max(1),
    precision: z.number().min(0).max(1),
    citation_accuracy: z.number().min(0).max(1),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    duration_ms: z.number().int(),
    cost_usd: z.number().nullable(),
    per_trace: z.array(EvalPerTrace),
});
export const EvalOwnerKind = z.enum(['skill', 'agent']);
export const EvalCase = z.object({
    id: z.string(),
    owner_kind: EvalOwnerKind,
    owner_id: z.string(),
    name: z.string(),
    input_diff: z.string(),
    input_files: z.unknown(),
    input_meta: z.unknown(),
    expected_output: z.unknown(),
    notes: z.string().nullish(),
});
// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export const MemoryKind = z.enum([
    'decision',
    'convention',
    'preference',
    'fact',
    'learning',
]);
export const MemorySource = z.object({
    pr: z.number().int().nullish(),
    context: z.string(),
});
export const MemoryItem = z.object({
    content: z.string(),
    scope: MemoryScope,
    kind: MemoryKind,
    confidence: z.number().min(0).max(1),
    sources: z.array(MemorySource),
});
// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export const SkillSource = z.enum([
    'manual',
    'imported_url',
    'imported_file',
    'extracted',
    'community',
]);
export const Skill = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: SkillType,
    source: SkillSource,
    body: z.string(),
    enabled: z.boolean(),
    version: z.number().int(),
    evidence_files: z.array(z.string()).nullish(),
});
export const CommunitySkill = z.object({
    name: z.string(),
    repo: z.string(),
    stars: z.number().int(),
    lang: z.string(),
    desc: z.string(),
});
// An immutable body snapshot captured in `skill_versions` whenever a skill's
// body changes. Mirrors agent versioning (reproducibility + edit history): a
// run trace records which skill bodies were in the prompt at run time.
export const SkillVersion = z.object({
    skill_id: z.string(),
    version: z.number().int(),
    body: z.string(),
    created_at: z.string(),
});
// One archive entry the importer DID NOT process. Skills are text + config only;
// the importer extracts the markdown core and lists everything else (scripts,
// binaries, assets) here so the UI can show — but never run — what was skipped.
export const SkillImportIgnored = z.object({
    path: z.string(),
    size: z.number().int(),
    reason: z.string(),
});
// The result of parsing an uploaded .md/.zip WITHOUT persisting it. The client
// shows this as a preview; the skill is created only after the user confirms
// (a plain POST /skills with source 'imported_file', enabled false until vetted).
export const SkillImportPreview = z.object({
    name: z.string(),
    description: z.string(),
    type: SkillType,
    source: SkillSource,
    body: z.string(),
    ignored_files: z.array(SkillImportIgnored),
});
// ---- Conventions ----
export const ConventionCandidate = z.object({
    id: z.string(),
    rule: z.string(),
    evidence_path: z.string(),
    evidence_snippet: z.string(),
    confidence: z.number().min(0).max(1),
    accepted: z.boolean(),
});
// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export const Agent = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    provider: Provider,
    model: z.string(),
    system_prompt: z.string(),
    output_schema: z.unknown().nullish(),
    enabled: z.boolean(),
    version: z.number().int(),
    strategy: ReviewStrategy.default('single-pass'),
    ci_fail_on: CiFailOn.default('critical'),
    // Inject repo-intel context (repo skeleton + callers + rank note) into this
    // agent's review prompt. Default on; gated again by the global flag.
    repo_intel: z.boolean().default(true),
});
export const AgentSkillLink = z.object({
    agent_id: z.string(),
    skill_id: z.string(),
    order: z.number().int(),
});
// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
    provider: Provider,
    model: z.string(),
    system_prompt: z.string(),
    output_schema: z.unknown().nullish(),
    strategy: ReviewStrategy,
    ci_fail_on: CiFailOn,
    repo_intel: z.boolean(),
    skills: z.array(z.string()),
});
export const AgentVersion = z.object({
    agent_id: z.string(),
    version: z.number().int(),
    config: AgentVersionConfig,
    created_at: z.string(),
});
//# sourceMappingURL=knowledge.js.map