# Recipe — adding a backend module

A feature is a self-contained folder under `server/src/modules/<name>/` plus **one line** in the
module registry. New modules are **layered** (`routes → service → repository`) — copy the
`agents` module, not a thin one.

## The files (mirror `modules/agents/`)

```
server/src/modules/<name>/
├── routes.ts        # Presentation — Fastify plugin (default export). Zod schemas, getContext, calls service.
├── service.ts       # Application — <Name>Service(container). Orchestrates; owns the repository.
├── repository.ts    # Infrastructure — <Name>Repository(db). Drizzle queries, workspace-scoped.
├── helpers.ts        # Domain — pure transforms (row → DTO), pure decisions. No I/O. (optional)
└── constants.ts      # Domain — literals/defaults. (optional)
```

Skip `service.ts`/`repository.ts` only for a genuinely trivial read — but the default is the full
stack, and `arch:check` will **error** if a non-grandfathered route queries the DB directly.

## Steps

1. **Contracts first.** If the feature has new request/response shapes shared with the client,
   add Zod schemas to `vendor/shared/contracts/<area>.ts` and `z.infer` their types. Remember the
   shared folder is two hand-maintained copies (server + client) — edit both.

2. **Repository** (`repository.ts`). `constructor(private db: Db)`. One method per query, each
   `where` including `workspaceId`. Return row types from `db/rows.ts`. Import `drizzle-orm` and
   `db/schema` here — and only here. New tables: add to `db/schema/*.ts`, then `pnpm db:generate`.

3. **Service** (`service.ts`). `constructor(private container: Container)`; build the repo from
   `container.db`. Methods take `workspaceId` first, call the repo, map rows → contract DTOs via
   helpers. External calls go through `container.<adapter>` interfaces.

4. **Routes** (`routes.ts`). `export default async function <name>Routes(appBase)`. Declare Zod
   `schema` per route, call `getContext` for tenancy, construct the service from `app.container`,
   map domain `undefined`/`false` to `NotFoundError` etc.

5. **Register it.** Add one import + one entry to `server/src/modules/index.ts`:

   ```ts
   import myfeature from './myfeature/routes.js';
   export const modules: Record<string, FastifyPluginAsync> = {
     settings, repos, pulls, polling, workspace, agents, reviews, repoIntel,
     myfeature,   // ← here
   };
   ```

   (Registration is static, not filesystem autoload — see the comment in `index.ts`.)

6. **Cross-cutting data?** If your service needs another module's data, use the container
   (`container.agentsRepo`, `container.reviewRepo`, `container.repoIntel`) — never import a
   sibling module's `service.ts`/`repository.ts`.

7. **Verify.** `pnpm typecheck && pnpm arch:check && pnpm test`. The arch check must stay at
   **0 errors**.

## Conventions that aren't obvious

- ESM: relative imports carry the `.js` extension (`./service.js`), even from `.ts` source.
- `repo-intel` is reached **only** via the `container.repoIntel` facade — never touch its pipeline.
- Context enrichment is best-effort: on error/unindexed, omit the section, don't throw.
- New columns = your own migration only; never hand-edit `db/migrations/` or `vendor/shared/`
  outside the documented two-copy sync.
