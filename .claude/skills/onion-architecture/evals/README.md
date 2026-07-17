# Evals — `onion-architecture` skill

Test suite that measures whether the `onion-architecture` skill actually improves an
agent's layering judgment on the DevDigest backend. It ships **with** the skill so the
evals are pre-configured and travel wherever the skill is delivered.

## Layout

```
evals/
├── evals.json      # the 3 test cases + assertions (the portable test definition)
├── PLANTED.md      # grading answer key — every planted violation. DO NOT show it to the agent under test.
├── fixtures/       # input files with deliberately planted violations, NO hint comments
│   ├── eval-1-notifications/   # a layered module (routes/service/repository/helpers)
│   └── eval-2-core/            # a shared contract + a reviewer-core file
└── workspace/      # "basic setup" — an executed reference run (iteration-1) with outputs, grades, benchmark
```

`evals.json` = **what to test** (test cases). `workspace/` = **a recorded example of running it**
(the basic setup), kept separate so the test definition stays clean.

## The test cases

| # | Name | Type | What it probes |
|---|------|------|----------------|
| 1 | `detect-layered-module-violations` | detection | Catches route/service/repository layer breaks + the multi-tenancy `workspaceId` guard, without false-positiving on the legit `db/rows` type imports. |
| 2 | `detect-core-purity-violations` | detection | Catches a contract leaking `fastify`/`db/schema`/presentation logic, and `reviewer-core` importing `fs`/`child_process`/`simple-git` (the iron rule). |
| 3 | `place-new-module` | construction | Whether a new module is placed the DevDigest way (`routes→service→repository`, `container.github()`, `db/rows`, two-copy contracts, one-line registration). |

The fixtures contain **7 planted violations in eval-1 and 7 in eval-2**, plus deliberate
false-positive traps (legit `db/rows` type imports, a pure `helpers.ts`). See `PLANTED.md`
for the full key.

## How to run (skill-creator harness)

The suite follows the `skill-creator` eval format. To re-run:

1. For each eval, spawn two subagents in the same turn — one **with** the skill (tell it to
   read `../SKILL.md` and apply it), one **baseline** (no skill; restrict it from `.claude/`
   so you isolate the skill's contribution). Both read the same `files` from `fixtures/`.
   Save each run's markdown to `workspace/iteration-N/eval-<id>/<config>/run-1/outputs/`.
2. Capture each subagent's `total_tokens` / `duration_ms` into `.../run-1/timing.json`.
3. Grade each run against the eval's `assertions` into `.../run-1/grading.json`
   (fields: `expectations[].{text,passed,evidence}` + a `summary.{pass_rate,passed,failed,total}`).
4. Aggregate + view:
   ```sh
   SC=<skill-creator path>
   python3 -m scripts.aggregate_benchmark evals/workspace/iteration-N --skill-name onion-architecture
   python3 "$SC/eval-viewer/generate_review.py" evals/workspace/iteration-N \
     --skill-name onion-architecture --benchmark evals/workspace/iteration-N/benchmark.json
   ```

## Baseline result (iteration-1)

| Config | Pass rate |
|--------|-----------|
| With skill | **100%** |
| Baseline (no skill) | **77.8%** |
| Delta | **+0.22** |

Key finding: the skill's measurable edge is on **construction** (eval-3: 100% vs 33%), not
detection (evals 1–2 both hit 100% — general onion knowledge already finds the planted
violations). The baseline subagents also received the project `CLAUDE.md`, so +0.22 is a
conservative lower bound. Full analysis is in `workspace/iteration-1/benchmark.md`
(`notes` section) — including a to-do to make the detection fixtures harder/more
DevDigest-specific so they discriminate.
```
