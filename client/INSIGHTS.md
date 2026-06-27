# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-14** — `formatCost` (`src/lib/cost.ts`) distinguishes MISSING data (`null`/`undefined` → "—") from a genuine zero (`0` → "$0.00"), widens precision for sub-cent values (~2 sig figs), and trims trailing zeros to a 2dp floor ("$0.06" not "$0.060", "$0.0013" not "$0.00"). Reuse it for any per-run money display.

## What Doesn't Work

- **2026-06-18** — `pnpm db:seed` creates reviews/runs for the demo PRs but ZERO findings (the `findings` table is empty after a fresh seed). So the new PR-list FINDINGS column and the Agent-runs timeline findings both render their EMPTY states locally ("—" / "0 finding(s)") — there's nothing to screenshot out of the box. To populate the findings UI you must run a real review (needs a non-empty `OPENROUTER_API_KEY` in `server/.env`; the 3 default agents use `deepseek/deepseek-v4-flash` via OpenRouter — all keys ship empty). Inserting demo `findings` rows directly is blocked by the harness write-guard. Evidence: `GET /pulls/:id/reviews` returns `findings: []` for seeded PR #482.

## Codebase Patterns

- **2026-06-14** — Cross-route shared components live in `src/components/<Name>/` with an `index.ts` barrel, imported via `@/components/<Name>` (e.g. `RunCostBadge`, `diff-viewer`). Vendored UI primitives (`Badge`, `CircularScore`) live in `src/vendor/ui` under `@devdigest/ui` — different home. Evidence: `client/src/components/RunCostBadge/`.
- **2026-06-14** — The PR-list table is driven by two parallel constants that MUST stay length-aligned: `COLUMN_KEYS` (header keys + order) and `GRID` (CSS grid-template tracks). Adding a column = add to both AND render a matching cell in `PRRow.tsx`, else header/cells misalign silently. Evidence: `client/src/app/repos/[repoId]/pulls/constants.ts`.
- **2026-06-14** — i18n has only the `en` locale (`client/messages/en/`); new UI strings need a key under the right namespace file (e.g. `prReview.json`, `runs.json`) read via `useTranslations("<ns>")`. A missing key renders the raw key, not an error.
- **2026-06-18** — Findings on the PR detail page are NOT a flat list: `FindingsTab` renders one `ReviewRunAccordion` per `ReviewRecord`, each owning its own `FindingsPanel`. A PR-level finding filter/counter must aggregate over `runs.flatMap(r => r.findings)` in `FindingsTab` and be threaded down as a prop (accordion → panel). `visibleFindings()` in `FindingsPanel/helpers.ts` is the single choke point for finding filtering+severity sorting — extend it (it already takes `hideLow`, now `severity?`) rather than filtering inside the component. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts`.
- **2026-06-18** — The PR-list endpoint (`GET /repos/:id/pulls` → `PrMeta[]`) DELIBERATELY omits per-severity finding counts ("findings live on the PR detail page" — `server/src/modules/pulls/routes.ts:114`), and `PrMeta` lives in the do-not-touch `server/src/vendor/shared/`. To surface findings on the list WITHOUT backend changes: the list response already includes each PR's internal `id` (`routes.ts:176`), so fetch findings client-side per reviewed PR (`score != null`) with `useQueries` keyed `["reviews", prId]` — the SAME key `usePrReviews` uses, so cache is shared with the PR detail page both directions. See `usePrFindingsForList` in `client/src/lib/hooks/reviews.ts`. The timeline (Agent runs) needs no fetch: `FindingsTab` already has `runs: ReviewRecord[]`, joinable to `prRuns: RunSummary[]` by `run_id`.

- **2026-06-27** — Adding a tab to the agent/skill editor takes THREE edits in lock-step or the tab is invisible/dead: (1) the editor's `constants.ts` `TABS` (renders the tab button), (2) the route page's `VALID_TABS` (else `?tab=x` silently falls back to `config`), and (3) the editor component's body switch — the shell previously hard-rendered `ConfigTab` regardless of `tab`, so a new tab needs an explicit `{tab === "x" && <XTab/>}`. Evidence: `client/src/app/agents/[id]/_components/AgentEditor/{AgentEditor,constants}.tsx` + `agents/[id]/page.tsx` (skills editor mirrors this at `app/skills/[id]/`).

## Tool & Library Notes

- **2026-06-18** — There is NO Tooltip/Popover/HoverCard primitive in `vendor/ui` (only `Modal`/`Drawer`, which are too heavy for inline hovers). For hover popovers that must escape table/row `overflow`, use the shared `HoverPopover` (`client/src/components/HoverPopover/`): it renders content via `react-dom` `createPortal` to `document.body`, positioned from the trigger's `getBoundingClientRect()` (fixed, viewport-clamped, flips above when the space below is cramped). Evidence: `client/src/components/HoverPopover/HoverPopover.tsx`.
- **2026-06-18** — Verifying client data locally: the dev API (`:3001`) is reachable UNAUTHENTICATED and resolves a default workspace, so `curl` works directly — `GET /repos`, `GET /repos/:id/pulls` (returns each PR's `id` + `score`), `GET /pulls/:id/reviews` (findings). The local Postgres container is `devdigest-postgres` with role/db `devdigest`/`devdigest` (NOT `postgres`). `./scripts/dev.sh` reuses an already-running Postgres but the API/web boot will `EADDRINUSE` if `:3001`/`:3000` are already up — check `lsof -iTCP:3000` before relaunching.

## Recurring Errors & Fixes

## Session Notes

## Open Questions

- **2026-06-18** — `RunHistory.test.tsx` has a pre-existing failing assertion (`9,119 tok · $0.0013` token/cost formatting) on the clean `Lesson1` tree — confirmed via `git stash`. Unrelated to findings/UI work; don't treat it as a regression you introduced. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx:81`.
