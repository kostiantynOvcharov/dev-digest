# Application layer — services

A service holds a module's business logic. It **orchestrates**: it composes repositories and
adapter *interfaces*, applies rules, and maps rows to DTOs. It does not run SQL and it does not
do raw I/O.

## Anatomy of a service (`modules/agents/service.ts`)

```ts
import type { Container } from '../../platform/container.js';
import type { Agent /* …contract types… */ } from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);   // owns its repository
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);   // data access → repository
    return rows.map(toAgentDto);                      // mapping → pure helper
  }
}
```

What this shows, and what to copy:

- **Constructor takes the `Container`.** The service reaches dependencies through it
  (`container.db`, `container.llm(...)`, `container.github()`), never by `new`-ing concrete
  infra itself.
- **All data access goes through a repository** (`this.repo.*`). The service has no `drizzle-orm`
  import and never touches `db/client`/`db/schema`. (Enforced: `service-no-direct-db`.)
- **Row → DTO mapping is a pure helper** (`toAgentDto` from `helpers.ts`), not inline in the method.
- **Return shapes are contracts** from `@devdigest/shared` (`Agent`, `AgentVersion`, …).

## Depend on interfaces, not classes

For external work, depend on the adapter **interface** and obtain the implementation from the
container. `listModels` reaches the LLM through the `LLMProvider` interface:

```ts
async listModels(provider: Provider): Promise<ModelInfo[]> {
  try {
    const llm = await this.container.llm(provider);   // returns an LLMProvider interface
    return await llm.listModels();
  } catch {
    return [];   // best-effort: degrade, don't throw, when the key isn't configured
  }
}
```

❌ Never do this in a service:

```ts
import { OpenAIProvider } from '../../adapters/llm/openai.js';   // concrete class
const llm = new OpenAIProvider(apiKey);                          // hard-wired infra → untestable
```

Because services depend on interfaces, tests swap the implementation with a mock via
`ContainerOverrides` (see `rules/dependency-injection.md`) without touching service code.

## Multi-tenancy: thread `workspaceId` inward

Services take `workspaceId` as the first argument and pass it straight to the repository, which
scopes every query. Cross-tenant reads are structurally impossible:

```ts
async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
  const agent = await this.repo.getById(workspaceId, agentId);   // workspace-scoped existence check
  if (!agent) return undefined;                                   // route maps undefined → 404
  const rows = await this.repo.listVersions(agentId);
  return rows.map(toAgentVersionDto);
}
```

Returning `undefined` for "not in this workspace" (rather than throwing) lets the route decide
the HTTP shape — keeping HTTP concerns in the presentation layer.

## Checklist for a service method

- [ ] First argument is `workspaceId` (for tenant-scoped resources).
- [ ] All persistence via `this.repo.*`; no `drizzle-orm`/`db` import.
- [ ] External calls via an interface from `container`, never a `new Concrete()`.
- [ ] Mapping/decisions in pure helpers; returns `@devdigest/shared` contract types.
- [ ] Best-effort enrichment degrades (return empty/omit) instead of throwing.
