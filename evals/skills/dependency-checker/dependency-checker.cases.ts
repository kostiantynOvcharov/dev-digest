import type { SkillCase } from "../../src/index.js";

// This skill's job is to analyze real files (package.json, tsconfig.json, node_modules sizes),
// but "quality" cases run with no tools (skillTask measures the SKILL.md content in isolation —
// see tasks.ts). So each prompt inlines a small synthetic dataset the skill can reason over
// directly, standing in for what the skill would normally gather itself with Read/Bash/Grep.
//
// The dataset deliberately plants one of each finding type the skill must catch, so the practices
// key off known-present issues (not the live repo, which drifts):
//   - version drift ......... three zod versions across server/client/reviewer-core
//   - unused dependency ..... moment declared in server, imported nowhere under server/src
//   - heavy dependency ...... next (132M) / playwright (210M) expected; date-fns (22M) notable
//   - deep-relative coupling  server → reviewer-core/src/pipeline.js (bypasses public entry) → P0
//   - reviewer-core purity ... reviewer-core gains simple-git (an I/O dep) → P0 "iron rule" break

const REPO_DATA = `Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

server/package.json dependencies: fastify@5.1.0, drizzle-orm@0.36.0, zod@3.23.8, pg@8.13.0, moment@2.30.1
server/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tsx@4.19.0
client/package.json dependencies: next@15.0.3, react@19.0.0, react-dom@19.0.0, @tanstack/react-query@5.59.0, zod@3.22.4, date-fns@4.1.0
client/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tailwindcss@3.4.14
reviewer-core/package.json dependencies: zod@3.23.8, simple-git@3.27.0
reviewer-core/package.json devDependencies: typescript@5.6.3
e2e/package.json dependencies: (none runtime)
e2e/package.json devDependencies: playwright@1.48.2, typescript@5.6.3

Installed sizes (du -sh):
server/node_modules/moment: 4.2M
server/node_modules/drizzle-orm: 8.1M
server/node_modules/fastify: 6.5M
server/node_modules/pg: 3.8M
server/node_modules/zod: 2.1M
client/node_modules/next: 132M
client/node_modules/react-dom: 6.9M
client/node_modules/date-fns: 22M
client/node_modules/zod: 1.9M
reviewer-core/node_modules/zod: 2.1M
reviewer-core/node_modules/simple-git: 1.4M
e2e/node_modules/playwright: 210M

server/package.json declares zod@3.23.8, client/package.json declares zod@3.22.4, reviewer-core/package.json declares zod@3.23.8 — three different resolved zod versions across packages.

Repo fact: this is NOT a monorepo workspace. Each package owns its own package.json + lockfile; cross-package code is shared via TypeScript path aliases, not workspace:* links. reviewer-core is the PURE review engine — it must not depend on any I/O library (fs, child_process, a DB driver, git).

grep for imports crossing package boundaries:
- server/src/routes/reviews.ts imports types from "@shared/review-types" (alias to server/src/vendor/shared)
- server/src/services/review-service.ts imports "reviewer-core/src/pipeline.js" directly by relative path (not via the package's public entry point)
- client/src/lib/api-types.ts imports "@shared/review-types" (same alias as server)
- reviewer-core/src/enrich.ts imports "simple-git" and calls it to shell out to git
- grep found no import of "moment" anywhere under server/src — only present in package.json`;

export const cases: SkillCase[] = [
  {
    // Structure adherence, checked deterministically (no judge): the anchors of the required
    // 5-section report must all be present. Cheap first gate — if the shape is wrong, fix that
    // before spending the judge on content.
    name: "output adheres to the required report structure (deterministic grounding)",
    kind: "grounding",
    prompt: `Run a full dependency check on this repo and produce the complete report.\n\n${REPO_DATA}`,
    grounding: ["Scope", "```mermaid", "flowchart", "Size Breakdown", "P0", "Summary"],
    maxTurns: 10,
  },
  {
    name: "full report follows the required 5-section structure with a Mermaid graph",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${REPO_DATA}`,
    grounding: ["```mermaid", "flowchart"],
    practices: [
      "the report has a 'Scope' section listing which packages (client, server, reviewer-core, e2e) were analyzed",
      "the report includes a Mermaid diagram (a fenced ```mermaid code block using flowchart) showing dependency relationships between packages",
      "the report has a 'Size Breakdown' section with a table showing dependencies and their installed size, not just a vague size statement",
      "the report has a 'Findings & Priorities' section (or equivalently named) that groups findings under explicit severity tiers such as P0, P1, P2, or Info — not an unranked bullet list",
      "the report ends with a Summary section giving 3-5 concrete, actionable takeaways ordered by priority",
      "every finding names a specific package, dependency, or file rather than giving generic advice like 'consider optimizing dependencies'",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "distinguishes internal (path-alias) dependencies from external npm dependencies",
    kind: "quality",
    prompt: `This repo isn't a monorepo — server, client, reviewer-core, and e2e share code via TypeScript path aliases, not workspace:* packages. Analyze our dependencies, including how these packages depend on each other internally.\n\n${REPO_DATA}`,
    practices: [
      "the answer explicitly distinguishes internal cross-package dependencies (the @shared/review-types alias and the direct relative import into reviewer-core/src/pipeline.js) from external npm package dependencies, rather than treating them as the same kind of dependency",
      "the answer flags server/src/services/review-service.ts importing reviewer-core/src/pipeline.js by relative path instead of through reviewer-core's public entry point as a P0-tier or otherwise explicitly called-out issue",
      "the answer does not claim these packages are linked via workspace:* or pnpm workspaces, since the project explicitly is not a monorepo",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "severity tiers are used consistently and recommendations are specific, not vague",
    kind: "quality",
    prompt: `We suspect some npm dependencies in server/ and client/ are unused or duplicated across packages with different versions. Check our dependencies and tell me what to prioritize fixing first.\n\n${REPO_DATA}`,
    practices: [
      "findings are explicitly labeled with one of the defined severity tiers (P0, P1, P2, or Info) rather than left unranked",
      "the three different zod versions across server, client, and reviewer-core are called out explicitly as version drift",
      "moment being declared in server/package.json but never imported anywhere under server/src is called out explicitly as an unused dependency",
      "each recommendation names a specific package name and package.json/file location (e.g. server/package.json, moment, zod) rather than a generic suggestion",
      "removing a dependency (e.g. moment) is presented as a recommendation for the user to confirm, not something already executed",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    // DevDigest's signature invariant: reviewer-core is the pure engine. A new I/O dependency
    // landing there is the highest-severity dependency finding the skill can make.
    name: "flags a new I/O dependency in the pure reviewer-core as a P0 purity break",
    kind: "quality",
    prompt: `Check our dependencies. Pay attention to reviewer-core — it's supposed to be our pure review engine.\n\n${REPO_DATA}`,
    practices: [
      "the answer flags reviewer-core depending on simple-git (an I/O / git-shelling library) as a violation of reviewer-core's purity, since the pure engine must not take an I/O dependency",
      "this reviewer-core purity break is ranked at the top severity tier (P0), not treated as a minor or size-only issue",
      "the recommendation is specific — it names reviewer-core/package.json and simple-git and proposes moving the git/IO work out of reviewer-core rather than giving generic advice",
      "the answer does not confuse this with mere package size; it is called out as an architectural/purity problem, and any removal is proposed for confirmation rather than presented as already done",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
