# Planted violations — grading key (NOT given to subagents)

## Eval 1 — notifications module (detection)
1. **routes.ts** imports `drizzle-orm` + `db/schema` and runs `db.select()` in `GET /notifications` → `route-no-direct-db`.
2. **routes.ts** runs `db.update()` in `PATCH /notifications/:id/read` → `route-no-direct-db`.
3. **service.ts** `new OctokitGitHubClient(token)` — concrete adapter instead of `container.github()` interface → depend-on-interface / `service-prefers-injected-adapters`.
4. **service.ts** imports `drizzle-orm` and runs `db.select()` in `countUnread` → `service-no-direct-db`.
5. **service.ts** imports `../agents/repository.js` (sibling module internal) → `no-cross-module-internals` (should use `container.agentsRepo`; also it's unused/dead).
6. **repository.ts** imports `renderMarkdown` from `adapters/codeindex/ripgrep.js` → `repository-no-adapters`.
7. **repository.ts** `deleteById(id)` has NO `workspaceId` predicate → workspace-guard / cross-tenant delete.
   - (bonus) `service.countUnread` query also unscoped + filters in memory.

### False-positive traps (correct code — should NOT be flagged)
- `import type { NotificationRow } from '../../db/rows.js'` in service.ts & helpers.ts — row TYPES are allowed anywhere; only `db/client` / `db/schema` runtime surface is forbidden.
- helpers.ts is pure — clean.

## Eval 2 — core purity
Contract file (`vendor/shared/contracts/notifications.ts`) — `core-stays-pure`:
8. imports `FastifyRequest` from `fastify`.
9. imports `notifications` table from `db/schema`.
10. `notificationFromRequest(req)` — presentation logic in a contract.
11. (style) hand-written `NotificationInput` interface duplicating a shape that should be a zod schema.

reviewer-core file (`reviewer-core/src/enrich.ts`) — iron rule:
12. imports `node:fs` (`readFileSync`/`existsSync`) → `core-no-node-io-builtins`.
13. imports `node:child_process` (`execSync`) → `core-no-node-io-builtins`.
14. imports `simple-git` → `core-no-io-libraries`.
- Correct fix: receive file contents / commits as arguments; keep the injected `LLMProvider` (that part is fine).

## Eval 3 — placement (constructive)
Expected correct answer:
- Layered `modules/webhooks/`: `routes.ts` (Zod + getContext + delegate), `service.ts` (orchestrate), `repository.ts` (Drizzle, workspace-scoped).
- GitHub call via `GitHubClient` interface from `container.github()`, NOT `new OctokitGitHubClient()`.
- New table added to `db/schema/*.ts` then `pnpm db:generate` (no hand-written migration).
- Contracts (request/response shapes) in `vendor/shared/contracts/` (both copies).
- Register with one line in `modules/index.ts`.
- Every repository `where` includes `workspaceId`.
