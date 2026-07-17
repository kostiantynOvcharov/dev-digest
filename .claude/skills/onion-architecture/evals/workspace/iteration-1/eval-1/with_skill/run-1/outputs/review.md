# Onion-architecture review — `server/src/modules/notifications/`

Reviewed against DevDigest's four-layer onion (presentation → application → infrastructure → domain core) and the `dependency-cruiser` rules in the `onion-architecture` skill. The one rule: **dependencies point inward only.**

**Verdict: do not open the PR yet.** There are multiple hard (error-severity) layering violations plus two multi-tenancy bugs. `pnpm arch:check` will fail on at least four error rules.

## Summary of findings

| # | File | Rule broken | Severity |
|---|------|-------------|----------|
| 1 | `routes.ts` | `route-no-direct-db` — imports `drizzle-orm` + `db/schema` | error |
| 2 | `routes.ts` | `route-no-direct-db` — GET `/notifications` queries the DB inline | error |
| 3 | `routes.ts` | `route-no-direct-db` — PATCH `/notifications/:id/read` queries the DB inline | error |
| 4 | `service.ts` | `service-no-direct-db` — imports `drizzle-orm` + `db/schema` | error |
| 5 | `service.ts` | `service-no-direct-db` + tenancy — `countUnread` runs SQL and filters tenants in memory | error + security |
| 6 | `service.ts` | `no-cross-module-internals` — imports `../agents/repository.js` | error |
| 7 | `service.ts` | interface rule / `service-prefers-injected-adapters` — `new OctokitGitHubClient()` + `process.env` | warn (design: high) |
| 8 | `repository.ts` | `repository-no-adapters` — imports `adapters/codeindex/ripgrep.js` | error |
| 9 | `repository.ts` | inward-dependency direction — imports a type from `./service.js` (infra → application) | smell (not machine-caught) |
| 10 | `repository.ts` | workspace guard — `deleteById` is not workspace-scoped | security |

Correct code is called out at the end.

---

## routes.ts (presentation)

The presentation layer may only import the application (services) and the domain core. It must not touch `drizzle-orm`, `db/`, or a `repository.ts`. `notifications` is a brand-new **layered** module, not one of the four grandfathered thin modules (`settings`, `pulls`, `polling`, `workspace`), so `route-no-direct-db` applies at **error** severity.

### Finding 1 — route imports the query surface (error: `route-no-direct-db`)
```ts
import { and, desc, eq } from 'drizzle-orm';   // line 3
import * as t from '../../db/schema.js';        // line 5
```
A route may not import `drizzle-orm` or `db/schema`. These imports only exist to power the two inline queries below.

**Fix:** delete both imports once findings 2 and 3 are moved into the service/repository.

### Finding 2 — GET `/notifications` runs SQL in the handler (error: `route-no-direct-db`)
```ts
app.get('/notifications', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  const rows = await app.container.db
    .select()
    .from(t.notifications)
    .where(eq(t.notifications.workspaceId, workspaceId))
    .orderBy(desc(t.notifications.createdAt));
  return rows;   // lines 32-40
});
```
Two problems: the route queries the DB directly, and it **returns raw Drizzle rows** instead of a contract DTO. `NotificationsService.list()` already exists and does exactly this correctly (repo query → `toNotificationDto`).

**Fix:**
```ts
app.get('/notifications', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return service.list(workspaceId);
});
```

### Finding 3 — PATCH `/notifications/:id/read` runs SQL in the handler (error: `route-no-direct-db`)
```ts
const [row] = await app.container.db
  .update(t.notifications)
  .set({ read: req.body.read })
  .where(and(
    eq(t.notifications.workspaceId, workspaceId),
    eq(t.notifications.id, req.params.id),
  ))
  .returning();
if (!row) throw new NotFoundError('notification not found');
return row;   // lines 69-80
```
Same violation, and again returns a raw row.

**Fix:** add a workspace-scoped `markRead` method to the repository, wrap it in a service method that maps the row to a DTO (returning `undefined` when nothing was updated), and let the route map `undefined → NotFoundError`:
```ts
// routes.ts
const updated = await service.markRead(workspaceId, req.params.id, req.body.read);
if (!updated) throw new NotFoundError('notification not found');
return updated;
```
```ts
// repository.ts — the only layer allowed to touch drizzle
async markRead(workspaceId: string, id: string, read: boolean): Promise<NotificationRow | undefined> {
  const [row] = await this.db
    .update(t.notifications)
    .set({ read })
    .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.id, id)))
    .returning();
  return row;
}
```

Note: the POST and GET `/:id` handlers already delegate to the service correctly — keep those as the template for the two above.

---

## service.ts (application)

A service orchestrates: it composes its own repository and adapter **interfaces**, applies rules, and maps rows → DTOs. It runs no SQL and does no raw I/O, and it never imports a sibling module's internals. `service-no-direct-db` and `no-cross-module-internals` are both **error** rules.

### Finding 4 — service imports the query surface (error: `service-no-direct-db`)
```ts
import { eq } from 'drizzle-orm';        // line 1
import * as t from '../../db/schema.js'; // line 5
```
A service may not import `drizzle-orm` or `db/schema`. (Importing the row *type* `NotificationRow` from `db/rows.js` on line 4 is fine — that is a documented carve-out — but the schema/drizzle imports are not.) These exist only for `countUnread`.

**Fix:** remove both imports after fixing finding 5.

### Finding 5 — `countUnread` runs SQL and does a cross-tenant in-memory scan (error: `service-no-direct-db` + tenancy bug)
```ts
async countUnread(workspaceId: string): Promise<number> {
  const rows = await this.container.db
    .select()
    .from(t.notifications)
    .where(eq(t.notifications.read, false));          // NO workspace predicate
  return rows.filter((r: NotificationRow) => r.workspaceId === workspaceId).length;
}   // lines 62-69
```
This is the worst offender: it is SQL in a service **and** it loads *every workspace's* unread notifications into memory before filtering. The workspace guard requires the `workspaceId` predicate in the query itself — filtering after the fact both leaks other tenants' data into process memory and does not scale.

**Fix:** push a scoped, aggregate count into the repository and call it:
```ts
// repository.ts
async countUnread(workspaceId: string): Promise<number> {
  const [row] = await this.db
    .select({ count: count() })
    .from(t.notifications)
    .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.read, false)));
  return row?.count ?? 0;
}
// service.ts
async countUnread(workspaceId: string): Promise<number> {
  return this.repo.countUnread(workspaceId);
}
```

### Finding 6 — imports another module's repository (error: `no-cross-module-internals`)
```ts
import { AgentsRepository } from '../agents/repository.js';   // line 7
// ...
this.agentsRepo = new AgentsRepository(container.db);         // line 27
```
A module may never import a sibling module's `service.ts`/`repository.ts`. Cross-cutting repositories are exposed on the container (e.g. `container.agentsRepo`). Here it is also **dead code** — `this.agentsRepo` is never used.

**Fix:** delete the import and the field. If a genuine need for agents data appears later, use `this.container.agentsRepo`, never a direct import.

### Finding 7 — `create` news up a concrete adapter and reads `process.env` (warn: `service-prefers-injected-adapters`; design severity high)
```ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';  // line 6
// ...
if (input.level === 'critical') {
  const token = process.env.GITHUB_TOKEN ?? '';
  const github = new OctokitGitHubClient(token);
  await github.createIssue({ title: input.title, body: input.body });
}   // lines 50-57
```
Services depend on the `GitHubClient` **interface** obtained from the container — they never `new` a concrete adapter or read secrets themselves. Hard-wiring `OctokitGitHubClient` makes this method impossible to test via `ContainerOverrides.github`, and `process.env.GITHUB_TOKEN ?? ''` silently sends an empty token instead of failing loudly. `dependency-cruiser` flags the concrete-adapter import as `service-prefers-injected-adapters` (warn), but on `main` there are exactly 2 known warns — this would be a **new** one, so treat it as blocking.

**Fix:** depend on the container's interface (the container's `github()` getter already resolves the token via the secrets provider and throws `ConfigError` when missing):
```ts
if (input.level === 'critical') {
  const github = await this.container.github();
  await github.createIssue({ title: input.title, body: input.body });
}
```
Remove the `OctokitGitHubClient` import and the `process.env` read entirely. (Separately, worth confirming `createIssue` targets the workspace's linked repo rather than a global default — but that is a correctness concern beyond layering.)

---

## repository.ts (infrastructure)

A repository is the only place SQL lives; its constructor takes `Db` and nothing else; it must not import from `adapters/`; and every domain query's `where` clause includes `workspaceId`.

### Finding 8 — repository imports an adapter (error: `repository-no-adapters`)
```ts
import { renderMarkdown } from '../../adapters/codeindex/ripgrep.js';   // line 5
// ...
body: renderMarkdown(input.body),                                       // line 51
```
A repository must not import `adapters/` — external work is a service's job coordinating a repo + an adapter. Rendering markdown inside `insert` also silently transforms data on write, which is surprising for a data-access method.

**Fix:** remove the adapter import; the repository stores `input.body` verbatim. If the rendered form is genuinely needed, do the transform in the service before calling `repo.insert` (via a container adapter interface if it is real I/O, or a pure `helpers.ts` function if it is a pure transform), or render on read. Given the DTO already returns `body` straight through, prefer storing raw and rendering at the presentation edge.

### Finding 9 — repository imports a type from `service.ts` (inward-direction smell; not machine-caught)
```ts
import type { CreateNotificationInput } from './service.js';   // line 6
```
Infrastructure importing from the application layer points the dependency **outward**. It escapes `dependency-cruiser` only because the configs set `tsPreCompilationDeps: false` (type-only edges are ignored), so this will not fail `arch:check` — but it is still a real layering inversion and will break the moment the type stops being import-only.

**Fix:** move the shape to where it belongs. Either define the write shape as a contract in `vendor/shared` (if shared with the client) and have both layers import it, or define a repository-local insert type in the repository (or `db/rows.ts`) and have the service import *that*. The arrow must point inward.

### Finding 10 — `deleteById` is not workspace-scoped (multi-tenancy bug)
```ts
async deleteById(id: string): Promise<boolean> {
  const rows = await this.db
    .delete(t.notifications)
    .where(eq(t.notifications.id, id))     // missing workspaceId predicate
    .returning({ id: t.notifications.id });
  return rows.length > 0;
}   // lines 58-64
```
Every domain query must include the `workspaceId` predicate. As written, any workspace could delete another workspace's notification by id. It has no caller today, but it is a latent cross-tenant vulnerability and contradicts the guard the other three methods correctly follow.

**Fix:**
```ts
async deleteById(workspaceId: string, id: string): Promise<boolean> {
  const rows = await this.db
    .delete(t.notifications)
    .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.id, id)))
    .returning({ id: t.notifications.id });
  return rows.length > 0;
}
```

---

## Looks suspicious but is actually fine

- **`helpers.ts` importing `NotificationRow` from `../../db/rows.js`** — fine. `db/rows` holds contract-like row *types*, and importing them (even from an outer layer) is an explicit carve-out; the reference `agents/helpers.ts` does the same. `helpers.ts` is a correct pure domain transform (no I/O), mapping row → `Notification` contract.
- **`service.ts` importing `type { NotificationRow }` from `db/rows.js` (line 4)** — fine, same carve-out; only `db/client`/`db/schema`/`drizzle-orm` are forbidden from a service.
- **`repository.ts` importing `drizzle-orm` and `db/schema`** — correct; the repository is the one and only layer allowed to.
- **`service.ts` constructing `new NotificationsRepository(container.db)`** — correct; a service owns its *own* module's repository built from `container.db`. (Contrast with finding 6, which is a *sibling* module's repo.)
- **Inline Zod bodies `CreateNotificationBody` / `MarkReadBody` in `routes.ts`** — acceptable; the reference `agents/routes.ts` defines request bodies inline too. Reuse a `@devdigest/shared` schema only if one already exists for these shapes.
- **`routes.ts` POST and GET `/:id` handlers** — correct: Zod at the boundary, `getContext` for tenancy, delegate to the service, map `undefined → NotFoundError`. Use them as the pattern for fixing findings 2 and 3.

## Before opening the PR
Run `cd server && pnpm typecheck && pnpm arch:check && pnpm test`. `arch:check` must return **0 errors** and must not add any new warnings beyond the known baseline (4 `route-direct-db-legacy` + 2 `service-prefers-injected-adapters`).
