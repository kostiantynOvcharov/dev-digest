---
name: workflow-retro
description: Manual post-run retrospective for a multi-agent workflow (/run-plan, spec-flow, Workflow, or any batch of subagents). Collects run metrics (tokens, cost, cache efficiency, agent count, launch order, parallelism, per-agent breakdown, tool-call taxonomy, context duplication), analyzes what was hard / easy / duplicated / missed, proposes concrete improvements, and appends one dated entry to a trend ledger. Invoke ONLY on request via /workflow-retro or "retro this workflow" — it MUST NOT run automatically after a workflow.
---

# Workflow Retro

Post-mortem for a multi-agent run: **what did it cost, how well did the agents divide the
work, and what should change next time.** Produce a chat summary + append one entry to a
trend ledger. Analysis **and** actionable proposals — not just numbers.

## Invocation contract (read first)

- **Manual only.** Run when the user types `/workflow-retro`, says "retro this run", or asks
  to evaluate a workflow. **Never wire this into a `Stop` / `SubagentStop` hook or trigger it
  automatically after a workflow finishes.** (The repo's only auto-`Stop` hook runs
  `engineering-insights`; leave `settings.json` alone.)
- **Default depth: in-context.** Work from the metrics the run already left on disk. Add
  `deep` (`/workflow-retro deep`) only when the user asks — then also read the workflow
  script / plan and agent prompt templates to ground the recommendations.
- **Scope:** the most recent workflow in the current session, unless the user names another.

## Three phases

### Phase 1 — Collect metrics (deterministic)

Do **not** eyeball the transcripts. Run the helper — it reads the session jsonl + subagent
transcripts and prints validated JSON:

```bash
python3 .claude/skills/workflow-retro/scripts/collect_metrics.py
```

- `--session <id-or-path>` to target a specific session (default: newest for the cwd project).
- `--workflow-dir <dir>` (repeatable) to fold in a `Workflow()` run — pass the `transcriptDir`
  from that tool's result.
- `--since <ISO8601>` to count only main-loop turns from when the workflow started (find the
  timestamp of the launching `Agent`/`Workflow` tool call).
- `--prices <file>` to override the built-in price table.

The JSON gives you, per run and per agent: token counts, **cost** (USD, cache-aware),
**cache efficiency**, **parallelism factor**, **critical path**, **launch order**,
tool-call counts + `tool_errors`, and **context duplication** (files read by >1 agent).

> Prices in the script are best-effort (`prices_as_of` is in the output). For a cost number
> you'll quote to the user, confirm current per-MTok rates via the **claude-api** skill and
> pass them with `--prices` if they've changed.

### Phase 2 — Analyze

Turn the JSON into findings. Cover the user's core list first, then the added dimensions:

**Core (always):** how many agents ran, in what order, total tokens/cost, and — per agent —
which were **hard** (high tokens/turns/duration or tool_errors), which were **easy**, what
work was **duplicated**, and what was likely **missed** (gaps the agents didn't cover).

**Quantitative (from the JSON):**
- **Cache efficiency** — `cache_read ÷ total_input`. Biggest cost lever; a low main-loop
  number means something is busting the prefix. (First-turn agent writes are expected — don't
  flag those.)
- **Parallelism factor** — `sum(durations) ÷ wall-clock`. Did a "parallel" fan-out actually
  overlap, or run serial?
- **Critical path / bottleneck** — the one agent that ate the most wall-clock.
- **Cost per agent** and **$ per useful output** ($/finding, $/spec, $/fixed-unit) — not just
  raw cost. Tie spend to what the run produced.
- **Tool calls** per agent and total; **failure taxonomy** from `tool_errors` (API errors,
  tool refusals, blocked-on-human).

**Qualitative / effectiveness:**
- **Round-trips of clarification** — how often an agent had to be re-asked or corrected.
  High = the briefing was underspecified → improve the prompt template.
- **Context duplication** — several agents reading the same large file → candidate for a
  shared pre-read. Direct wasted tokens.
- **Delegation correctness** — did the right agent type take the task (reviewer doesn't edit,
  etc.), and did each stay in its owned paths (scope drift)?

### Phase 3 — Report + recommend

**Output A — chat summary.** A tight block: run shape (N agents, order, model), the headline
numbers (cost, cache eff, parallelism, critical path), and the hard/easy/duplicated/missed
read.

Include a **per-agent table** so the token spend is visible per agent — one row per agent, in
launch order, with these columns (all present in the JSON):

| # | agent (type · desc) | in | out | cache read | cache create | total tok | turns | tools | dur | $ |
|---|---|---|---|---|---|---|---|---|---|---|

`total tok` = `input + output + cache_read + cache_creation`. Add a **totals row** summing the
token and cost columns, and show the main loop's own tokens as its own row so per-agent vs
orchestration spend is comparable. Format large counts readably (e.g. `1.86M`, `31.9k`).

Then **concrete, actionable recommendations** — each naming a specific change, e.g.
"prefetch `X` once and pass it to agents A+B", "raise `code-reviewer` prompt specificity —
2 clarification round-trips", "merge agents C+D — same paths, serial", "lower concurrency,
parallelism was 1.1". Not "communication could improve" — a change someone can make.

**Output B — ledger append.** Append **one dated entry** to `docs/retro/workflow-retro-ledger.md`
(create the file with an `# Workflow Retro Ledger` heading if absent). Append-only — never
rewrite prior entries. One entry per run, so the trend ("this workflow got cheaper / faster /
more reliable") is visible over time. Format:

```
## YYYY-MM-DD — <workflow name / plan slug>
- Run: <N> agents (<types>), order <a→b→c>, model <…>
- Tokens: <total tok> total (main <…> · agents <…>)  · in <…> / out <…> / cache-read <…>
- Cost: $<total>  ($<per-useful-output> per <finding/spec/unit>)  · cache eff <main / agents>
- Parallelism: <factor>  · critical path: <agent> (<Ns>)  · tool errors: <n>
- Hard: <…>  · Easy: <…>  · Duplicated: <…>  · Missed: <…>
- Actions: <bullet list of the concrete changes proposed>
```

Convert relative dates to absolute. If a decision from this retro is durable engineering
knowledge (not just this run), also record it via `engineering-insights` — don't duplicate it
in the ledger.

## Boundaries

- Read-only on source; the only file it writes is the ledger (and, in `deep` mode, whatever
  `engineering-insights` chooses to append). It does not edit agent prompts or workflow
  scripts — it **proposes** those edits for the user to apply.
- If no multi-agent run is found in the session (no `Agent`/`Task`/`Workflow` spawns), say so
  and stop — there's nothing to retro.
