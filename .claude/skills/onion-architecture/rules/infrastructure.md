# Infrastructure — repositories, db, adapters

Infrastructure is where the application touches the outside world: the database (repositories +
`db/`) and external systems (`adapters/`). It implements the interfaces declared in the core.

## Repositories: the only place SQL lives

A repository owns a small set of tables and exposes typed methods. It is the **only** layer
allowed to import `drizzle-orm` and `db/schema`. From `modules/agents/repository.ts`:

```ts
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export class AgentsRepository {
  constructor(private db: Db) {}

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }
}
```

Rules:

- **Constructor takes `Db`** (the Drizzle client), nothing else.
- **No adapter imports.** A repository talks to the database only; it must not import from
  `adapters/`. External I/O is a service's job, coordinating a repo + an adapter.
  (Enforced: `repository-no-adapters`.)
- **Returns row types** (`AgentRow` from `db/rows.ts`), not HTTP DTOs. The service maps rows → DTOs.

## The workspace guard (multi-tenancy)

Every domain table has a `workspace_id`, and **every** repository `where` clause includes it:

```ts
async deleteById(workspaceId: string, id: string): Promise<boolean> {
  const rows = await this.db
    .delete(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
    .returning({ id: t.agents.id });
  return rows.length > 0;   // false ⇒ no such agent IN THIS WORKSPACE
}
```

Why it matters: `workspaceId` is resolved once at the HTTP boundary (`getContext`) and threaded
inward through service → repository. Even if a handler forgets a check, a scoped query returns
zero rows rather than leaking another tenant's data. Never write a domain query without the
`workspaceId` predicate.

## Adapters: external systems behind interfaces

Every external call (LLM, GitHub, git, code search, embeddings, secrets, auth) lives under
`adapters/<kind>/` and implements an interface from `vendor/shared/adapters.ts`:

| Interface (core) | Concrete adapter (infra) |
|---|---|
| `LLMProvider` | `adapters/llm/openai.ts`, `adapters/llm/anthropic.ts` |
| `GitHubClient` | `adapters/github/octokit.ts` |
| `GitClient` | `adapters/git/simple-git.ts` |
| `CodeIndex` | `adapters/codeindex/ripgrep.ts` |
| `SecretsProvider` / `AuthProvider` | `adapters/secrets/local.ts`, `adapters/auth/local.ts` |

Adapters are constructed and handed out by the container, never `new`-ed inside a service. To
add a new external dependency:

1. Declare the interface in `vendor/shared/adapters.ts` (what the app needs).
2. Implement it under `adapters/<kind>/` (how it's done for the real system).
3. Expose it on the `Container` and add it to `ContainerOverrides` for test mocks
   (see `rules/dependency-injection.md`).

This keeps the vendor/SDK out of the domain entirely — the rest of the code only knows the
interface, so swapping the implementation is a one-line change in the container.

## Don't

- ❌ Put a query in `routes.ts` (the thin modules that do this are grandfathered debt, not a model).
- ❌ Import `adapters/` from a repository.
- ❌ Return raw Drizzle rows from a route — map to a contract DTO in the service first.
- ❌ Hand-write a migration. Edit `db/schema/*.ts`, then `pnpm db:generate` (drizzle-kit) generates it.
