/**
 * Onion Architecture boundary enforcement for @devdigest/api.
 *
 * Encodes the inward dependency rule: outer layers may depend on inner layers,
 * never the reverse.
 *
 *   PRESENTATION  src/modules/<m>/routes.ts · app.ts · server.ts
 *        ↓ (calls services)
 *   APPLICATION   src/modules/<m>/service.ts · src/platform/*
 *        ↓ (calls repositories + adapter INTERFACES)
 *   INFRASTRUCTURE src/modules/<m>/repository.ts · src/db/* · src/adapters/*
 *        ↓ (imports contracts + drizzle only)
 *   DOMAIN CORE   src/vendor/shared/* (Zod contracts + adapter interfaces)
 *
 * Everything may depend on the DOMAIN CORE (src/vendor/shared) — that is the point.
 * src/platform/container.ts is the composition root: it is deliberately allowed to
 * import adapters, repositories and module services to wire them together, so no
 * rule below uses src/platform as a `from`.
 *
 * Run: `pnpm arch:check`. See .claude/skills/onion-architecture for the why.
 *
 * Severity legend:
 *   error — invariant the whole codebase already satisfies; breaking it fails CI.
 *   warn  — a target pattern with known, grandfathered debt; new code should avoid it.
 */

/** Thin, pre-onion modules whose routes still query Drizzle inline (tech debt). */
const THIN_MODULES = '^src/modules/(settings|pulls|polling|workspace)/';

/** The runtime database surface a layer is not allowed to touch directly. */
const DB_RUNTIME = ['^src/db/client', '^src/db/schema', 'drizzle-orm'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-stays-pure',
      severity: 'error',
      comment:
        'Domain core (src/vendor/shared) is the innermost layer: pure Zod contracts + ' +
        'adapter interfaces. It must not import any outer layer or infra library. ' +
        'Depend on the core from the outside in, never the reverse.',
      from: { path: '^src/vendor/shared' },
      to: {
        path: [
          '^src/db',
          '^src/adapters',
          '^src/modules',
          '^src/platform',
          'fastify',
          'drizzle-orm',
          'postgres',
          'octokit',
          'simple-git',
        ],
      },
    },
    {
      name: 'service-no-direct-db',
      severity: 'error',
      comment:
        'A service orchestrates business logic; it must reach the database through a ' +
        'repository, never the Drizzle client/schema directly. (Importing row TYPES ' +
        'from src/db/rows is fine — those are part of the contract, not a query path.)',
      from: { path: '^src/modules/[^/]+/service\\.ts$' },
      to: { path: DB_RUNTIME },
    },
    {
      name: 'repository-no-adapters',
      severity: 'error',
      comment:
        'A repository is pure persistence. External I/O (LLM, git, GitHub, …) belongs ' +
        'in an adapter reached via a service, not from the repo.',
      from: { path: '^src/modules/[^/]+/(repository\\.ts$|repository/)' },
      to: { path: '^src/adapters' },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'Modules are isolated. Import another module only via shared contracts or the ' +
        'container (cross-cutting repos are exposed as container.agentsRepo / ' +
        '.reviewRepo; repo-intel via container.repoIntel) — never reach into a sibling ' +
        "module's service.ts/repository.ts.",
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(service|repository)',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'route-no-direct-db',
      severity: 'error',
      comment:
        'A route handler (presentation) must delegate to a service/repository, not ' +
        'query Drizzle directly. New modules must be layered. (The four thin modules ' +
        'in THIN_MODULES predate this and are tracked separately as warnings.)',
      from: {
        path: '^src/modules/[^/]+/routes\\.ts$',
        pathNot: THIN_MODULES,
      },
      to: { path: DB_RUNTIME },
    },
    {
      name: 'route-direct-db-legacy',
      severity: 'warn',
      comment:
        'Known debt: this thin module queries Drizzle straight from its route. Acceptable ' +
        'for now; migrate to routes → service → repository to clear the warning.',
      from: { path: THIN_MODULES + '.*routes\\.ts$' },
      to: { path: DB_RUNTIME },
    },
    {
      name: 'service-prefers-injected-adapters',
      severity: 'warn',
      comment:
        'Prefer adapters injected through the container (depend on the interface in ' +
        'vendor/shared) over importing a concrete adapter module. repo-intel’s indexer ' +
        'imports astgrep/codeindex helpers directly — acknowledged exception.',
      from: { path: '^src/modules/[^/]+/service\\.ts$' },
      to: { path: '^src/adapters' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies break the inward-only layering and hurt testability.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Follow RUNTIME imports only. `import type { … }` edges are erased at compile
    // time and create no runtime coupling, so they are irrelevant to the onion's
    // inward dependency rule — and counting them flags harmless type-only cycles
    // (e.g. helpers ⇄ repository on a row type, or the container ⇄ service DI root).
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    includeOnly: '^src',
    exclude: { path: '\\.(test|spec)\\.ts$|^src/db/migrations' },
  },
};
