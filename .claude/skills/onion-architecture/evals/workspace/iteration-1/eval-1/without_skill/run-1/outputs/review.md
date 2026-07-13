# Architecture Review — `server/src/modules/notifications/`

Reviewed against the DevDigest Onion / Clean Architecture layering:
**presentation (routes) → application (services) → infrastructure (repositories / adapters) → domain core.**
The core rule: dependencies point **inward only**. Presentation may know the application layer; the
application layer talks to infrastructure through **abstractions**, never concrete adapters or the raw DB;
infrastructure must not depend on the application layer; and modules must not reach into each other's
internal infrastructure.

Verdict: **Request changes.** There are multiple layer-boundary violations, one of which
(`countUnread`) is also a data-isolation bug. Details below, ordered by severity.

---

## Critical

### C1 — Route handlers query the database directly (presentation → infrastructure leak)
**File:** `routes.ts`, `GET /notifications` (lines 32–40) and `PATCH /notifications/:id/read` (lines 64–82).

```ts
// GET /notifications
const rows = await app.container.db
  .select()
  .from(t.notifications)
  .where(eq(t.notifications.workspaceId, workspaceId))
  .orderBy(desc(t.notifications.createdAt));
return rows;

// PATCH /notifications/:id/read
const [row] = await app.container.db
  .update(t.notifications)
  .set({ read: req.body.read })
  .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.id, req.params.id)))
  .returning();
```

**Rule broken:** The presentation layer is reaching two layers inward, straight past the application
service into the database (Drizzle query builder + `db/schema`). That is why `routes.ts` has to import
`and, desc, eq` from `drizzle-orm` (line 3) and `* as t from '../../db/schema.js'` (line 5) — those
imports are the smell. Routes should only orchestrate: parse/validate input, call a service, shape the
HTTP response.

Note the irony: `NotificationsService.list()` already exists (service.ts:30) and does exactly the right
thing, but the route bypasses it. There is no `markRead` service method at all.

**Fix:**
- `GET /notifications` → `return service.list(workspaceId);`
- Add `NotificationsService.markRead(workspaceId, id, read)` that delegates to a new
  `NotificationsRepository.markRead(...)`, and have the route call it, throwing `NotFoundError`
  when the service returns undefined.
- Delete the `drizzle-orm` and `db/schema` imports from `routes.ts` once the queries are gone.

---

### C2 — `countUnread` bypasses the repository AND is not workspace-scoped in SQL
**File:** `service.ts`, lines 62–69.

```ts
async countUnread(workspaceId: string): Promise<number> {
  const rows = await this.container.db
    .select()
    .from(t.notifications)
    .where(eq(t.notifications.read, false));
  return rows.filter((r: NotificationRow) => r.workspaceId === workspaceId).length;
}
```

**Rules broken (two):**
1. **Application → infrastructure leak.** The service issues a raw Drizzle query against `db/schema`
   instead of going through `NotificationsRepository`. This is the reason the service imports
   `* as t from db/schema.js` (line 5) and `NotificationRow` (line 4) — imports the application layer
   should not need.
2. **Workspace-scoping / tenant-isolation violation (also a real bug).** The query fetches **every
   unread notification across every workspace**, pulls them all into memory, then filters by
   `workspaceId` in JS. The repository pattern here scopes by `workspaceId` *in the WHERE clause*
   (see `list`/`getById`). This version leaks other tenants' rows into process memory, does not scale,
   and the filtering is easy to get wrong.

**Fix:** Add `NotificationsRepository.countUnread(workspaceId)` that does the count in SQL
(`where(and(eq(workspaceId, ...), eq(read, false)))`, ideally `count(*)`), and have the service call it.
Remove the `db/schema` and `NotificationRow` imports from the service afterward.

---

## High

### H1 — Service constructs a concrete infrastructure adapter (dependency-inversion violation)
**File:** `service.ts`, lines 6, 50–57.

```ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
...
if (input.level === 'critical') {
  const token = process.env.GITHUB_TOKEN ?? '';
  const github = new OctokitGitHubClient(token);
  await github.createIssue({ title: input.title, body: input.body });
}
```

**Rule broken:** The application layer depends on a **concrete** infrastructure adapter and `new`s it
inline. Onion requires the application layer to depend on an **abstraction** (a port/interface),
with the concrete adapter wired in the composition root (the DI container). As written, the service is
un-testable without real Octokit, and it owns adapter construction it shouldn't.

**Fix:** Define a `GitHubClient` port (interface with `createIssue`), resolve it from `container`
(e.g. `container.github`), and depend on the interface. Move `OctokitGitHubClient` construction into
the container wiring. The service should never import a concrete `adapters/**` class.

### H2 — Service reads `process.env` directly (config/secrets leak into application layer)
**File:** `service.ts`, line 51 — `const token = process.env.GITHUB_TOKEN ?? '';`

**Rule broken:** Environment/secret access is an infrastructure/composition-root concern. The
application layer should receive configured collaborators, not read `process.env`. The `?? ''` fallback
also silently proceeds with an empty token (the GitHub call will fail confusingly rather than surfacing
a misconfiguration).

**Fix:** Inject the already-constructed, already-tokened `GitHubClient` from the container (folds into
the H1 fix). Token resolution and validation belong in the container / config module.

### H3 — Repository imports a type from the service (infrastructure → application, wrong-direction dependency)
**File:** `repository.ts`, line 6 — `import type { CreateNotificationInput } from './service.js';`

**Rule broken:** Infrastructure must not depend on the application layer; dependencies point inward.
`CreateNotificationInput` is declared in `service.ts` (application) and imported down into
`repository.ts` (infrastructure). Even as a `type`-only import it is a boundary inversion and creates a
service↔repository import cycle (`service` imports `repository`, `repository` imports `service`).

**Fix:** Move the persistence input shape to a layer both can depend on — e.g. define a
`NewNotification` type in the domain/contract layer (or `db/rows.ts`), and have `insert` accept that.
`CreateNotificationInput` can stay in the service as the application-facing DTO and be mapped to the
persistence type before calling the repo.

### H4 — Repository performs a content transformation on write (business logic in data-access) + nonsensical adapter coupling
**File:** `repository.ts`, lines 5 and 50.

```ts
import { renderMarkdown } from '../../adapters/codeindex/ripgrep.js';
...
body: renderMarkdown(input.body),
```

**Rules broken:**
- **Data-access doing transformation.** A repository should persist what it is given. Rendering the
  body silently rewrites the stored value so it no longer matches the input — a surprising side effect
  hidden in the persistence layer. Rendering/formatting is a domain/application concern.
- **Incoherent module coupling.** `renderMarkdown` is imported from the **codeindex/ripgrep** adapter,
  which has nothing to do with notifications or markdown. Even if some rendering helper is wanted, it
  should not come from an unrelated search adapter.

**Fix:** Store the raw `body` in the repository. If notifications need rendered output, render at read
time in the presentation/DTO layer, or compute it in the service via a properly-scoped rendering
collaborator — not inside `insert`, and not from the ripgrep adapter.

---

## Medium

### M1 — Cross-module reach into another module's repository (unused, but still coupling)
**File:** `service.ts`, lines 7, 23, 27.

```ts
import { AgentsRepository } from '../agents/repository.js';
...
private agentsRepo: AgentsRepository;
this.agentsRepo = new AgentsRepository(container.db);
```

**Rule broken:** A module should not instantiate or depend on **another module's** repository
(infrastructure internal). Modules communicate through their public application services or shared
contracts, not by importing each other's data-access classes. Compounding it, `agentsRepo` is **never
used** — pure dead coupling.

**Fix:** Delete the import, field, and construction. If notifications genuinely need agent data later,
depend on the agents module's **service** (or a shared contract), not `AgentsRepository`.

### M2 — Routes return raw DB rows instead of the DTO (leaks persistence shape; inconsistent contract)
**File:** `routes.ts`, line 39 (`return rows;`) and line 80 (`return row;`).

The `GET /notifications` and `PATCH .../read` handlers return `NotificationRow` objects straight from
the DB, exposing internal columns (`workspaceId`, `createdBy`, `createdAt` as a `Date`) and the
snake_case-vs-camelCase mismatch. Meanwhile `POST` and `GET /:id` go through the service and return the
mapped `Notification` DTO (via `toNotificationDto`). So the same resource is serialized two different
ways depending on the endpoint.

**Rule broken:** The presentation boundary should emit the domain/API DTO, not the raw persistence
model. This is a direct consequence of C1 — once those handlers call the service, they get DTOs for
free and the inconsistency disappears.

**Fix:** Route everything through the service (see C1); every handler then returns `Notification`.

### M3 — `deleteById` is not workspace-scoped (tenant-isolation gap in the repository)
**File:** `repository.ts`, lines 58–64.

```ts
async deleteById(id: string): Promise<boolean> {
  const rows = await this.db.delete(t.notifications)
    .where(eq(t.notifications.id, id))
    .returning({ id: t.notifications.id });
  return rows.length > 0;
}
```

Every other repository method scopes by `workspaceId` (`list`, `getById`, `insert`). `deleteById` does
not, so a caller with any id could delete a row belonging to another workspace — it breaks the
workspace-scoping repository pattern this module otherwise follows. It also appears to have no caller
(dead code).

**Fix:** Either remove it (if unused) or change the signature to
`deleteById(workspaceId: string, id: string)` and add `eq(t.notifications.workspaceId, workspaceId)` to
the `where`.

---

## Low / smells

### L1 — Manual service instantiation + `container` passed around instead of DI resolution
**File:** `routes.ts` line 30 (`new NotificationsService(app.container)`), `service.ts` lines 25–27
(`new NotificationsRepository(container.db)`).

The composition root (the DI container) should own object graph construction; here the route `new`s the
service, the service `new`s its repositories, and the raw `container` / `container.db` handle is threaded
through the layers. This is what enables the H1/H3/M1 violations. Pattern-dependent, but the cleaner
shape is: container wires service+repo+ports, route resolves the service from the container, service
receives its repo and `GitHubClient` port via constructor injection (not the whole container).

### L2 — GitHub side effect is non-atomic with the insert (robustness note, not strictly layering)
**File:** `service.ts` lines 48–57. The row is inserted first, then the GitHub issue is created with no
error handling or compensation. If `createIssue` throws, the notification already exists and the request
fails — inconsistent state. Worth deciding whether the external call should be best-effort (caught/logged)
or truly transactional. Flagging so it's a conscious choice.

---

## Looks suspicious but is actually fine

- **`helpers.ts` importing `NotificationRow` from `db/rows.js`.** A boundary **mapper** is exactly the
  place allowed to know both the persistence row shape and the DTO shape — that is its job. The function
  is pure, does no I/O, and correctly maps to the API contract (`created_at` snake_case,
  `createdAt.toISOString()`). No change needed.
- **`repository.ts` importing `drizzle-orm`, `db/client`, and `db/schema`.** Correct — that is
  infrastructure depending on infrastructure. This is the layer that is *supposed* to speak Drizzle.
- **Zod schemas + `getContext` in `routes.ts`.** Request validation and pulling
  `workspaceId`/`userId` from the auth context are legitimate presentation-layer responsibilities.
- **`POST /notifications` and `GET /:id` handlers.** These correctly delegate to the service and return
  the DTO — this is the shape the other two handlers should copy.
- **`re-export type { NotificationRow }` in `repository.ts` (line 8).** Harmless convenience re-export
  of a db type; not a boundary issue.

---

## Summary of required fixes
1. **C1** — Move the `GET` and `PATCH` DB queries out of `routes.ts` into service+repo methods; drop the drizzle/schema imports from the route.
2. **C2** — Give `countUnread` a workspace-scoped repository method (count in SQL); stop querying the DB from the service.
3. **H1/H2** — Depend on a `GitHubClient` port injected from the container; remove direct `OctokitGitHubClient` construction and `process.env` access.
4. **H3** — Stop importing an application type into the repository; define the persistence input type in a lower layer.
5. **H4** — Don't `renderMarkdown` inside `insert`, and don't couple to the ripgrep adapter; persist raw body.
6. **M1** — Remove the unused cross-module `AgentsRepository` dependency.
7. **M2** — Return DTOs from every handler (falls out of C1).
8. **M3** — Scope `deleteById` by `workspaceId` or delete it.
9. **L1/L2** — Consider container-driven DI and a deliberate policy for the non-atomic GitHub side effect.
