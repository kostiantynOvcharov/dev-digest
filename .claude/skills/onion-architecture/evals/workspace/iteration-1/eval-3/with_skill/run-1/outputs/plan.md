# DevDigest `webhooks` module — implementation plan

A workspace-scoped feature that (a) persists webhook subscriptions in Postgres and (b) calls
GitHub to register the hook on the repo when a subscription is created. It follows DevDigest's
Onion Architecture: `routes → service → repository`, everyone depending on contracts from
`@devdigest/shared`, external I/O behind an adapter interface obtained from the container.

The canonical model to copy is `server/src/modules/agents/` — do **not** copy a thin module
(`settings`, `pulls`, `polling`, `workspace`) because those query Drizzle from `routes.ts` and are
grandfathered debt that `arch:check` only warns on. A new module must use the full stack or
`arch:check` will **error** (`route-no-direct-db`, `service-no-direct-db`).

The inward call chain and dependency rule (dependencies point inward only):

```
routes.ts    (presentation)  → Zod validation, getContext tenancy, maps domain result → HTTP
   ↓ calls service only
service.ts   (application)    → orchestrates: owns repo, calls container.github(), maps rows→DTO
   ↓ calls repository + adapter INTERFACE
repository.ts(infrastructure)→ Drizzle only, every WHERE includes workspaceId
   ↓ imports contracts + drizzle
db/schema    +  vendor/shared/contracts  (domain core — pure zod + interfaces)
```

---

## Files to create / edit

### 1. Contracts (domain core) — `vendor/shared/contracts/webhooks.ts` (NEW, ×2 copies)

Shared request/response shapes live in `vendor/shared/` as **Zod schemas** that are the single
source of truth for both the runtime validator and the TypeScript type (`z.infer`). Create a new
contract file (or add to the closest existing area file):

```ts
import { z } from 'zod';

export const WebhookEvent = z.enum(['push', 'pull_request', 'issues']); // adjust to needs
export type WebhookEvent = z.infer<typeof WebhookEvent>;

export const WebhookSubscription = z.object({
  id: z.string(),
  repoId: z.string(),          // or owner/name — match how repos are identified in this codebase
  events: z.array(WebhookEvent),
  targetUrl: z.string().url(),
  active: z.boolean(),
  githubHookId: z.number().nullish(), // id GitHub returns after registration
  createdAt: z.string(),
});
export type WebhookSubscription = z.infer<typeof WebhookSubscription>;

export const CreateWebhookSubscription = z.object({
  repoId: z.string(),
  events: z.array(WebhookEvent).min(1),
  targetUrl: z.string().url(),
});
export type CreateWebhookSubscription = z.infer<typeof CreateWebhookSubscription>;
```

Critical constraints:
- A contract is **pure zod + types only**. It must NOT import `db/`, `adapters/`, `modules/`,
  `platform/`, `fastify`, or `drizzle-orm` (enforced: `core-stays-pure`). Do not put a `workspaceId`
  in the response DTO unless the client needs it — tenancy is a server concern.
- `vendor/shared/` is **two hand-maintained copies** resolved by tsconfig path alias, NOT
  auto-synced. Add this file to **both** `server/src/vendor/shared/contracts/webhooks.ts` **and**
  `client/src/vendor/shared/contracts/webhooks.ts` in lock-step (the only diff between them is
  comments). Export it from the shared barrel the same way the other contracts are exported so it
  resolves as `@devdigest/shared`.
- Never hand-write a TS `interface` for a shape that has a schema — always `z.infer`.

### 2. DB schema + migration (infrastructure/core)

Add a `webhook_subscriptions` table to `server/src/db/schema/*.ts` (a new file, e.g.
`webhooks.ts`, imported by the schema barrel — follow how existing tables are organized). Every
domain table carries a `workspace_id`; this one must too:

```ts
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),   // ← mandatory tenant column
  repoId: uuid('repo_id').notNull(),
  events: jsonb('events').$type<string[]>().notNull(),
  targetUrl: text('target_url').notNull(),
  githubHookId: bigint('github_hook_id', { mode: 'number' }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Then add the corresponding **row type** to `server/src/db/rows.ts` (e.g.
`WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect`). Repositories return row
types; the service maps rows → the contract DTO.

Generate the migration — **do not hand-write it**:

```sh
cd server && pnpm db:generate    # drizzle-kit produces the SQL under db/migrations/
```

Never hand-edit `db/migrations/` (do-not-touch). The generator writes it from your schema edit.

### 3. Repository (infrastructure) — `server/src/modules/webhooks/repository.ts` (NEW)

The only place SQL for these tables lives. `constructor(private db: Db)`, nothing else. Import
`drizzle-orm` and `db/schema` here and **only** here. It must NOT import from `adapters/`
(enforced: `repository-no-adapters`) — external I/O is the service's job.

```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { WebhookSubscriptionRow } from '../../db/rows.js';

export class WebhooksRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<WebhookSubscriptionRow[]> {
    return this.db.select().from(t.webhookSubscriptions)
      .where(eq(t.webhookSubscriptions.workspaceId, workspaceId));
  }

  async create(workspaceId: string, data: {...}): Promise<WebhookSubscriptionRow> {
    const [row] = await this.db.insert(t.webhookSubscriptions)
      .values({ ...data, workspaceId }).returning();
    return row;
  }

  async setGithubHookId(workspaceId: string, id: string, hookId: number): Promise<void> {
    await this.db.update(t.webhookSubscriptions)
      .set({ githubHookId: hookId })
      .where(and(
        eq(t.webhookSubscriptions.workspaceId, workspaceId),
        eq(t.webhookSubscriptions.id, id),
      ));
  }
}
```

The **workspace guard**: EVERY `where` clause includes `workspaceId`. This is the structural
guarantee against cross-tenant leaks — even a forgotten check returns zero rows instead of another
tenant's data. Return row types, not DTOs.

### 4. Helpers (domain, optional) — `server/src/modules/webhooks/helpers.ts` (NEW)

Pure row → DTO mapping and any pure decisions, no I/O:

```ts
export function toWebhookDto(row: WebhookSubscriptionRow): WebhookSubscription { ... }
```

Keep mapping out of the service method body.

### 5. Service (application) — `server/src/modules/webhooks/service.ts` (NEW)

Orchestrates: composes the repository and the GitHub adapter **interface**, applies rules, maps
rows → DTOs. `constructor(private container: Container)`; builds the repo from `container.db`. It
has **no** `drizzle-orm`/`db` import (enforced: `service-no-direct-db`), and it never `new`s a
concrete adapter.

```ts
import type { Container } from '../../platform/container.js';
import type { WebhookSubscription, CreateWebhookSubscription } from '@devdigest/shared';
import { WebhooksRepository } from './repository.js';
import { toWebhookDto } from './helpers.js';

export class WebhooksService {
  private repo: WebhooksRepository;
  constructor(private container: Container) {
    this.repo = new WebhooksRepository(container.db);
  }

  async list(workspaceId: string): Promise<WebhookSubscription[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toWebhookDto);
  }

  async create(workspaceId: string, input: CreateWebhookSubscription): Promise<WebhookSubscription> {
    // 1) persist first (workspace-scoped)
    const row = await this.repo.create(workspaceId, input);

    // 2) register on GitHub through the adapter INTERFACE from the container
    const github = await this.container.github();          // returns GitHubClient interface
    const hook = await github.createRepoWebhook({           // see adapter step below
      repoId: input.repoId, events: input.events, url: input.targetUrl,
    });

    // 3) record the id GitHub returned
    await this.repo.setGithubHookId(workspaceId, row.id, hook.id);
    return toWebhookDto({ ...row, githubHookId: hook.id });
  }
}
```

Key points from the rules:
- **`workspaceId` is the first argument** and is threaded straight to the repo.
- **The GitHub call is obtained from the container**, not constructed. `container.github()` returns
  a `Promise<GitHubClient>` (the interface from `@devdigest/shared`); the container resolves the
  `GITHUB_TOKEN` secret lazily and builds the concrete `OctokitGitHubClient`. Never
  `import { OctokitGitHubClient }` or `new` it in the service — that hard-wires infra and breaks
  the test seam.
- Return **contract types** (`WebhookSubscription`), mapped via the pure helper.
- Decide the ordering/consistency semantics you want (e.g. persist-then-register as above, or
  register-then-persist and roll back on DB failure). If GitHub registration is best-effort, you
  may catch and degrade; if it's required, let it throw and the route surfaces the error.

### 6. Extend the GitHub adapter (core interface + infra impl)

`GitHubClient` already exists as an interface in `vendor/shared/adapters.ts`, implemented by
`adapters/github/octokit.ts` and exposed as `container.github()`. If it does **not** already have a
"register repo webhook" method, add one following the standard "add an external dependency" flow:

1. **Declare the method on the interface** in `vendor/shared/adapters.ts` (in BOTH shared copies),
   e.g. `createRepoWebhook(args): Promise<{ id: number }>`, with a zod contract for the args/result
   if they are non-trivial. The core declares *what* the app needs.
2. **Implement it** in `adapters/github/octokit.ts` (the concrete Octokit call, e.g.
   `octokit.repos.createWebhook(...)`). Only this file knows the SDK.

You do **not** need a new adapter kind or a new `ContainerOverrides` slot — `github` already has
both. Extending the existing interface means tests can still mock GitHub via the existing
`ContainerOverrides.github` seam (mock lives in `adapters/mocks.ts`).

### 7. Routes (presentation) — `server/src/modules/webhooks/routes.ts` (NEW)

A Fastify plugin, default export. Validate with Zod at the boundary, resolve tenancy with
`getContext`, construct the service from `app.container`, delegate, map domain outcomes → HTTP. No
SQL, no `drizzle-orm`/`db`/`repository` import (enforced: `route-no-direct-db`).

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CreateWebhookSubscription } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { WebhooksService } from './service.js';

export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhooksService(app.container);

  app.get('/webhooks', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/webhooks', { schema: { body: CreateWebhookSubscription } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const created = await service.create(workspaceId, req.body);
    reply.status(201);
    return created;
  });
}
```

- **Reuse the contract schema** (`CreateWebhookSubscription`) as the route body schema — don't
  redefine the shape inline.
- **`getContext(app.container, req)`** is the single chokepoint that yields `{ workspaceId, userId }`
  via the `AuthProvider` interface. This is how **workspace scoping is handled**: resolved once at
  the HTTP edge, then threaded service → repository → every `where`.
- Map `undefined`/`false` from the service to `throw new NotFoundError(...)` etc. HTTP status codes
  live only here.

### 8. Register the module — `server/src/modules/index.ts` (EDIT)

Registration is static (no filesystem autoload). Add one import + one entry:

```ts
import webhooks from './webhooks/routes.js';

export const modules: Record<string, FastifyPluginAsync> = {
  settings, repos, pulls, polling, workspace, agents, reviews, repoIntel,
  webhooks,   // ← add here
};
```

---

## ESM / convention reminders

- Relative imports carry the `.js` extension even from `.ts` source (`./service.js`,
  `./repository.js`, `../../db/client.js`).
- If this module ever needs another module's data, reach it via a container facade
  (`container.agentsRepo`, `container.repoIntel`, …) — never import a sibling's
  `service.ts`/`repository.ts` (enforced: `no-cross-module-internals`).
- Do not hand-edit `vendor/shared/` outside the two-copy sync, or `db/migrations/`.

## Verify (must be clean before done)

```sh
cd server && pnpm typecheck && pnpm arch:check && pnpm test
```

`arch:check` (dependency-cruiser, `server/.dependency-cruiser.cjs`) must stay at **0 errors**.

## File checklist

| File | Layer | Action |
|---|---|---|
| `vendor/shared/contracts/webhooks.ts` (×2: server + client) | domain core | create |
| `vendor/shared/adapters.ts` (×2) — add `createRepoWebhook` to `GitHubClient` (if missing) | domain core | edit |
| `db/schema/webhooks.ts` (+ barrel) & `db/rows.ts` | infra/core | create/edit, then `pnpm db:generate` |
| `adapters/github/octokit.ts` — implement `createRepoWebhook` | infra | edit |
| `adapters/mocks.ts` — extend GitHub mock (if used in tests) | infra | edit |
| `modules/webhooks/repository.ts` | infra | create |
| `modules/webhooks/helpers.ts` | domain | create (optional) |
| `modules/webhooks/service.ts` | application | create |
| `modules/webhooks/routes.ts` | presentation | create |
| `modules/index.ts` | presentation | edit (register) |
