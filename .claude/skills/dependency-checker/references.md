# dependency-checker — reference

Background the SKILL.md points at: the DevDigest dependency topology, the finding taxonomy that
turns raw data into ranked findings, and how to read installed sizes. Load this when you need the
*why* behind a classification or severity call.

## Table of contents

1. [Dependency topology — who may depend on whom](#1-dependency-topology)
2. [Finding taxonomy — the six things to look for](#2-finding-taxonomy)
3. [Reading installed sizes](#3-reading-installed-sizes)
4. [Mermaid graph conventions](#4-mermaid-graph-conventions)

---

## 1. Dependency topology

DevDigest is **not** a pnpm/npm workspace. Each package below owns its own `package.json` and
lockfile; there are no `workspace:*` links. Cross-package code travels through **TypeScript path
aliases** resolved at compile time, plus a couple of deliberate two-copy contracts.

| Package | npm name | Role | Notable external deps |
|---------|----------|------|-----------------------|
| `client/` | `@devdigest/web` | Next.js frontend | next, react, react-dom, mermaid, recharts, @tanstack/react-query |
| `server/` | `@devdigest/api` | Fastify backend | fastify, drizzle-orm, postgres, @anthropic-ai/sdk, octokit, simple-git |
| `reviewer-core/` | `@devdigest/reviewer-core` | **Pure** review engine — no I/O | openai, zod only |
| `e2e/` | `@devdigest/e2e` | End-to-end tests | (no runtime deps) |
| `devdigest-mcp/` | `@devdigest/mcp` | MCP server | @modelcontextprotocol/sdk, zod |
| `evals/` | `@devdigest/evals` | Harness evals | @anthropic-ai/claude-agent-sdk, openai |

**Sanctioned internal links (expected — Info, not a problem):**

- `@shared/*` / `@devdigest/shared` → `server/src/vendor/shared/` (Zod contracts + adapter
  interfaces). Both `server` and `client` import types from here by alias. This is the intended
  shared-contract seam.
- `@/*` → a package-local `src` root (Next.js / server internal alias). Local, not cross-package.

**The two hard rules a dependency finding may expose:**

1. **`reviewer-core` stays pure.** It may depend only on pure libraries (zod, openai's types) and
   must never gain an I/O dependency (`fs`, `child_process`, `simple-git`, a DB driver, Fastify).
   A new I/O dependency landing in `reviewer-core/package.json` or an I/O import in its `src/` is a
   **P0** — it breaks the "iron rule" that keeps the engine testable and portable.
2. **Reach a package through its public entry, not its `src/`.** A deep relative import like
   `server/src/services/review-service.ts` → `../../reviewer-core/src/pipeline.js` couples `server`
   to `reviewer-core`'s *internals*, defeating the package boundary and the alias seam. That is a
   **P0** coupling finding even though it adds zero bytes, because it's expensive to reverse and
   silently spreads.

`server/src/vendor/shared/` and `server/src/db/migrations/` are **do-not-touch** (shared / generated).
Flag coupling *to* them, but never propose editing them from this skill.

## 2. Finding taxonomy

Six recurring finding types. For each: what it is, how the collector surfaces it, and the default
tier (adjust up/down with the rubric in SKILL.md).

### a. Unused dependency — default **P2**
A package listed in `dependencies` but never imported under that package's `src/`. Surfaced by the
"POSSIBLY-UNUSED" block. **Heuristic** — it misses dynamic `import()`, re-exports, and config-only
tools. Always present as "appears unused — verify" and propose removal for confirmation; never assert
it's dead. Escalate to P1 only if it's also large or a supply-chain concern.

### b. Duplicate / version drift — default **P1**
The same dependency resolved to different versions across packages (e.g. `zod@3.23.8` in server,
`zod@3.22.4` in client). Surfaced by the "VERSION DRIFT" block. Costs disk (multiple copies), risks
subtle type/behavior mismatches across the alias seam, and complicates upgrades. Recommend aligning
on one version. Not P0 — it rarely breaks correctness outright.

### c. Heavy dependency — default **P1**, often **Info**
A dependency whose installed size is large relative to the value it delivers. Judge *relative to
role*: `next` (~130M) and `playwright` (~200M) are expected heavyweights → **Info**. A 22M date
library used for one format call, or `moment` (a large, legacy-API lib with lean modern
alternatives), is a real **P1**. Weight alone is never P0.

### d. Deep-relative cross-package coupling — **P0**
An import climbing `../` into a sibling package's `src/`. Surfaced by the "deep relative imports"
line of the internal-imports block. Breaks the package boundary; see topology rule 2.

### e. reviewer-core purity break — **P0**
An I/O dependency in `reviewer-core/package.json` or an I/O import in `reviewer-core/src/`. See
topology rule 1.

### f. Misplaced dependency (dev vs runtime) — default **P1**
A build/test-only tool in `dependencies` (ships to production for nothing), or a genuinely
imported-at-runtime package hiding in `devDependencies` (risks a broken production install). Cross
the declared bucket against where the import actually appears.

## 3. Reading installed sizes

- `du -sh <pkg>/node_modules/*` gives the **on-disk** size of each installed top-level package,
  including its own files but *not* its de-duplicated transitive deps hoisted to the root. It's the
  honest "what this costs on disk here" number — good enough for prioritization, not a bundle-size
  measurement.
- **On-disk ≠ shipped bundle.** A 132M `next` install is mostly toolchain that never ships to the
  browser; a 2M client-bundled lib can matter more for page weight. When the user's concern is the
  *browser bundle* specifically, say the du number is install size and note that bundle impact needs
  a bundler report — don't conflate them.
- Sort largest-first and show a per-package total so the reader sees where the mass actually sits.
- If `node_modules` isn't installed, sizes are unavailable — say so in the Size Breakdown; do not
  invent numbers.

## 4. Mermaid graph conventions

- `flowchart LR` (or `TD`) with one node per DevDigest package.
- **Edges = internal links only** — draw them between packages and label how they link:
  `-->|@shared alias|` for a sanctioned alias, and a distinct style (e.g. a thick/red edge) for a
  deep-relative boundary break so a P0 is visible in the picture.
- Attach a handful of the heaviest/notable **external** deps as leaf nodes off their owning package,
  in a different `classDef` from packages, so weight and topology read at a glance without dumping
  every npm package into the graph.
- Never draw a `workspace:*` edge — there are none in this repo.

Example shape (illustrative — fill with real data):

```mermaid
flowchart LR
  classDef pkg fill:#1f2937,stroke:#60a5fa,color:#fff;
  classDef ext fill:#374151,stroke:#9ca3af,color:#ddd,stroke-dasharray:3 3;

  client["client (@devdigest/web)"]:::pkg
  server["server (@devdigest/api)"]:::pkg
  core["reviewer-core"]:::pkg
  shared["vendor/shared (contracts)"]:::pkg

  client -->|@shared alias| shared
  server -->|@shared alias| shared
  server -.->|"deep ../reviewer-core/src (P0 boundary break)"| core

  next(["next ~132M"]):::ext
  client --- next
```
