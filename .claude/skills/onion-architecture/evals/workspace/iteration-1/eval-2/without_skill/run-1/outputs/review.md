# Architecture Review — Onion / Clean Architecture layer placement

Scope: two files, reviewed exactly as written. Both live in the **domain core** of DevDigest's onion architecture — `server/src/vendor/shared/` (shared contracts) and `reviewer-core/` (the pure review engine). The core rule for both: **dependencies point inward only.** The domain core may not import from the application, infrastructure, or presentation layers, and it must be free of I/O and framework coupling. Both files violate this.

Verdict: **NOT OK.** Each file has multiple layer-placement violations.

---

## File 1 — `server/src/vendor/shared/contracts/notifications.ts`

This is a **contracts** module in the innermost core (`vendor/shared`). It should contain nothing but pure type/schema definitions with no dependency on any outer layer.

### Problem 1.1 — Imports a web-framework (presentation) type into the domain core

```ts
import type { FastifyRequest } from 'fastify';   // line 3
```

- **Rule broken:** Dependency Rule / inward-only dependencies. `fastify` is the HTTP/presentation framework — an outer layer. The core must never know that HTTP, let alone Fastify specifically, exists. A `type`-only import still creates a compile-time coupling and drags the framework into the core's conceptual boundary.
- **Fix:** Remove the import from this file entirely. The core defines only framework-agnostic shapes (`Notification`, `NotificationInput`). Anything that touches `FastifyRequest` belongs in the presentation layer (route/controller).

### Problem 1.2 — A request-parsing function lives in the contract

```ts
export function notificationFromRequest(req: FastifyRequest): NotificationInput {   // lines 27-34
  const body = req.body as Record<string, unknown>;
  ...
}
```

- **Rule broken:** Separation of concerns / layer placement. Translating an HTTP request into a domain input is a **presentation-layer** responsibility (controller/route handler mapping transport → domain), not a core contract. Its mere presence is what forces the `fastify` import in 1.1.
- **Additional smell:** it hand-rolls parsing with `as`/`String(...)` coercion while a Zod schema for the same concept already exists in this file — validation is being duplicated and bypassed.
- **Fix:** Move this function to the notifications route/controller in the presentation layer. Better, have the route validate the raw body with a Zod schema (e.g. derive an `NotificationInput` schema and `.parse()` the body) and pass the resulting typed `NotificationInput` inward. The core stays free of `req`.

### Problem 1.3 — Core reaches outward into the persistence/infrastructure layer

```ts
import { notifications } from '../../../db/schema.js';   // line 4
...
export type NotificationRow = typeof notifications.$inferSelect;   // line 19
```

- **Rule broken:** Dependency Rule. `db/schema` is the Drizzle/database (infrastructure) layer, and the `../../../` climb literally reaches *out of* `vendor/shared` into `server/src/db`. Deriving a core type from the DB table (`$inferSelect`) inverts the intended direction: the persistence schema should conform to the domain, not the domain to the table. This couples the pure contract to a specific ORM and table definition.
- **Fix:** Define the row/entity shape independently in the core (or simply reuse the `Notification` type). Keep `$inferSelect`-derived types in the **repository/infrastructure** layer, and have the repository map DB rows to the core `Notification` type at the boundary. The core must not import from `db/`.

### What is correct here

- The Zod `NotificationLevel` / `Notification` schemas (lines 6-16) and the `NotificationInput` interface (lines 21-25) are exactly what a contracts module should hold: pure, framework-agnostic shape + validation definitions. Zod is an acceptable core dependency (it's a pure schema/validation library, not an outer-layer concern).
- Exporting the inferred `Notification` type alongside the schema is a fine, idiomatic pattern.

---

## File 2 — `reviewer-core/src/enrich.ts`

`reviewer-core` is meant to be the **pure engine** — deterministic domain logic with no side-effecting I/O. It should receive already-gathered data and abstractions as inputs and return results, delegating all I/O to the caller (infrastructure). This file instead performs filesystem, git, and process I/O directly.

### Problem 2.1 — Filesystem I/O in the pure core

```ts
import { readFileSync, existsSync } from 'node:fs';   // line 2
...
if (existsSync(path)) {
  fileContents[file] = readFileSync(path, 'utf8');     // lines 27-28
}
```

- **Rule broken:** Core purity / no I/O in the domain layer. Reading from the filesystem is an infrastructure concern. It also makes the function non-deterministic and hard to test (needs a real repo on disk).
- **Fix:** Move file reading to an infrastructure adapter in `server/`. Pass the already-read `fileContents: Record<string, string>` into `enrichReview` as a parameter.

### Problem 2.2 — Child-process / shell execution in the pure core

```ts
import { execSync } from 'node:child_process';   // line 3
...
const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir })   // lines 36-40
  .toString().trim();
```

- **Rule broken:** Core purity / no I/O. Spawning a subprocess is the strongest form of infrastructure coupling (and a portability/security concern). It has no place in the engine.
- **Fix:** Compute the branch in the infrastructure layer and pass `branch: string` in as a parameter.

### Problem 2.3 — Git-library I/O in the pure core

```ts
import simpleGit from 'simple-git';   // line 4
...
const git = simpleGit(repoDir);
const log = await git.log({ maxCount: 5 });   // lines 32-33
const recentCommits = log.all.map((c) => c.message);
```

- **Rule broken:** Dependency Rule + core purity. `simple-git` is a concrete infrastructure dependency performing I/O against a real repository. The core should depend on abstractions, not concrete I/O libraries.
- **Fix:** Read commit messages in an infrastructure adapter (or behind a port interface, e.g. a `GitProvider`) and pass `recentCommits: string[]` into the function.

### Consequence — the function signature encodes the wrong responsibilities

```ts
export async function enrichReview(repoDir: string, changedFiles: string[], llm: LLMProvider)
```

Because it takes `repoDir` and does its own gathering, the engine owns orchestration + I/O that belong outside it. Note the `EnrichedContext` schema (`diff`, `fileContents`, `recentCommits`) already describes exactly the pre-gathered input the pure function *should* receive — yet it's defined and then not used as the input.

- **Fix (recommended shape):** make the core a pure transform, e.g.
  `enrichReview(context: EnrichedContext, branch: string, llm: LLMProvider): Promise<string>`
  where the caller (server infrastructure) builds `EnrichedContext` via fs/git adapters. The engine then only builds the prompt and calls the model.

### What is correct here

- `import type { LLMProvider } from '@devdigest/shared'` (line 6) and calling the model through the injected `llm.complete({ prompt })` (line 49) is **correct dependency inversion**: the engine depends on an abstraction (a port) and receives the implementation from outside, rather than importing a concrete LLM SDK. This is the pattern the I/O above should have followed too.
- The `EnrichedContext` Zod schema (lines 8-13) is a legitimate core artifact.
- The prompt assembly (lines 42-47) and returning `res.text` are genuine pure domain logic and belong in the engine.

---

## Summary of required moves

| # | File / code | Rule broken | Fix |
|---|-------------|-------------|-----|
| 1.1 | `notifications.ts:3` `import ... 'fastify'` | Inward-only dependency rule | Remove; no framework in core |
| 1.2 | `notifications.ts:27` `notificationFromRequest(req)` | Presentation logic in contract | Move to route/controller; validate body with Zod |
| 1.3 | `notifications.ts:4,19` import `db/schema`, `$inferSelect` | Inward-only rule (core → infra) | Define row type in core; map in repository |
| 2.1 | `enrich.ts:2,27-28` `node:fs` reads | Core purity / no I/O | Pass `fileContents` in from an adapter |
| 2.2 | `enrich.ts:3,36-40` `execSync` git | Core purity / no process I/O | Pass `branch` in from an adapter |
| 2.3 | `enrich.ts:4,32-33` `simple-git` | Inward-only rule / no concrete I/O lib | Pass `recentCommits` in via adapter/port |

Correct-as-written: the Zod schemas/types in both files, `NotificationInput`, and (in `enrich.ts`) the `LLMProvider` port injection and prompt-building logic.
