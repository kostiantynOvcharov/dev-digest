# DevDigest agents

This folder holds DevDigest's custom Claude Code **subagents**. Each `*.md` file is one agent: YAML
frontmatter (`name`, `description`, `tools`, `model`, optional `skills`/`isolation`/…) followed by a
system-prompt body. Claude routes to an agent by matching a task against its `description`; you can
also invoke one explicitly via the Agent tool / FleetView, or by name.

A subagent runs in its own context — it does **not** inherit the parent conversation. It loads the
project `CLAUDE.md`, any `skills:` listed in its frontmatter, and whatever it reads at runtime.

## Agent catalog

### `researcher` (model: sonnet)
Read-only investigation specialist. Finds information in the codebase or on the web and returns a
highly structured, source-cited report; confirms scope before researching and never writes files.
Tools: `Read, Grep, Glob, Bash, WebSearch, WebFetch`. This file is the structural template the two
agents below follow (frontmatter + **Hard constraints** + numbered protocol).

### `planner` (model: opus)
Turns a software task into a structured **Development Plan**: decomposed work-units, affected
modules/files, the exact skills each unit must apply, per-unit verification commands, and a
parallelization map. Read-only on source; writes **only** the plan file (`docs/plans/<slug>.md`).
- **Tools:** `Read, Grep, Glob, Bash` (read-only), `Write` (plan file only).
- **Skills (pre-injected):** the full union of the implementer's backend + UI sets —
  `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
  `next-best-practices`, `react-best-practices`, `react-frontend-best-practices`,
  `react-testing-library`, `zod`, `security`, `typescript-expert`, plus `mermaid-diagram`. It plans
  with every practice the implementer will execute, so the plan is grounded in the same rules.
- **Based on:** orchestrator-worker decomposition + file-based plan handoff (multi-agent research),
  the explore→plan→code separation (best practices), and the "expand a small task into a
  comprehensive spec / sprint contract" pattern (harness design).

### `implementer` (model: sonnet)
Implements **one** work-unit from a Development Plan (UI or backend) in an isolated git worktree, so
multiple implementers run in parallel without file conflicts. Applies the DevDigest skill set for
its domain, writes the code, then self-reviews **only** by running the existing tests + typecheck
until green.
- **Tools:** `Read, Write, Edit, Grep, Glob, Bash, Skill`; `disallowedTools: WebSearch, WebFetch`.
  `permissionMode: acceptEdits`, `isolation: worktree`.
- **Skills (pre-injected + body routing):** backend → `onion-architecture`, `fastify-best-practices`,
  `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `security`, `typescript-expert`; UI →
  `react-best-practices`, `react-frontend-best-practices`, `next-best-practices`,
  `react-testing-library`, `zod`, `security`, `typescript-expert`; plus `engineering-insights` for
  the end-of-session write-up.
- **Based on:** worktree isolation for parallel agents, the writer≠reviewer separation, and the
  "give the agent a way to verify its work" loop (see sources).

## Design practices applied
These come from the official Claude Code docs and Anthropic's engineering blogs (sources below):

- **`description` is the routing signal.** Each agent's description leads with when to use it and
  states explicit negatives ("Do NOT use it to…") so Claude doesn't misfire between planner and
  implementer.
- **Tool restriction = single responsibility.** The planner has no general write access (it can't
  mutate source — only the plan file); the implementer has write tools but no web access and can't
  plan. The boundary is enforced by tools, not just by instructions.
- **File-based plan handoff.** The planner writes the Development Plan to a file rather than
  returning it as a long string — a plan passed inline can be truncated by the context window; a
  file is durable and re-readable by every implementer.
- **`isolation: worktree` for parallelism.** Each implementer gets its own git checkout, the
  official mechanism for preventing file-overwrite conflicts when several agents run at once.
- **Writer ≠ reviewer.** Agents reliably over-praise their own output, so the implementer's
  self-review is deliberately scoped to a deterministic pass/fail signal (existing tests +
  typecheck). Architecture/quality review is left to a separate reviewer or the `pr-self-review`
  gate.
- **A verifiable "done" signal.** Implementers run the package's real test + typecheck commands and
  report the **verbatim** output, iterating until green — not a self-assessed summary.
- **Skills delivered two ways.** Domain skills are pre-injected via the `skills:` frontmatter field
  *and* re-stated as backend/UI routing tables in the body, so the right practices apply regardless
  of run mode. This mirrors how the `pr-self-review` skill routes files to skills.
- **Insights at the right place.** The planner embeds relevant `INSIGHTS.md` entries into the plan,
  and each implementer also reads its package's `INSIGHTS.md` locally on start — insights live at
  package root (server/client/reviewer-core/e2e), not per-module.
- **Right-sized fan-out.** Plans target 3–6 work-units and ~3–5 parallel implementers — past that,
  coordination overhead outweighs the benefit.

## Sources
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — frontmatter fields,
  `description` routing, tool restriction, `isolation`, `skills`, `permissionMode`.
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — how skills load and how
  agents compose them.
- [Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees) → parallel
  implementer isolation.
- [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams) →
  task sizing, avoiding file conflicts between parallel agents.
- [How Claude remembers your project](https://code.claude.com/docs/en/memory) → what loads into a
  subagent automatically.
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) → explore→plan→
  code, give Claude a way to verify its work.
- [Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents) →
  planner/worker building blocks.
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
  → orchestrator-worker decomposition + file-based plan handoff.
- [Harness design for long-running app development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
  → writer≠reviewer (agents over-praise own work) & the sprint-contract / spec-expansion pattern.
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  → "right altitude" system prompts, structured prompt bodies.
