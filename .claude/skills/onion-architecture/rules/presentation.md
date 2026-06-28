# Presentation — routes

The presentation layer is the HTTP edge: a Fastify plugin per module in `modules/<m>/routes.ts`.
Its job is narrow — validate the request, resolve tenancy, call a service, return the result. No
business logic, no SQL.

## Anatomy of a route module (`modules/agents/routes.ts`)

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Provider, ReviewStrategy } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { AgentsService } from './service.js';

const CreateAgentBody = z.object({
  name: z.string().min(1),
  provider: Provider,                 // a contract enum, reused from @devdigest/shared
  model: z.string().min(1),
  system_prompt: z.string().min(1),
  // …
});

export default async function agentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentsService(app.container);   // construct the service from the container

  app.post('/agents', { schema: { body: CreateAgentBody } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);  // tenancy at the edge
    const agent = await service.create(workspaceId, { /* …from req.body… */ }, userId);
    reply.status(201);
    return agent;
  });
}
```

## The five rules of a route

1. **Validate with Zod at the boundary.** Declare `schema: { body, params, query }`; invalid
   input is rejected (422) before your handler runs. Reuse contract schemas from
   `@devdigest/shared` (e.g. `Provider`, `ReviewStrategy`) rather than redefining them.
2. **Resolve tenancy with `getContext`.** Every handler that touches tenant data starts with
   `const { workspaceId, userId } = await getContext(app.container, req);`. This is the single
   chokepoint that makes workspace scoping impossible to forget.
3. **Delegate to a service. Never query the DB.** A route must not import `drizzle-orm`, `db/`,
   or a `repository.ts`. (Enforced: `route-no-direct-db`.) Construct the service from
   `app.container` and call it.
4. **Map domain outcomes to HTTP.** A service returns `undefined`/`false` for "not found in this
   workspace"; the route turns that into `throw new NotFoundError(...)`. HTTP status codes are a
   presentation concern and live only here.
5. **Register the plugin once.** Export a default Fastify plugin and add one line to
   `modules/index.ts` (see `rules/adding-a-module.md`).

## `getContext` — tenancy in one place

```ts
// modules/_shared/context.ts
export async function getContext(container, req): Promise<RequestContext> {
  const [user, workspace] = await Promise.all([
    container.auth.currentUser(req),
    container.auth.currentWorkspace(req),
  ]);
  return { workspaceId: workspace.id, userId: user.id };
}
```

It goes through the `AuthProvider` interface, so swapping auth (MVP `LocalNoAuthProvider` → real
auth) changes nothing in any route.

## Anti-pattern: the thin module

`settings`, `pulls`, `polling`, and `workspace` query Drizzle directly from `routes.ts`. They
predate this architecture and are grandfathered (warn-level in `arch:check`). **Do not copy
them.** A new module — or a material change to a thin one — uses `routes → service → repository`.
