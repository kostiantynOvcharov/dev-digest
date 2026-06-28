# Insights — reviewer-core

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-06-14** — `reviewPullRequest` already returns `tokensIn`/`tokensOut`/`costUsd` in `ReviewOutcome` — consumers wanting cost should READ it from the outcome, not recompute (zero extra model calls). Cost is accumulated per chunk and goes `null` if ANY chunk lacked a cost (conservative). The OpenRouter provider prefers the real `usage.cost` and falls back to `estimateCost`. Evidence: `reviewer-core/src/review/run.ts:110,184`, `src/llm/openrouter.ts`.

## Tool & Library Notes

- **2026-06-27** — The "iron rule" (no I/O) is now machine-enforced: `npm run arch:check` runs `dependency-cruiser` against `reviewer-core/.dependency-cruiser.cjs` (also a step in `.github/workflows/reviewer-core.yml`). It forbids `drizzle-orm`/`postgres`, `octokit`/`simple-git`, `fastify`, and Node I/O builtins (`fs`/`child_process`/`net`/`http(s)`/`dns`), but ALLOWS `openai` (the LLM transport) and `zod` — that's the concrete meaning of "pure, only the injected LLMProvider". reviewer-core uses npm (not pnpm), so `dependency-cruiser` was added to devDeps + `package-lock.json`. Evidence: `reviewer-core/.dependency-cruiser.cjs`.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
