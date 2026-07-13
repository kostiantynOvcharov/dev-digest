# Webhooks Feature — Implementation Plan (DevDigest server)

A step-by-step plan for adding a `webhooks` module to the DevDigest server using its
Onion / Clean Architecture. The feature must:

- **(a)** Store webhook subscriptions in Postgres, scoped per workspace.
- **(b)** Call GitHub's API to register the webhook on the repo when a subscription is created.

The layering to respect (dependencies always point **inward**):

```
presentation (routes)  ->  application (services)  ->  infrastructure (repositories / adapters)  ->  domain (core)
```

Domain knows nothing about the outer layers. Application depends on domain-defined
interfaces (ports), not on concrete infrastructure. Infrastructure implements those
ports (Postgres repo, GitHub HTTP adapter). Presentation is thin: parse/validate ->
call service -> serialize.

---

## 0. Conventions to honor (project-specific)

- **ESM imports:** every relative import ends in `.js` (e.g. `import { WebhookService } from "./webhook.service.js"`), even though the source file is `.ts`.
- **Static module registration:** modules are wired by hand in `server/src/modules/index.ts` — there is no filesystem autoloader. The new module must be added there explicitly.
- **Not a monorepo workspace:** shared request/response shapes are consumed across packages via **tsconfig path aliases**, not workspace package imports. Put shared contracts where the existing shared-contracts alias points (see step 7).
- **Do-not-touch:** never hand-edit `server/src/vendor/shared/` or existing files under `server/src/db/migrations/`. New migrations are *added*, never edited in place.
- **Workspace scoping is mandatory:** every query and every GitHub call is bound to the caller's `workspaceId`. Nothing crosses workspace boundaries.

Before writing code, mirror the shape of an **existing module** in `server/src/modules/`
(pick any recently added one) so file naming, DI wiring, and route registration match the
house style. This plan uses the conventional names; adjust to whatever the sibling modules use.

---

## 1. Files to create

Assuming modules live under `server/src/modules/webhooks/`, organized by layer:

```
server/src/modules/webhooks/
├── domain/
│   ├── webhook.entity.ts            # domain model + invariants (no I/O, no framework imports)
│   ├── webhook.repository.ts        # PORT: interface the app layer depends on
│   └── github-webhook.port.ts       # PORT: interface for registering a hook on GitHub
├── application/
│   └── webhook.service.ts           # use cases: create / list / delete subscription
├── infrastructure/
│   ├── webhook.pg.repository.ts     # Postgres implementation of webhook.repository.ts
│   └── github-webhook.adapter.ts    # GitHub API implementation of github-webhook.port.ts
├── presentation/
│   └── webhook.routes.ts            # HTTP routes; validate input, call service, serialize
├── webhook.schema.ts                # Drizzle table definition (or add to central schema — see step 4)
└── index.ts                         # module composition root: build deps, register routes
```

Plus, outside the module:

- **A new DB migration file** under `server/src/db/migrations/` (generated, not hand-written — see step 4).
- **Shared contracts** in the shared-contracts location behind the tsconfig alias (see step 7).
- **One edit** to `server/src/modules/index.ts` to register the module (see step 8).

---

## 2. Domain layer (innermost — no dependencies on anything outer)

### `domain/webhook.entity.ts`
Plain TypeScript type/class describing a subscription and its business rules. No Drizzle,
no Fastify, no fetch. Fields (illustrative):

```ts
export interface WebhookSubscription {
  id: string;
  workspaceId: string;      // scoping key — always present
  repoFullName: string;     // e.g. "owner/repo"
  events: string[];         // GitHub event names, e.g. ["pull_request"]
  targetUrl: string;        // where GitHub should POST
  githubHookId: number | null; // id returned by GitHub after registration
  status: "pending" | "active" | "failed";
  createdAt: Date;
}
```

Put any invariant checks here (e.g. `events` non-empty, `targetUrl` is https). Keep it pure.

### `domain/webhook.repository.ts` (PORT)
The interface the application layer talks to. Every method takes `workspaceId` so scoping
is structurally enforced, not optional:

```ts
export interface WebhookRepository {
  create(sub: NewWebhookSubscription): Promise<WebhookSubscription>;
  listByWorkspace(workspaceId: string): Promise<WebhookSubscription[]>;
  findById(workspaceId: string, id: string): Promise<WebhookSubscription | null>;
  markRegistered(workspaceId: string, id: string, githubHookId: number): Promise<void>;
  delete(workspaceId: string, id: string): Promise<void>;
}
```

### `domain/github-webhook.port.ts` (PORT)
The interface for the outbound GitHub call. Defining it in the domain (or application)
layer — and implementing it in infrastructure — is the key inversion that keeps the
service testable and free of HTTP concerns:

```ts
export interface GithubWebhookPort {
  registerHook(input: {
    workspaceId: string;         // used to resolve the right GitHub credentials
    repoFullName: string;
    events: string[];
    targetUrl: string;
  }): Promise<{ githubHookId: number }>;

  deleteHook(input: {
    workspaceId: string;
    repoFullName: string;
    githubHookId: number;
  }): Promise<void>;
}
```

> Why ports live here: the application service must not import `fetch`/Octokit or the
> Postgres client directly. It depends only on these interfaces. This is the dependency
> rule — outer implementations are injected in, never imported inward.

---

## 3. Application layer — `application/webhook.service.ts`

The orchestrator. It receives the two ports via constructor injection and implements the
use cases. The **create** use case is where (a) and (b) come together:

```ts
export class WebhookService {
  constructor(
    private readonly repo: WebhookRepository,
    private readonly github: GithubWebhookPort,
  ) {}

  async createSubscription(workspaceId: string, input: CreateWebhookInput) {
    // 1) Persist as "pending" first (source of truth, scoped to workspace).
    const sub = await this.repo.create({ workspaceId, ...input, status: "pending" });

    // 2) Call GitHub to register the hook on the repo.
    try {
      const { githubHookId } = await this.github.registerHook({
        workspaceId,
        repoFullName: input.repoFullName,
        events: input.events,
        targetUrl: input.targetUrl,
      });
      // 3) Record the GitHub id and flip to "active".
      await this.repo.markRegistered(workspaceId, sub.id, githubHookId);
      return { ...sub, githubHookId, status: "active" as const };
    } catch (err) {
      // Leave a durable record of the failure; surface a domain-level error.
      // (Optionally mark status "failed" so the row isn't a silent orphan.)
      throw new WebhookRegistrationError(sub.id, err);
    }
  }

  listSubscriptions(workspaceId: string) {
    return this.repo.listByWorkspace(workspaceId);
  }

  async deleteSubscription(workspaceId: string, id: string) {
    const sub = await this.repo.findById(workspaceId, id);
    if (!sub) throw new NotFoundError();
    if (sub.githubHookId) {
      await this.github.deleteHook({ workspaceId, repoFullName: sub.repoFullName, githubHookId: sub.githubHookId });
    }
    await this.repo.delete(workspaceId, id);
  }
}
```

Design notes:
- **Order matters:** persist first (pending), then call GitHub, then mark active. This
  avoids a registered-but-untracked hook and keeps the DB the source of truth.
- **`workspaceId` is a first-class parameter** to every method — the service never trusts
  an id embedded in the body; it comes from the authenticated request context (step 6).
- The service contains **no HTTP and no SQL** — only orchestration and business decisions.

---

## 4. Database: table + migration

Use the project's existing Drizzle + migration workflow (the presence of
`server/src/db/migrations/` indicates Drizzle Kit or a comparable generator).

### 4a. Define the table (`webhook.schema.ts`)
Follow the pattern used by the existing schema files (where other modules' tables are
defined — either co-located per module or in a central `db/schema`). Example:

```ts
import { pgTable, uuid, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { workspaces } from "../../db/schema/workspaces.js"; // reuse existing workspace table for the FK

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),  // scoping FK
  repoFullName: text("repo_full_name").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  targetUrl: text("target_url").notNull(),
  githubHookId: integer("github_hook_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Add an **index on `workspace_id`** (and a unique constraint on
`(workspace_id, repo_full_name)` if a workspace may only subscribe a repo once) so
scoped lookups are fast and duplicates are prevented at the DB level.

### 4b. Generate the migration
Do **not** hand-write SQL into `server/src/db/migrations/`. Run the project's generate
command (typically `pnpm --filter server db:generate` / `drizzle-kit generate` — check
`server/package.json` scripts for the exact name). This creates a new timestamped
migration + updates the journal. Then apply it with the project's migrate command
(`db:migrate` / `db:push` per the scripts). Never edit existing migration files.

---

## 5. Infrastructure layer

### `infrastructure/webhook.pg.repository.ts`
Concrete `WebhookRepository` backed by Drizzle. Receives the db client via constructor.
Every query filters/inserts by `workspaceId`:

```ts
export class PgWebhookRepository implements WebhookRepository {
  constructor(private readonly db: Database) {}

  async create(sub: NewWebhookSubscription) {
    const [row] = await this.db.insert(webhookSubscriptions).values(sub).returning();
    return toEntity(row);
  }

  async listByWorkspace(workspaceId: string) {
    const rows = await this.db.select().from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.workspaceId, workspaceId));
    return rows.map(toEntity);
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db.select().from(webhookSubscriptions)
      .where(and(eq(webhookSubscriptions.workspaceId, workspaceId), eq(webhookSubscriptions.id, id)));
    return row ? toEntity(row) : null;
  }
  // markRegistered / delete similarly gated on workspaceId
}
```

The `and(eq(workspaceId), eq(id))` compound predicate is what prevents one workspace from
reading or deleting another workspace's row even if it guesses an id.

### `infrastructure/github-webhook.adapter.ts` — **where the GitHub call is obtained from**
Concrete `GithubWebhookPort`. This is the only place that talks HTTP to GitHub.

- **Reuse the existing GitHub client, don't invent one.** DevDigest already integrates
  with GitHub (it's a PR reviewer). Find the existing GitHub adapter/client (search
  `server/src/modules` and `server/src/vendor/shared` for the GitHub HTTP client, Octokit
  wrapper, or an `HttpClient` / GitHub-token provider). Inject *that* into this adapter
  rather than instantiating a raw fetch/Octokit here.
- **Credentials are resolved per workspace.** The adapter takes `workspaceId` and uses the
  existing credential/installation-token provider to get the right GitHub token/installation
  for that workspace, then calls the REST endpoint:
  - `POST /repos/{owner}/{repo}/hooks` with `{ config: { url: targetUrl, content_type: "json" }, events, active: true }` → returns `{ id }` used as `githubHookId`.
  - `DELETE /repos/{owner}/{repo}/hooks/{hook_id}` for removal.

```ts
export class GithubWebhookAdapter implements GithubWebhookPort {
  constructor(private readonly gh: GithubClient) {} // existing shared client

  async registerHook({ workspaceId, repoFullName, events, targetUrl }) {
    const [owner, repo] = repoFullName.split("/");
    const client = await this.gh.forWorkspace(workspaceId); // resolves per-workspace token
    const res = await client.request("POST /repos/{owner}/{repo}/hooks", {
      owner, repo,
      config: { url: targetUrl, content_type: "json" },
      events, active: true,
    });
    return { githubHookId: res.data.id };
  }
  // deleteHook -> DELETE /repos/{owner}/{repo}/hooks/{hook_id}
}
```

If no reusable per-workspace GitHub-token mechanism exists, that is a prerequisite to
wire first — do not hardcode a token. Map GitHub error responses (404/403/422) to
meaningful domain errors so the service can react.

---

## 6. Presentation layer — `presentation/webhook.routes.ts`

Thin Fastify route plugin. Responsibilities: validate input, extract `workspaceId` from
the authenticated request context, call the service, serialize the result. No business logic.

```ts
export function registerWebhookRoutes(app: FastifyInstance, service: WebhookService) {
  app.post("/webhooks", { schema: createWebhookRouteSchema }, async (req, reply) => {
    const workspaceId = req.workspace.id;           // from auth/tenant middleware, NOT the body
    const input = CreateWebhookRequest.parse(req.body); // shared contract (step 7)
    const result = await service.createSubscription(workspaceId, input);
    return reply.code(201).send(toResponse(result));
  });

  app.get("/webhooks", async (req) => {
    return (await service.listSubscriptions(req.workspace.id)).map(toResponse);
  });

  app.delete("/webhooks/:id", async (req, reply) => {
    await service.deleteSubscription(req.workspace.id, req.params.id);
    return reply.code(204).send();
  });
}
```

Key rule: **`workspaceId` always comes from the authenticated request context**
(the existing auth/tenant hook), never from the request body or a query param. That is
how workspace scoping is enforced at the edge, then carried through every layer.

---

## 7. Shared request/response shapes (contracts)

Because this is not a monorepo workspace, shared shapes live in the directory that the
**tsconfig path alias** for shared contracts points to (look in `server/tsconfig.json` /
the root tsconfig `paths` — commonly something like `@shared/*` → `server/src/vendor/shared`
or a dedicated `contracts` package). Find where existing modules keep their request/response
DTOs and put the webhook ones there so the client can import them via the same alias.

Define (with Zod, matching the project convention):

```ts
export const CreateWebhookRequest = z.object({
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  events: z.array(z.string()).min(1),
  targetUrl: z.string().url(),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>;

export const WebhookResponse = z.object({
  id: z.string(),
  repoFullName: z.string(),
  events: z.array(z.string()),
  status: z.enum(["pending", "active", "failed"]),
  githubHookId: z.number().nullable(),
  createdAt: z.string(),
});
export type WebhookResponse = z.infer<typeof WebhookResponse>;
```

Note the response shape **does not expose `workspaceId`** or any GitHub token — it's an
internal scoping key. Reuse these schemas both for Fastify route validation (server) and
for the client's typed API calls.

---

## 8. Module composition + registration

### `webhooks/index.ts` (composition root for the module)
Wire concrete infrastructure into the service and expose a register function. This is the
one place where the inward-pointing interfaces meet their outer implementations:

```ts
import type { FastifyInstance } from "fastify";
import { PgWebhookRepository } from "./infrastructure/webhook.pg.repository.js";
import { GithubWebhookAdapter } from "./infrastructure/github-webhook.adapter.js";
import { WebhookService } from "./application/webhook.service.js";
import { registerWebhookRoutes } from "./presentation/webhook.routes.js";

export function registerWebhooksModule(app: FastifyInstance, deps: AppDeps) {
  const repo = new PgWebhookRepository(deps.db);
  const github = new GithubWebhookAdapter(deps.githubClient); // existing shared GitHub client from deps
  const service = new WebhookService(repo, github);
  registerWebhookRoutes(app, service);
}
```

Match however sibling modules receive their dependencies (a DI container, an `AppDeps`
object, or Fastify decorators) — pull `db` and the existing GitHub client from there rather
than constructing them.

### `server/src/modules/index.ts` (edit — static registration)
Add the module to the static list, following the existing pattern exactly:

```ts
import { registerWebhooksModule } from "./webhooks/index.js";
// ...
export function registerModules(app, deps) {
  // ...existing modules...
  registerWebhooksModule(app, deps);
}
```

Remember the `.js` extension on the import. There is no autoloader, so a module that isn't
added here simply won't exist at runtime.

---

## 9. Suggested implementation order

1. **Domain:** entity + the two ports (`WebhookRepository`, `GithubWebhookPort`).
2. **Schema + migration:** define the Drizzle table, run generate + migrate.
3. **Contracts:** add Zod request/response shapes in the shared-alias location.
4. **Infrastructure:** Postgres repo, then GitHub adapter (reusing the existing GitHub client + per-workspace token).
5. **Application:** the service, injecting both ports; implement create/list/delete.
6. **Presentation:** routes; pull `workspaceId` from auth context.
7. **Composition:** module `index.ts`, then register in `server/src/modules/index.ts`.
8. **Verify:** typecheck, run tests, and the repo's architecture boundary check
   (`arch:check` / dependency-cruiser) to confirm no inward-pointing violations
   (e.g. domain importing infrastructure).

---

## 10. Boundary checklist (what the arch check will enforce)

- `domain/` imports **nothing** from `application/`, `infrastructure/`, `presentation/`,
  Fastify, Drizzle, or GitHub SDKs.
- `application/webhook.service.ts` imports only domain ports + entities — **no** Drizzle,
  fetch, or Fastify.
- Concrete Postgres/GitHub code exists **only** in `infrastructure/`.
- Routes are thin and contain no SQL/HTTP-to-GitHub logic.
- `workspaceId` is threaded through **every** repository method and GitHub call, and always
  originates from the authenticated request context.
- New migration files are additive; `vendor/shared/` and existing migrations are untouched.
- All relative imports carry the `.js` extension, and the module is registered in
  `server/src/modules/index.ts`.
```
