# Dependency injection — the container

The onion's inversion (inner layers define interfaces, outer layers implement them) only works
if something wires implementations to interfaces in one place. That place is
`platform/container.ts` — the **composition root**.

## What the container is

One `Container` per app instance. It holds config, the DB handle, the job runner, and the SSE
bus, and it lazily constructs adapters and shared repositories. Crucially, it is the **one file
allowed to import across every layer** — adapters, module repositories, module services,
reviewer-core — because composing them is its entire purpose. No arch rule treats `platform/` as
a `from`, so this is by design, not an exception you may copy elsewhere.

## Lazy getters resolve implementations

```ts
// platform/container.ts
get git(): GitClient {                       // returns the INTERFACE type
  if (this.overrides.git) return this.overrides.git;   // test seam first
  this._git ??= new SimpleGitClient(this.config.cloneDir);  // real impl, built once
  return this._git;
}

async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  const token = await this.secrets.get('GITHUB_TOKEN');   // secret resolved on first use
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}

get agentsRepo(): AgentsRepository {         // cross-cutting repo exposed here…
  return (this._agentsRepo ??= new AgentsRepository(this.db));
}
```

Notes:
- **Return types are interfaces** (`GitClient`, `GitHubClient`, `LLMProvider`, …) from
  `@devdigest/shared`. Callers never see the concrete class.
- **Secrets are looked up on first use**, so a missing key degrades gracefully (a feature is
  unavailable) instead of crashing boot.
- **Cross-cutting repositories** (`agentsRepo`, `reviewRepo`) are exposed on the container so a
  module needing another module's data uses `container.agentsRepo` — it never imports
  `modules/agents/repository.ts` directly. (Enforced: `no-cross-module-internals`.)

## The test seam: `ContainerOverrides`

Every swappable dependency has a slot in `ContainerOverrides`:

```ts
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  repoIntel?: RepoIntel;
  // …
}
```

Because services depend on these interfaces (not concrete classes), a test builds a `Container`
with mock implementations and the service code runs unchanged. Mock adapters live in
`adapters/mocks.ts`. This is the payoff of the whole architecture: **the core and application
layers are testable with no DB, no network, and no real vendor SDKs.**

## How to add a new dependency to the container

1. Define the interface in `vendor/shared/adapters.ts` (core).
2. Implement it under `adapters/<kind>/` (infra).
3. Add a lazy getter on `Container` returning the **interface** type, with an `overrides` check first.
4. Add an optional field to `ContainerOverrides` so tests can inject a mock.
5. Use it from a service via `this.container.<dep>` — never `new` it in the service.
