# Layers — what lives where

DevDigest's backend is an onion of four layers. Each row below names the layer, the
directories that belong to it, its single responsibility, and what it is allowed to
import. **Dependencies point inward only.**

| Layer | Lives in | Responsibility | May import |
|-------|----------|----------------|------------|
| **Presentation** | `server/src/modules/<m>/routes.ts`, `app.ts`, `server.ts` | HTTP: parse/validate the request (Zod), resolve tenancy, call a service, shape the response | Application (services), Domain core |
| **Application** | `server/src/modules/<m>/service.ts`, `platform/container.ts`, `platform/jobs.ts`, `platform/sse.ts` | Orchestrate business logic; compose repositories + adapter **interfaces**; own DI wiring | Infrastructure (repos, adapter interfaces), Domain core |
| **Infrastructure** | `server/src/modules/<m>/repository.ts`, `db/*`, `adapters/*` | Persistence (Drizzle, workspace-scoped) and external I/O (LLM, GitHub, git, codeindex) behind interfaces | Domain core (contracts + drizzle) |
| **Domain core** | `server/src/vendor/shared/*` (Zod contracts + adapter interfaces), `reviewer-core/*` (pure engine) | Pure types, contracts, and pure logic. The center of the onion | Nothing inward of it — only `zod` |

## The representative module: `agents/`

`server/src/modules/agents/` is the reference implementation — every layer present, nothing skipped:

| File | Layer | What it does |
|------|-------|--------------|
| `routes.ts` | Presentation | 10 Fastify routes; validates bodies/params with Zod, calls `AgentsService` |
| `service.ts` | Application | `AgentsService` — list/get/create/update/version/skills; owns an `AgentsRepository` |
| `repository.ts` | Infrastructure | `AgentsRepository` — Drizzle queries over `agents`/`agent_versions`/`agent_skills`, workspace-scoped |
| `helpers.ts` | Domain (pure) | `toAgentDto`, `isConfigChange` — pure transforms, "No I/O" (see its own header comment) |
| `constants.ts` | Domain (pure) | `DEFAULT_AGENT_DESCRIPTION`, `INITIAL_AGENT_VERSION` |

The inward call chain is literal:
`routes.ts` (`new AgentsService(app.container)`) → `service.ts` (`new AgentsRepository(container.db)`) → `repository.ts` (`this.db.select().from(t.agents)`) → `db/schema.ts`.

## Two shapes of module (both legitimate today)

- **Layered** — `agents`, `repos`, `reviews`, `repo-intel`: full `routes → service → repository`.
  This is the target for all **new** modules.
- **Thin** — `settings`, `pulls`, `polling`, `workspace`: `routes.ts` only, querying Drizzle inline.
  These predate the onion. They are **grandfathered** (warn-level in the arch check), not a
  pattern to copy. If you extend one materially, lift it to the layered shape.

## Where do "leaf" files go?

- Pure transforms / DTO mapping / decision functions → `helpers.ts` (Domain). Must have no I/O.
- Magic numbers / default strings / enums-of-literals → `constants.ts` (Domain).
- A cross-cutting type shared between client and server → a contract in `vendor/shared/contracts/`.
- An external call (HTTP, shell, SDK) → a new file under `adapters/<kind>/`, behind an interface
  declared in `vendor/shared/adapters.ts` (Infrastructure implementing a Domain interface).

See `rules/dependency-rule.md` for the precise allowed/forbidden import matrix, and
`rules/adding-a-module.md` for the file-by-file recipe.
