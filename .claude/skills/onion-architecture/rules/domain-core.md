# Domain core — contracts and the pure engine

The core is the center of the onion. It has two homes:

1. **`server/src/vendor/shared/`** — Zod contracts + adapter **interfaces** (`@devdigest/shared`).
2. **`reviewer-core/`** — the pure review engine (diff → prompt → LLM → grounded findings).

Both are pure: no DB, no filesystem, no network, no Fastify. Every outer layer depends on
the core; the core depends on nothing but `zod` (and, in reviewer-core, the LLM HTTP client).

## Contracts live in `vendor/shared`

One Zod schema is the single source of truth for a shape — its runtime validator **and** its
TypeScript type. From `vendor/shared/adapters.ts`:

```ts
export const ModelInfo = z.object({
  id: z.string(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  label: z.string().nullish(),
  // …
});
export type ModelInfo = z.infer<typeof ModelInfo>;   // schema → type, never hand-written
```

Adapter **interfaces** also live here — the core declares *what* it needs; infrastructure
implements *how*. From the header of `vendor/shared/adapters.ts`:

> Adapter interfaces. ALL external calls go behind these interfaces. Real implementations
> live in `…/src/adapters/*`; mock implementations live alongside for tests/dev (Services
> depend on the interface, not the impl).

This inversion is the heart of the onion: `LLMProvider`, `GitHubClient`, `GitClient`,
`CodeIndex`, `Embedder`, `SecretsProvider`, `AuthProvider` are all interfaces in the core;
their concrete classes (`OpenAIProvider`, `OctokitGitHubClient`, …) live in `adapters/` (infra).

### Rules for contracts

- A contract is **pure types + zod**. It must not import `db/`, `adapters/`, `modules/`,
  `platform/`, `fastify`, or `drizzle-orm`. (Enforced: `core-stays-pure`.)
- `vendor/shared/` is vendored as **two hand-maintained copies** — `server/src/vendor/shared/`
  and `client/src/vendor/shared/` — resolved by tsconfig path alias, **not** auto-synced.
  Adding a field means editing both in lock-step (the only diff between them is comments).
- Derive types with `z.infer`; never duplicate a shape as a hand-written `interface` next to its schema.

## reviewer-core — the iron rule

`reviewer-core/CLAUDE.md` states it directly:

> **No I/O** — no DB, fs, GitHub, or persistence. Only the injected `LLMProvider`. The same
> code runs in the studio (server) and in CI. Keep it pure.

That purity is why the *same* engine runs both as local studio reviews and in CI: it takes the
diff + repo map as plain strings/objects and an injected `LLMProvider`, and returns grounded
findings. It never reaches out on its own.

Allowed in reviewer-core: `zod`, the `openai` HTTP client (the shared LLM transport), and
`@devdigest/shared` contracts. Forbidden (enforced by `reviewer-core/.dependency-cruiser.cjs`):
`drizzle-orm`/`postgres` (persistence), `octokit`/`simple-git` (GitHub/git), `fastify`, and the
Node I/O builtins `fs`/`child_process`/`net`/`http(s)`/`dns`. Need data? Receive it as an
argument. Need the model? Use the injected `LLMProvider`.

## Tell-tale signs you're putting something in the wrong place

- A "contract" that imports a Drizzle table → it's an infra type; keep the contract pure or put
  the row type in `db/rows.ts`.
- reviewer-core code that wants to read a file or call GitHub → push that to the server caller;
  pass the result in.
- A service hand-writing a type that already exists as a Zod schema in `vendor/shared` → import
  the contract instead.
