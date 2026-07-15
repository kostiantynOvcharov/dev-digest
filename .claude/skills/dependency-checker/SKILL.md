---
name: dependency-checker
description: "Analyzes every dependency of the DevDigest repo and its packages (client, server, reviewer-core, e2e, devdigest-mcp, evals) and produces one structured report — a Mermaid dependency graph, an installed-size breakdown, prioritized findings (P0/P1/P2/Info), and concrete recommendations. Use this skill whenever the user asks about dependencies, node_modules size / bloat, bundle weight, unused or duplicate packages, version drift, cross-package coupling, what a package pulls in, or 'what should we clean up / upgrade / remove' — even if they don't say the word 'dependency'. Read-only and advisory: it proposes changes for the user to confirm, it never installs, upgrades, or removes anything. Trigger terms: dependency check, dependencies, node_modules size, package weight, bloat, unused dependency, duplicate dependency, version drift, dependency graph, coupling between packages, what depends on what, upgrade/remove a package."
metadata:
  tags: dependencies, npm, node_modules, bundle-size, dependency-graph, version-drift, coupling, audit, mermaid
---

## When to use

Reach for this skill whenever the question is *about the dependencies themselves* rather than the
code that uses them:

- "How big is our `node_modules` / what's making it so heavy?"
- "Which packages are unused / duplicated / on different versions across our packages?"
- "Draw me the dependency graph — what depends on what?"
- "What should we upgrade or remove, and in what order?"
- Any review where dependency bloat, coupling, or supply-chain surface is the concern.

It works on the DevDigest layout: **not a monorepo workspace** — `client/`, `server/`,
`reviewer-core/`, `e2e/`, `devdigest-mcp/`, and `evals/` each own a `package.json` + lockfile, and
cross-package code is shared through **TypeScript path aliases**, not `workspace:*`. Keeping that
distinction is the whole point of the analysis, so never describe these packages as pnpm-workspace
members or `workspace:*` links.

This skill is **read-only and advisory**. It gathers, maps, and prioritizes — it does not run
`npm install`, bump versions, or delete packages. Every fix is written as a proposal the user
confirms, because removing a "dead" dependency the analysis only *heuristically* believes is unused
can break a dynamic import or a build step.

## How it works — three phases

```
  1. GATHER            2. ANALYZE                    3. REPORT
  ──────────           ──────────                    ─────────
  scripts/collect.sh   classify each dependency       emit the 5-section report
  → declared deps      external npm  vs  internal      (template below), findings
  → du -sh sizes         (path-alias) dependency       tiered P0..Info, ordered
  → version drift      apply the finding taxonomy      summary of takeaways
  → internal imports   (references.md) → severity
  → unused heuristic
```

### Phase 1 — Gather the data

Run the bundled collector once; it does the mechanical `find` / `du` / `grep` work deterministically
so you can spend your reasoning on judgement, not on re-deriving shell incantations:

```sh
bash .claude/skills/dependency-checker/scripts/collect.sh
```

It prints five labeled blocks: declared dependencies per package, installed sizes (`du -sh`), version
drift, internal cross-package imports (path-alias + deep-relative), and a possibly-unused heuristic.
If the script can't run (no bash, sizes need an install that isn't present), fall back to reading each
`package.json`, `du -sh <pkg>/node_modules/*`, and grepping imports yourself — the report shape is the
same either way. When sizes are unavailable, say so in the Size Breakdown rather than inventing numbers.

### Phase 2 — Analyze and classify

Two classifications drive everything downstream:

1. **External vs internal.** An *external* dependency is an npm package under `node_modules`. An
   *internal* dependency is one DevDigest package reaching into another — via a path alias
   (`@shared/*`, `@devdigest/shared`, `@/*`) or, worse, a deep relative import into a sibling's
   `src/`. These are different risks and must never be merged into one list: external = weight +
   supply-chain + drift; internal = coupling + layering. The graph and findings both keep them apart.

2. **Severity.** Score every finding against the tiers below. Read `references.md` for the full
   finding taxonomy (unused, duplicate/drift, heavy, deep-relative coupling, reviewer-core purity,
   dev-vs-runtime misplacement) with the rationale for each — it's what turns a raw grep line into a
   ranked finding.

### Phase 3 — Report

Emit exactly the structure in the next section. Structure is the deliverable here: a developer should
be able to skim the graph, jump to P0, and know the first thing to do — without reading prose.

## Report structure

Always produce these five sections, in this order, with these headings:

```markdown
# Dependency Check — <repo/scope>

## 1. Scope
Bullet list of every package analyzed (client, server, reviewer-core, e2e, devdigest-mcp, evals)
and, in one line each, what it is. Note anything skipped and why (e.g. node_modules not installed).

## 2. Dependency Graph
A single fenced ```mermaid flowchart. Nodes = packages. Edges = internal (cross-package)
dependencies, labeled with HOW they link (alias vs deep-relative). Attach a few of the heaviest or
most notable EXTERNAL deps to the package that owns them, styled distinctly from packages, so the
graph shows both the internal topology and where weight sits. Do NOT draw an edge for a `workspace:*`
link — there are none here.

## 3. Size Breakdown
A table, largest first. Columns: Package | Dependency | Installed size | Notes.
Include a per-package total row. This must be a real table with real `du -sh` numbers, not a vague
"the client is large" sentence. If sizes weren't collected, state that explicitly here.

## 4. Findings & Priorities
Group findings under explicit severity tiers — one subsection per non-empty tier, most severe first:

### P0 — fix now
### P1 — soon
### P2 — worth doing
### Info — FYI, no action

Every finding is one bullet naming a SPECIFIC package, dependency, or file
(`server/package.json`, `moment`, `reviewer-core/src/pipeline.js`) — never generic advice like
"consider optimizing dependencies". State the problem, the evidence, and the impact.

## 5. Summary
3–5 concrete, actionable takeaways ordered by priority — the short list a developer acts on first.
Each takeaway names its target and is phrased as a proposal to confirm, not a done deed.
```

## Severity rubric

Rank by blast radius and reversibility, not by how easy the fix is:

| Tier | Use for | DevDigest examples |
|------|---------|--------------------|
| **P0** | Breaks an architectural boundary or a hard invariant; correctness/supply-chain risk | A deep relative import into another package's `src/` bypassing its public entry point; `reviewer-core` gaining an I/O dependency (breaks the pure-core rule); a known-vulnerable package |
| **P1** | Real cost or drift that will bite soon | The same dependency on different versions across packages (drift); a heavy dep with a lean alternative; a runtime dep declared in the wrong `dependencies`/`devDependencies` bucket |
| **P2** | Worth cleaning up; low urgency | A heuristically-unused dependency (needs confirmation); a large transitive tree behind a small feature |
| **Info** | Context, no action | Expected heavy tools (`next`, `playwright`); intended shared-code aliases working as designed |

Two rules that keep the tiers honest:

- **A finding without a tier is not a finding.** Never leave a bullet unranked; if you can't justify a
  tier, it's Info.
- **Internal coupling outranks weight.** A boundary violation (deep-relative import, core impurity) is
  P0 even if it costs zero bytes, because it's the expensive-to-reverse kind of problem. A heavy but
  correctly-isolated package is at most P1.

## Guardrails

- **Propose, don't perform.** Removal/upgrade/dedupe are recommendations the user confirms. The
  "unused" signal is a heuristic (it misses dynamic imports, re-exports, config-only use), so present
  it as "appears unused — verify" and never as an executed deletion.
- **Keep internal and external separate** in every section — they are different problem classes.
- **Respect the do-not-touch zones.** `server/src/vendor/shared/` and `db/migrations/` are shared/
  generated; flag coupling to them but don't propose editing them here.
- **Ground every claim.** Cite the file, `package.json`, or `du` line the finding rests on. If the data
  wasn't gathered (uninstalled package, skipped path), say so instead of guessing.

## Reference

- `references.md` — DevDigest dependency topology (who may depend on whom), the full finding taxonomy
  with rationale, and how to read installed sizes.
- `scripts/collect.sh` — the deterministic data collector run in Phase 1.
