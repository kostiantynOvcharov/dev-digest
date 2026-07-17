/** Rough token estimate (~4 chars/token) — display only. Shared across the
 *  Skill editor, the Context tabs, and the run-trace drawer so no feature
 *  reaches into another route segment's private internals for it. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Default per-agent/skill total-token warn threshold for the Context tabs.
 *  Mirrors the `SettingsKnown.context_token_warn_threshold` contract default
 *  (SPEC-01 D5) — used only as the client-side fallback when settings are
 *  unloaded, so the two must stay in sync. */
export const DEFAULT_CONTEXT_TOKEN_WARN_THRESHOLD = 8000;
