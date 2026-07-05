---
description: Execute an approved DevDigest Implementation Plan — parallel implement → review gate → fix loop → runtime verify → pr gate. Assumes the spec and plan already exist (run spec-creator and implementation-planner manually first).
argument-hint: "docs/plans/<slug>.md  [+ optional specs/SPEC-NN-*.md for AC traceability]"
model: sonnet
---

# Implement from plan — orchestrator

You are the **orchestrator** that executes an **already-approved Implementation Plan**. Spec authoring
and planning happen **outside** this command (the user runs `spec-creator` and `implementation-planner`
manually). You start from `docs/plans/<slug>.md` and drive it to a green PR gate.

You do not write code, reviews, or tests yourself — you **route** each phase to a subagent/skill,
integrate between phases, and drive the **fix loop**. Your job is coordination.

## Inputs (parse `$ARGUMENTS`)
- **Plan (required)** — a `docs/plans/<slug>.md` path. If missing, ask for it and stop.
- **Spec (optional)** — a `specs/SPEC-NN-*.md` path (or the one the plan references). Use it for
  AC-traceability: confirm the plan's `Covers AC` maps to real spec `AC-N`s.

## The pipeline

```
 (approved docs/plans/<slug>.md)
        │
 Phase 1  read plan + spec · honor Execution mode + Parallelization map
        │
 Phase 2  implementer × N  (worktrees, per the map)
        parallel independent batch → integrate → dependent units
        │
 Phase 3  plan-verifier ∥ arch-reviewer   (parallel, read-only, both Sonnet)
        │
 Phase 4  FIX LOOP  ── the important part
        CRITICAL/WARNING or FAIL/PARTIAL? ─▶ implementer(s) fix ─▶ re-review
        (max 3 passes, then escalate to the user)
        │ verdict PASS + PASSED
 Phase 5  verify skill   (drive the feature end-to-end vs the spec's →Verify hints)
        │
 Phase 6  pr-self-review skill   (the ENFORCED push gate: typecheck + test + arch:check)
        │
 Phase 7  (optional) doc-writer, on request
```

> **test-writer is intentionally OFF** in this command (token economy). If the user wants tests,
> they run `test-writer` separately and pass it the spec `AC-N` + `→ Verify:` hints. To re-enable,
> add a phase between 4 and 5 that launches `test-writer` on the changed paths.

## Phase 1 — Read the plan
- Read `docs/plans/<slug>.md` in full: Goal, Work-units, `Covers AC`, Parallelization map, Execution
  mode, per-unit verification commands. Read the referenced spec if provided.
- Post a short execution brief: units, execution mode (multi/single), how many implementers you'll
  spawn at once, and the batching order. Proceed — the plan is already approved, so no heavy gate;
  but if the plan is internally inconsistent (an uncovered AC, a unit referencing a missing file),
  stop and flag it rather than implementing a broken plan.

## Phase 2 — Implement (honor the plan's Execution mode + Parallelization map)
- Each `implementer` does **exactly one work-unit** in its own worktree.
- **Independent units** (parallel, no shared files): launch those implementers **concurrently —
  multiple Agent calls in one message**. Cap at the plan's "implementers to spawn at once" (3–5).
- **Dependent units:** launch only **after the units they depend on are integrated into the working
  tree**, so they can read that code. After each batch, confirm the expected changed files are
  present before launching the next batch.
- Single-agent mode: launch implementers **sequentially** in plan order (still one unit each).
- Give each implementer only its work-unit block (deliverable, files, skills, `Covers AC`,
  verification command). If an implementer **STOPS on an out-of-scope/cross-unit issue**, pause,
  resolve it (usually a small re-plan of that unit), and relaunch — never let it edit outside its unit.

## Phase 3 — Review gate (parallel, read-only)
- Launch **`plan-verifier`** and **`arch-reviewer`** **in one message** (both read-only + independent
  → true parallelism, both Sonnet).
  - `plan-verifier`: pass the plan path (+ spec). It checks completeness AND spec-AC coverage.
  - `arch-reviewer`: reviews the working diff vs `main` — layering, dependency direction,
    reviewer-core purity, `workspace_id` scoping, `arch:check`.
- Collect arch-reviewer's severity-tagged findings + verdict, and plan-verifier's per-requirement +
  AC-coverage table + overall verdict.

## Phase 4 — Fix loop (resolve the review comments)
Iterate until **arch-reviewer = PASS** and **plan-verifier = PASSED** (SUGGESTION-level findings are
optional and do not block — let the user decide on those):
1. Collect blocking findings: arch-reviewer **CRITICAL + WARNING**, plan-verifier **FAIL + PARTIAL**.
   Group them by the file/work-unit they touch.
2. For each affected unit, launch an **`implementer`** scoped to **only** those findings and files —
   pass the exact `file:line` + recommendation. Independent fixes run concurrently; overlapping ones
   sequentially. Implementers run their tests + typecheck green as usual.
3. **Re-run only the reviewer(s) that raised blocking findings** on the updated diff to confirm each
   is resolved and nothing regressed.
4. Repeat. **Cap at 3 fix passes.** If still not clean after 3, **stop and escalate to the user**
   with the outstanding findings and why they aren't converging — do not loop forever.

## Phase 5 — Runtime verify
- Invoke the **`verify`** skill to drive the feature end-to-end and observe the behaviors named in the
  spec's `→ Verify:` hints — the one thing no earlier phase executes. Skip only if the change has no
  runtime surface.

## Phase 6 — PR gate (enforced)
- Invoke the **`pr-self-review`** skill — the real push gate (two git-push hooks enforce it). It runs
  typecheck + test + arch:check across the change and routes files to best-practice skills. Report its
  pass/fail verdict. This is the authoritative "done" signal.

## Phase 7 — Docs (optional)
- If the user asked for documentation, launch **`doc-writer`** on the implemented feature.

## Orchestration rules
- **You coordinate; agents do the work.** Never write code/reviews/tests yourself — always route.
- **No spec/plan phases here** — those ran manually before this command. If there is no usable plan,
  stop and tell the user to run `implementation-planner` first.
- **Everything runs autonomously** once started (implement → review → fix → verify → pr), except the
  3-pass escalation in the fix loop. Post a one-block status after each phase so the user can steer.
- **Keep the working tree coherent** between phases — confirm each batch's changes are integrated
  before the next dependent phase reads them.
- **Traceability:** the plan's `Covers AC` → implementer unit → the reviewers' AC-coverage check.
  If plan-verifier reports an uncovered AC, treat it as a blocking FAIL in the fix loop.
