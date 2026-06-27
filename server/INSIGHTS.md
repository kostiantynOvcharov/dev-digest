# Insights — server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-06-14** — Shared contracts (`@devdigest/shared`) are vendored as TWO hand-maintained copies — `server/src/vendor/shared/` and `client/src/vendor/shared/` — resolved by tsconfig path alias, NOT auto-synced. Adding a field means editing both in lock-step; the only diffs between copies are comments. Evidence: `server/src/vendor/shared/contracts/trace.ts`, `platform.ts`.
- **2026-06-14** — PR-list per-PR aggregates (score, cost) are computed ON READ in `GET /repos/:id/pulls` via one `inArray` query + JS grouping, never denormalized onto `pull_requests`. "Latest review batch" cost has no batch id in the schema — approximated by summing `agent_runs.cost_usd` within a 120s window of the PR's newest priced run. Evidence: `server/src/modules/pulls/routes.ts`.
- **2026-06-14** — `completeAgentRun`'s `values` shape is declared in TWO places that must match: the repo fn (`repository/run.repo.ts`) AND the interface wrapper (`repository.ts:151`). Adding a field (e.g. `costUsd`) needs both or typecheck fails.
- **2026-06-27** — The backend is MIXED-architecture, not uniformly onion. `agents`/`repos`/`reviews`/`repo-intel` are fully layered (routes→service→repository); `settings`/`pulls`/`polling`/`workspace` are THIN — their `routes.ts` query Drizzle inline (no service/repo). Thin modules are grandfathered as warn-level in `arch:check` (`route-direct-db-legacy`); do NOT copy them — new modules must be layered. Evidence: `server/src/modules/{settings,pulls,polling,workspace}/routes.ts` vs `modules/agents/`.
- **2026-06-27** — `platform/container.ts` is the composition root and is deliberately the ONLY place allowed to import across all layers (adapters + sibling-module repos + module services). No `dependency-cruiser` rule uses `^src/platform` as a `from`, so this is by design — don't "fix" it, and don't copy the pattern into a module. Evidence: `server/.dependency-cruiser.cjs`, `server/src/platform/container.ts:26-31`.

## Tool & Library Notes

- **2026-06-14** — New DB columns: edit `db/schema/*.ts`, then `npm run db:generate` (drizzle-kit) auto-generates `00NN_*.sql` (e.g. `0010_solid_baron_zemo.sql` = `ALTER TABLE … ADD COLUMN`). Never hand-write migration SQL; apply with `npm run db:migrate`.
- **2026-06-27** — Onion layering is machine-enforced: `pnpm arch:check` runs `dependency-cruiser` against `server/.dependency-cruiser.cjs` (also an `arch` job in `.github/workflows/server-unit.yml`). Error-severity rules fail CI; 6 known warns are grandfathered debt (4 thin-module routes + 2 repo-intel service→adapter) — keep errors at 0, don't grow the warns. Config sets `tsPreCompilationDeps: false` ON PURPOSE: counting `import type` edges flags harmless cycles (helpers⇄repository on a row type; container⇄service DI root). `dependency-cruiser` was already a dep (repo-intel indexer) — reused, not added. Evidence: `server/.dependency-cruiser.cjs`.

## Recurring Errors & Fixes

- **2026-06-14** — Adding a required field to a Zod contract (`RunStats.cost_usd`) breaks the inline fixture in `server/test/contracts.test.ts` (RunTrace parse). Update the `stats: {…}` fixture in the same change. Evidence: `server/test/contracts.test.ts:160`.

## Session Notes

### 2026-06-14
- Re-introduced per-run cost (USD) end-to-end (lesson reversing the earlier removal in `d45ab0d`/`58c6ac7`): `cost_usd` column on `agent_runs` (migration 0010), captured in `run-executor` (was discarding `outcome.costUsd`), surfaced in `RunSummary`/`RunStats`/`PrMeta`.
- Decision: PR-list COST = sum of the latest review batch via a 120s window heuristic (no batch id in schema). Cost persisted (accurate `outcome.costUsd`), not recomputed; historical runs → null → "—".

## Open Questions

- **2026-06-14** — PR-list "latest review batch" uses a 120s `ranAt` window as a proxy for a review session. If a real review-session / batch id is ever added to the schema, swap the window for exact grouping in `pulls/routes.ts`.
