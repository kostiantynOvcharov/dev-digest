---
name: onion-architecture
description: "Enforces DevDigest's Onion Architecture across the backend packages (server/ and reviewer-core/). Use when adding or changing a backend module, deciding where code belongs (route vs service vs repository vs adapter vs contract), wiring a dependency, reviewing imports, or fixing a `pnpm arch:check` / dependency-cruiser boundary failure. Covers the four layers (domain core → application → infrastructure → presentation), the inward dependency rule, the DI container as composition root, the repository + workspace-scoping pattern, the pure reviewer-core engine, and how the boundaries are machine-enforced. Trigger terms: onion architecture, clean architecture, layering, dependency rule, boundary violation, arch:check, dependency-cruiser, new backend module, service, repository, adapter, container, vendor/shared, server/src/modules, reviewer-core."
metadata:
  tags: architecture, onion, clean-architecture, backend, fastify, drizzle, dependency-injection, layering, dependency-cruiser
---

## When to use

Use this skill whenever you work in `server/` or `reviewer-core/` and need to:

- Add a new backend feature/module and place its files in the right layer.
- Decide where a piece of code belongs (HTTP handling? orchestration? a DB query? external I/O? a contract?).
- Wire a new dependency (a repository, an adapter, an LLM/GitHub/git client).
- Review a diff for layering violations, or fix a failing `pnpm arch:check`.
- Understand why an import is forbidden by `dependency-cruiser`.

Do **not** apply these rules to `client/` (Next.js frontend) — see `react-frontend-best-practices` for that.

## The one rule

> **Dependencies point inward. An outer layer may import an inner layer; an inner layer must never import an outer one.**

```
            ┌─────────────────────────────────────────────────────────────┐
PRESENTATION│ modules/<m>/routes.ts · app.ts · server.ts                    │  HTTP, Fastify, Zod I/O
            │      ↓ calls services only                                    │
APPLICATION │ modules/<m>/service.ts · platform/{container,jobs,sse}.ts     │  orchestration + DI
            │      ↓ calls repositories + adapter INTERFACES                │
INFRASTRUCT.│ modules/<m>/repository.ts · db/* · adapters/*                 │  Drizzle, external I/O
            │      ↓ imports contracts + drizzle only                       │
DOMAIN CORE │ vendor/shared/* (Zod contracts + adapter interfaces)          │  pure types & rules
            │ reviewer-core/* (pure review engine — NO I/O)                 │
            └─────────────────────────────────────────────────────────────┘
        Everything may import the DOMAIN CORE. That is the whole point.
```

The canonical inward call chain (study `modules/agents/`):
`routes.ts` → `service.ts` → `repository.ts` → `db/schema.ts`, with everyone importing
contracts from `@devdigest/shared` (which resolves to `vendor/shared/`).

## Reading order

- **New here / placing a file?** → `rules/layers.md` → `rules/dependency-rule.md`
- **Adding a module?** → `rules/adding-a-module.md` (the 5-file recipe)
- **Writing a service / wiring a dependency?** → `rules/application-services.md` → `rules/dependency-injection.md`
- **Writing a DB query?** → `rules/infrastructure.md` (repository + workspace guard)
- **Writing an endpoint?** → `rules/presentation.md`
- **Defining a contract / working in reviewer-core?** → `rules/domain-core.md`
- **`arch:check` failed / want to understand enforcement?** → `rules/enforcement.md`

## How it is enforced

This is not advisory. `dependency-cruiser` checks the boundaries on every CI run:

```sh
cd server        && pnpm arch:check    # 4-layer onion
cd reviewer-core && npm  run arch:check # the pure-core "iron rule"
```

Configs: `server/.dependency-cruiser.cjs`, `reviewer-core/.dependency-cruiser.cjs`.
Error-severity rules fail the build; warn-severity rules document grandfathered debt.
See `rules/enforcement.md` for the rule list and how to read a violation.

## Rule files

- [rules/layers.md](rules/layers.md) — the four layers and what lives in each
- [rules/dependency-rule.md](rules/dependency-rule.md) — the inward rule + allowed/forbidden import matrix
- [rules/domain-core.md](rules/domain-core.md) — `vendor/shared` contracts + reviewer-core purity
- [rules/application-services.md](rules/application-services.md) — services orchestrate; depend on interfaces
- [rules/infrastructure.md](rules/infrastructure.md) — repositories, `db/`, adapters, the workspace guard
- [rules/presentation.md](rules/presentation.md) — routes: Zod at the boundary, `getContext`, delegate
- [rules/dependency-injection.md](rules/dependency-injection.md) — the container as composition root + test seam
- [rules/adding-a-module.md](rules/adding-a-module.md) — the canonical recipe for a new module
- [rules/enforcement.md](rules/enforcement.md) — dependency-cruiser rules + how to run/read them
- [references.md](references.md) — articles and sources behind these conventions
