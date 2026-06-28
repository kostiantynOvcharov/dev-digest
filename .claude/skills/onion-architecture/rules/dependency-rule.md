# The dependency rule

> **Nothing in an inner layer may know anything about an outer layer.** Source code
> dependencies point only inward.

This is the entire architecture in one sentence. Everything else is a consequence.

## Import matrix

Rows are the file doing the importing; ✅ = allowed, ❌ = forbidden (and machine-checked).

| From ↓ \ To → | `vendor/shared` (core) | `db/`, `adapters/` (infra) | `modules/<m>/repository.ts` | `modules/<m>/service.ts` | `drizzle-orm` |
|---|---|---|---|---|---|
| **routes.ts** (presentation) | ✅ | ❌ (use a service) | ❌ | ✅ same module | ❌ |
| **service.ts** (application) | ✅ | ✅ adapter *interface* via container | ✅ same module | ✅ same module | ❌ (go via repo) |
| **repository.ts** (infra) | ✅ | ❌ adapters | — | ❌ | ✅ |
| **vendor/shared** (core) | ✅ within core | ❌ | ❌ | ❌ | ❌ |
| **platform/container.ts** | ✅ | ✅ (composition root — wires everything) | ✅ | ✅ | n/a |

Two deliberate carve-outs:

- **`platform/container.ts` may import anything.** It is the composition root; wiring
  adapters, repositories, and services together is its only job. See `rules/dependency-injection.md`.
- **Importing a row *type* from `db/rows.ts` is fine** even from a service — those are
  contract types, not a query path. The check forbids `db/client` and `db/schema`
  (the runtime query surface), not `db/rows`.

## Why inward-only

- **The core is testable in isolation.** `reviewer-core` and `vendor/shared` have no DB, no
  network, no Fastify — you test pure functions with plain inputs.
- **Infrastructure is swappable.** The database, the LLM vendor, the git client are details
  behind interfaces. Tests inject mocks via `ContainerOverrides`; production injects the real
  adapter. Neither the service nor the core changes.
- **Modules stay isolated.** A feature is one folder plus one line in `modules/index.ts`. It
  never reaches into a sibling module's internals.

## ❌ → ✅ quick fixes

| Smell | Fix |
|-------|-----|
| `routes.ts` does `db.select()...` | Move the query into a `repository.ts`; have the route call a `service.ts` method |
| `service.ts` imports `drizzle-orm` | Add the query to the repository; the service calls the repo |
| `service.ts` does `new OctokitGitHubClient()` | Depend on the `GitHubClient` interface; get it from `container.github()` |
| `repository.ts` imports from `adapters/` | That work belongs in a service coordinating a repo + an adapter |
| `vendor/shared` imports from `db/` or `fastify` | The contract is leaking infra; keep it pure types + zod |
| module A imports `modules/B/service.ts` | Use a shared contract, or expose the dependency on the container (`container.agentsRepo`) |

Every row above maps to a named `dependency-cruiser` rule — see `rules/enforcement.md`.
