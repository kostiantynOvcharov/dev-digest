# Workflow Retro Ledger

## 2026-07-09 — spec-01-project-context (spec → plan chain)
- Run: 7 agents — 3 top-level (spec-creator ×2, implementation-planner ×1) + 4 Explore sub-agents (spawned by spec-creator #1); order spec-creator(write) → spec-creator(finalize) → implementation-planner; model claude-opus-4-8 throughout.
- Cost: $29.70 total ($9.66 per spec, $13.79 per plan; main-loop orchestration $6.26) · cache eff 0.88 main / 0.84–0.86 depth-1 agents (0.55–0.77 short Explores, expected).
- Parallelism: 0.99 (serial — **expected**, this is a spec→plan dependency chain, not a fan-out) · critical path: implementation-planner (6539s ≈ 109 min) · tool errors: 4 (1 was a main-loop SendMessage schema miss).
- Hard: implementation-planner — 109 min wall-clock, 48 tool calls, 30 Reads, 1.39M cache-creation tokens; the whole run's bottleneck.
- Easy: spec-creator "finalize" — $1.21, 215s, one targeted Edit to apply the 9 resolved decisions.
- Duplicated: `run-executor.ts` read by 3 agents; `prompt.ts` by 2; `repo-intel/{walk,service,constants}.ts` + `schema/{agents,context}.ts` re-read by the planner after Explores had already read them — cross-run re-grounding (agents don't share memory).
- Missed: nothing functional — all 19 ACs mapped to units. The gap is process: the planner re-grounded from scratch instead of consuming the spec's existing `file:line` evidence.
- Actions:
  - Prefetch the shared spine once (`run-executor.ts`, `prompt.ts`, `vendor/shared/contracts/trace.ts`, `repo-intel/{walk,service,constants}.ts`, `schema/{agents,context,skills}.ts`) and hand paths+excerpts to both spec-creator and implementation-planner briefings → kills cross-run re-reads.
  - Seed the planner with the spec's grounding section (it already carries `file:line` refs) so it doesn't re-derive facts the spec proved.
  - SendMessage is a deferred tool: load its schema via ToolSearch before calling and use param `message` (not `prompt`) — cost 1 wasted main-loop tool call this run.
  - Do not chase parallelism in this phase — it's inherently serial. Parallelism gains land at `run-plan` (parallel implementers), not yet measured.

## 2026-07-09 — spec-01-project-context (re-retro, incl. per-agent tokens + hook-loop cost)
- Supersedes the numbers in the entry above for the same run; adds the per-agent token table and a new finding. Same run, re-measured after further main-loop turns.
- Run: 7 agents (spec-creator ×2, implementation-planner ×1, Explore ×4), order write → finalize → plan, model claude-opus-4-8.
- Tokens: ~19.9M total (main 4.54M · agents ~15.4M) · in 262k / out 158k / cache-read ~13.3M.
- Cost: $32.65 ($9.65 per spec, $13.79 per plan, $9.21 orchestration) · cache eff 0.88 main / 0.84–0.86 agents.
- Parallelism: 0.99 (serial — expected, dependency chain) · critical path: implementation-planner (6539s ≈ 109 min) · tool errors: 5.
- Hard: implementation-planner (9.89M tok, 48 tool calls, 109 min) · Easy: spec-creator finalize (844k tok, $1.21) · Duplicated: run-executor.ts (3 agents), prompt.ts (2), repo-intel/* + schema/* re-read by planner after Explores · Missed: nothing functional; planner re-grounded instead of using the spec's file:line evidence.
- **New finding:** main-loop cost rose $6.26 → $9.21 (+$2.95, +47%) with no new agent work — churn from the misfiring `engineering-insights` Stop hook re-firing ~6× while blocked on user input.
- Actions:
  - **Fix the Stop hook condition** so `engineering-insights` fires once at genuine session end, not on every idle turn awaiting user input — cheapest win (~$3 wasted this run).
  - Prefetch the shared spine files once and pass to spec-creator + planner (kills cross-run re-reads).
  - Seed the planner with the spec's grounding section so it doesn't re-derive proven facts.
  - No parallelism to gain this phase (serial chain); measure it at `run-plan`.

## 2026-07-09 — spec-01-project-context (run-plan orchestration: implement → review → fix → verify → PR gate)
- Run: 11 run-plan agents — `implementer` ×1 (Unit 1) + `general-purpose` ×9 (Units 2–8, AC-5 gap-fill) + `plan-verifier` + `arch-reviewer`; model claude-opus-4-8. Sequential in-tree after the worktree-base recovery. (Whole session incl. earlier spec/plan phase = 18 agents.)
- Tokens: run-plan agents ~107M total; whole-session ~380M (main loop 262M alone). Cache eff: main 0.994, agents ~0.93–0.97.
- Cost: **$261 whole session** — main loop **$159.68 (61%)**, run-plan agents ~$78, spec/plan phase ~$23. Per implemented unit ≈ $8.7 (agent-side). cache eff excellent everywhere.
- Parallelism: 0.57 (forced-serial: can't run concurrent `general-purpose` agents in one shared working tree) · critical path: implementation-planner 6539s (prior phase); largest run-plan agent = Unit 2 (1148s, $16.72) · tool errors: 13 (incl. 1 main-loop SendMessage schema miss, 3 in the stale-worktree U1).
- Hard: Unit 2 ($16.72, 155 turns, 21M tok — built the walker + new module + hit the vendored-.js runtime wall) · Unit 1 implementer ($7.04, WASTED — worktree cut from stale `main`, re-integrated by hand) · AC-5 gap-fill ($10.28).
- Easy: spec-creator finalize ($1.21) · arch-reviewer ($2.83) · plan-verifier ($3.77).
- Duplicated: 49 files read by >1 agent — every implementer re-read the plan + CLAUDE.md + INSIGHTS + the SkillsTab/editor template files.
- Missed: nothing functional (19/19 ACs). Process misses: worktree stale-base not detected before spawning U1; vendored-`.js` regen churned 3× (U2 flagged → I fixed → gap-fill reverted `platform.js` → I re-fixed); AC-5 content endpoint was a plan gap surfaced only at Unit 6.
- Actions:
  - **FIX THE `engineering-insights` STOP HOOK — biggest lever by far.** It fired on every idle turn (779 main-loop turns, most one-line "Waiting on X" replies each re-reading the 262M-cache context) ≈ **$159 / 61% of total spend** for near-zero value. It must fire once at genuine session end, not while background agents run or awaiting user input. Fix its condition in `.claude/settings.json`.
  - **Detect base-staleness before Phase 2.** `implementer` cuts worktrees from `main`; `main` was 13 commits behind `lesson5`, wasting the U1 implementer + forcing hand-integration. Either merge to main first or use in-tree agents from the start (what I switched to).
  - **Prefetch shared context once** — pass the plan unit-block + relevant INSIGHTS excerpts + template file paths inline (I did this partially); 49 duplicated file-reads is direct waste.
  - **Make vendored-`.js` regen one explicit lock-step step** after any `vendor/shared/*.ts` edit, then verify runtime load — avoids the 3× churn and the gap-fill's accidental revert.
  - Parallelism 0.57 is a symptom of the stale base (no safe concurrency in one tree); fixing the base unlocks real parallel implementers.

## 2026-07-10 — spec-02-why-risk-brief (full chain: explore → spec → plan → cross-model → run-plan)
- Run: 10 agents — Explore ×1, spec-creator ×1, implementation-planner ×1, implementer ×1 (WASTED, sonnet), general-purpose ×4 (Units 1-redo/2/4/3, opus), arch-reviewer + plan-verifier (sonnet); order Explore→spec→plan→U1(fail)→U1→U2→U4→U3→(arch∥verify). Plus a cross-model plan review via an OpenRouter script (Gemini 2.5 Pro, NOT an agent, ~$0.07).
- Tokens: ~96.1M total (main 27.1M · agents 68.9M) · in 461k / out 534k / cache-read 89.7M.
- Cost: **$91.48** (main $27.88 · agents $63.59) + ~$0.07 cross-model · ≈ **$9.7 per implemented unit** (agent-side, 4 units) · cache eff **0.973 main** / 0.69–0.89 agents.
- Parallelism: 0.64 (forced-serial — in-tree implementers, no safe concurrency; arch∥verify was the only real overlap) · critical path: Unit 3 general-purpose (897s, $18.15) · tool errors: 4 main + 5 agent (3 in the dead U1 implementer).
- Hard: Unit 3 ($18.15, 137 turns, 21.5M tok — service+routes+D2 refactor+it-test) · Unit 4 ($10.89, 664s) · implementation-planner ($8.27).
- Easy: arch-reviewer ($2.10, 171s) · U1-redo ($5.18, 158s).
- Wasted: implementer #4 ($1.17, produced nothing) — `implementer` agent type forced a worktree cut from stale `main`; correctly self-aborted, re-run in-tree via `general-purpose`.
- Duplicated: the "intent-as-template" spine re-read across agents — `reviews.ts` schema (4 agents), `IntentCard.tsx` + `intent.ts` hook (3 each: Explore, planner, U4), `prompt.ts` (2).
- Missed: nothing functional (plan-verifier PASSED 17/17 ACs + D1-D6 + 6 X-review amendments). Process: the `composeSmartDiff` cross-module smell surfaced only at arch-review (adjudicated as convention-consistent, no fix).
- Positive trend: main-loop **$27.88 @ 0.973 cache eff** vs prior session's $159/61% — the `engineering-insights` Stop-hook fix (prior retro action #1, commit 1a7c022) worked.
- Actions:
  - **Pass `model: "sonnet"` to the `general-purpose` implementers — biggest lever, and the lesson's own instruction I missed.** Switching from `implementer` (sonnet) to `general-purpose` silently inherited Opus; Units 1-redo/2/3/4 on Opus = $38.96. On Sonnet ≈ 1/5 → ~$8, saving ~$30/run. The reviewers (arch/verify) staying on Sonnet was correct.
  - **Don't use the `implementer` agent type while `main` lags the working branch** (`main` was 15 behind `lesson5`): its forced worktree-from-`main` guarantees a wasted spawn. Use `general-purpose` in-tree until main is current. (Durable — record via engineering-insights.)
  - **Prefetch the intent-template spine once** (`IntentCard.tsx`, `intent.ts`, `intent/{service,routes,helpers}.ts`, `reviews.ts` schema) and embed excerpts in the spec/plan/implementer briefs — 3-4 agents re-read each.
  - Parallelism 0.64: the plan's batch A (U2∥U4, disjoint packages) was serialized by the stale-base in-tree constraint; merging main up (or basing worktrees on `lesson5`) would let U2+U4 overlap (~250s wall saved). Otherwise accept serial as the safe choice.
  - Keep the OpenRouter cross-model-review-as-script pattern (~$0.07, off the agent budget) — cheap, effective, different model family.
