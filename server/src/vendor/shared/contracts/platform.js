import { z } from 'zod';
import { Provider } from './knowledge.js';
/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */
// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
    'onboarding',
    'review_intent',
    'risk_brief',
    'conformance',
    'conventions',
    'diff_summary',
]);
/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
    provider: Provider,
    model: z.string().min(1),
});
export const FEATURE_MODELS = [
    {
        id: 'onboarding',
        label: 'Onboarding Tour',
        description: 'Writes the per-repo onboarding tour.',
        defaultProvider: 'openrouter',
        defaultModel: 'deepseek/deepseek-v4-flash',
    },
    {
        id: 'review_intent',
        label: 'PR Review · Intent',
        description: 'Derives a PR’s intent and scope before review.',
        defaultProvider: 'openrouter',
        defaultModel: 'deepseek/deepseek-chat',
    },
    {
        id: 'risk_brief',
        label: 'Risk Brief',
        description: 'Assesses merge risks for a pull request.',
        defaultProvider: 'openai',
        defaultModel: 'gpt-4.1',
    },
    {
        id: 'conformance',
        label: 'Conformance',
        description: 'Checks a PR against the project spec.',
        defaultProvider: 'openai',
        defaultModel: 'gpt-4.1',
    },
    {
        id: 'conventions',
        label: 'Conventions',
        description: 'Extracts coding conventions from the repo.',
        defaultProvider: 'openai',
        defaultModel: 'gpt-5.4',
    },
    {
        id: 'diff_summary',
        label: 'Diff Summary',
        description: 'Summarizes what each changed file does.',
        defaultProvider: 'openrouter',
        defaultModel: 'deepseek/deepseek-chat',
    },
];
// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
    polling_interval_min: z.number().int().min(1).default(5),
    theme: z.enum(['dark', 'light']).default('dark'),
    density: z.enum(['regular', 'compact']).default('regular'),
    sync_to_folder: z.boolean().default(true),
    automatic_reviews: z.boolean().default(false),
    /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
    feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
    /** Project Context (SPEC-01): root folder names scanned for markdown docs.
     * A configured name overrides the repo-intel walker's EXCLUDED_DIRS for
     * that name (Decision D3). */
    context_root_names: z.array(z.string()).default(['specs', 'docs', 'insights']),
    /** Project Context (SPEC-01): total per-agent/skill token estimate above
     * which the Context tab shows a non-blocking overflow warning (Decision
     * D5) — nothing is auto-truncated or auto-dropped. */
    context_token_warn_threshold: z.number().int().positive().default(8000),
});
/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export const SettingsUpdate = Settings.partial();
// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export const ConnTestRequest = z.object({
    provider: ConnTestProvider,
    /** Optional API key/PAT to persist and then test (BYO key from the UI). */
    key: z.string().min(1).optional(),
});
export const ConnTestResult = z.object({
    provider: ConnTestProvider,
    ok: z.boolean(),
    message: z.string(),
    detail: z.unknown().optional(),
});
// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
    openai: z.boolean(),
    anthropic: z.boolean(),
    openrouter: z.boolean(),
    github: z.boolean(),
});
// ---- Repos ----
export const RepoInput = z.object({
    url: z.string().url(),
});
export const Repo = z.object({
    id: z.string(),
    workspace_id: z.string(),
    owner: z.string(),
    name: z.string(),
    full_name: z.string(),
    default_branch: z.string(),
    clone_path: z.string().nullable(),
    last_polled_at: z.string().nullable(),
    created_by: z.string().nullable(),
});
// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export const PrMeta = z.object({
    id: z.string().nullish(),
    number: z.number().int(),
    title: z.string(),
    author: z.string(),
    branch: z.string(),
    base: z.string(),
    head_sha: z.string(),
    additions: z.number().int(),
    deletions: z.number().int(),
    files_count: z.number().int(),
    status: PrStatus,
    opened_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    // Latest-review score (list endpoint only; null/absent until reviewed).
    score: z.number().int().nullish(),
    // Cost (USD) of the latest review batch (list endpoint only). null/absent
    // when the PR has no priced run yet; UI shows "—", not "$0".
    cost_usd: z.number().nullish(),
});
export const PrFile = z.object({
    path: z.string(),
    additions: z.number().int(),
    deletions: z.number().int(),
    patch: z.string().nullish(),
});
export const PrCommit = z.object({
    sha: z.string(),
    message: z.string(),
    author: z.string(),
    committed_at: z.string().nullish(),
});
export const IssueMeta = z.object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullish(),
    state: z.string(),
});
export const PrDetail = PrMeta.extend({
    body: z.string().nullish(),
    files: z.array(PrFile),
    commits: z.array(PrCommit),
    linked_issue: IssueMeta.nullish(),
});
// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
    id: z.number().int(),
    path: z.string(),
    line: z.number().int().nullable(),
    original_line: z.number().int().nullable(),
    side: z.enum(['LEFT', 'RIGHT']),
    body: z.string(),
    user: z.string(),
    created_at: z.string(),
    html_url: z.string(),
    in_reply_to_id: z.number().int().nullable(),
    /** GitHub couldn't anchor it to the current diff (line == null). */
    is_outdated: z.boolean(),
});
/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    side: z.enum(['LEFT', 'RIGHT']).optional(),
    body: z.string().min(1),
    /** Reply to an existing review comment thread (its comment id). */
    in_reply_to: z.number().int().optional(),
});
// ---- Project Context ----
export const SpecFile = z.object({
    path: z.string(),
    content: z.string().nullish(),
    size: z.number().int().nullish(),
    updated_at: z.string().nullish(),
});
export const IndexStatus = z.object({
    status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
    pct: z.number().min(0).max(100),
    message: z.string().nullish(),
    chunks_indexed: z.number().int().nullish(),
});
// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
    agentId: z.string().optional(),
    all: z.boolean().optional(),
});
// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
    }),
});
//# sourceMappingURL=platform.js.map