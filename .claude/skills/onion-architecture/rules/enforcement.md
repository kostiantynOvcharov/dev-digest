# Enforcement — dependency-cruiser

The boundaries are checked by machine, not by reviewer goodwill. `dependency-cruiser` analyses
the import graph and fails the build on inward-rule violations. `dependency-cruiser` was already
a `server/` dependency (the repo-intel indexer uses it to build import graphs); this reuses it to
lint the codebase's own architecture.

## Run it

```sh
cd server         && pnpm arch:check     # the 4-layer onion
cd reviewer-core  && npm  run arch:check  # the pure-core "iron rule"
```

`pnpm arch:graph` (server) emits a Mermaid dependency graph if you want to see the wiring.
Both checks run in CI: the `arch` job in `.github/workflows/server-unit.yml` and a step in
`reviewer-core.yml`. **Error-severity** violations fail CI; **warn-severity** ones are reported
but don't fail.

## Server rules (`server/.dependency-cruiser.cjs`)

| Rule | Severity | Forbids |
|------|----------|---------|
| `core-stays-pure` | error | `vendor/shared/**` importing `db/`, `adapters/`, `modules/`, `platform/`, or infra libs (`fastify`, `drizzle-orm`, `postgres`, …) |
| `service-no-direct-db` | error | `modules/*/service.ts` importing `db/client`, `db/schema`, or `drizzle-orm` (row types from `db/rows` are fine) |
| `repository-no-adapters` | error | `modules/*/repository.ts` (or `repository/`) importing `adapters/` |
| `no-cross-module-internals` | error | a module importing another module's `service.ts`/`repository.ts` |
| `route-no-direct-db` | error | a **non-thin** module's `routes.ts` importing `db/` or `drizzle-orm` |
| `route-direct-db-legacy` | warn | the four thin modules (`settings`, `pulls`, `polling`, `workspace`) querying Drizzle from routes — tracked debt |
| `service-prefers-injected-adapters` | warn | a service importing a concrete `adapters/` module instead of using a container interface (repo-intel indexer) |
| `no-circular` | error | runtime import cycles |

Known warnings on `main` (expected, do not increase): the 4 `route-direct-db-legacy` hits and the
2 `service-prefers-injected-adapters` hits in repo-intel. **A new error is a hard stop.**

## reviewer-core rules (`reviewer-core/.dependency-cruiser.cjs`)

| Rule | Severity | Forbids |
|------|----------|---------|
| `core-no-io-libraries` | error | `src/**` importing `drizzle-orm`/`postgres`, `octokit`/`simple-git`, `fastify`, `axios`/`node-fetch` |
| `core-no-node-io-builtins` | error | `src/**` importing Node I/O builtins (`fs`, `child_process`, `net`, `http(s)`, `dns`, …) |
| `no-circular` | error | runtime import cycles |

reviewer-core is clean (0 violations) and must stay that way — it's the iron rule.

## Reading a violation

```
  error service-no-direct-db: src/modules/agents/service.ts → src/db/client.ts
```

Read it as: *file on the left broke rule `service-no-direct-db` by importing the file on the
right.* Look the rule up in the table, then apply the fix from
`rules/dependency-rule.md` (here: move the query into `agents/repository.ts` and call it from the
service). Re-run `pnpm arch:check` until 0 errors.

## Design notes (so you can change the rules safely)

- **Runtime imports only.** Both configs set `tsPreCompilationDeps: false`, so `import type { … }`
  edges are ignored — the onion constrains runtime coupling, and counting type-only edges flags
  harmless cycles (e.g. `helpers` ⇄ `repository` on a row type, or the `container` ⇄ `service`
  DI root).
- **The composition root is exempt.** No rule uses `platform/` as a `from`, so
  `platform/container.ts` may wire adapters, repositories, and services.
- **Graduating debt.** When a thin module is lifted to `routes → service → repository`, remove it
  from `THIN_MODULES` in `server/.dependency-cruiser.cjs` so `route-no-direct-db` (error) covers
  it. Goal state: no warn-level rules remain.
