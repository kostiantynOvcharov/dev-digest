# Onion Architecture Review — eval-2-core

Both files live in the **domain core**, the center of the onion. Per
`rules/domain-core.md` and `rules/layers.md`, the core must be pure: **no DB, no
filesystem, no network, no Fastify — only `zod`** (plus, in reviewer-core, the
injected `LLMProvider` / shared LLM HTTP client). Every outer layer may depend on
the core; the core must depend on nothing outward of it.

**Verdict: both files break core purity. `enrich.ts` is the worse offender and will
hard-fail `arch:check`.**

---

## File 1 — `server/src/vendor/shared/contracts/notifications.ts` (Domain core: contract)

This is a `vendor/shared` contract. The governing rule is `core-stays-pure` (error):
*`vendor/shared/**` must not import `db/`, `adapters/`, `modules/`, `platform/`, or
infra libs (`fastify`, `drizzle-orm`, …)*. It also must follow the contract
convention: pure types + zod, with types derived via `z.infer` — never a hand-written
duplicate of a shape that already has a schema.

### Problem 1 — contract imports Fastify (presentation framework)

```ts
import type { FastifyRequest } from 'fastify';               // line 3
```

- **Rule broken:** `core-stays-pure` — the core must not know about Fastify.
  Also the `rules/dependency-rule.md` matrix: `vendor/shared` → infra/framework = ❌.
- **Note on enforcement:** because both dependency-cruiser configs set
  `tsPreCompilationDeps: false`, a pure `import type` edge is *stripped before analysis*
  and may slip past the machine check. That is a loophole, not a license — the rule
  and the intent are still violated, and the real coupling shows up in Problem 3 below.

### Problem 2 — contract imports a Drizzle table from `db/schema`

```ts
import { notifications } from '../../../db/schema.js';       // line 4
/** The row shape as stored, derived from the Drizzle table. */
export type NotificationRow = typeof notifications.$inferSelect;  // line 19
```

- **Rule broken:** `core-stays-pure` — a contract must not import `db/`. This is the
  exact tell-tale from `rules/domain-core.md`: *"A 'contract' that imports a Drizzle
  table → it's an infra type; keep the contract pure or put the row type in
  `db/rows.ts`."*
- **Fix:** move `NotificationRow` out of the contract into `db/rows.ts`. The import
  matrix explicitly blesses importing a row *type* from `db/rows` (even from a
  service); it forbids `db/schema` (the runtime query surface). So define
  `NotificationRow` in `server/src/db/rows.ts` and let infra/application import it from
  there. The pure contract keeps only the Zod-derived `Notification`.
- **Caveat:** `notifications` is imported as a *value* but used only in a `typeof`
  position, so it too may be elided and dodge the check — same loophole as Problem 1.
  Don't rely on it; remove the import.

### Problem 3 — a runtime request-parsing function in the core (the real violation)

```ts
export function notificationFromRequest(req: FastifyRequest): NotificationInput {  // 27-34
  const body = req.body as Record<string, unknown>;
  return {
    title: String(body.title ?? ''),
    body: String(body.body ?? ''),
    level: (body.level as NotificationInput['level']) ?? 'info',
  };
}
```

- **Rule broken:** `core-stays-pure` + `rules/layers.md`. Parsing/validating an HTTP
  request is **presentation** work ("parse/validate the request (Zod), resolve
  tenancy…"). This is a *runtime* function coupling the core to the Fastify request
  shape — it does not vanish under type elision, so it is a genuine leak of the
  presentation layer into the center of the onion.
- **Fix:** delete this function from the contract. The route (`routes.ts`,
  presentation) should parse and validate `req.body` — ideally with a Zod schema — and
  hand a plain `NotificationInput` to a service. The core keeps only the *shape*, not
  the extraction-from-transport logic.

### Problem 4 — hand-written type duplicates an existing schema

```ts
export interface NotificationInput {                          // 21-25
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';   // duplicates NotificationLevel
}
```

- **Rule broken:** `rules/domain-core.md` — *"Derive types with `z.infer`; never
  duplicate a shape as a hand-written `interface` next to its schema."* The `level`
  union re-hand-codes the `NotificationLevel` enum defined on line 6, so the two can
  drift.
- **Fix:** make the input a Zod schema and derive the type, reusing `NotificationLevel`:

  ```ts
  export const NotificationInput = z.object({
    title: z.string(),
    body: z.string(),
    level: NotificationLevel,
  });
  export type NotificationInput = z.infer<typeof NotificationInput>;
  ```

  (This schema also becomes what the route parses `req.body` against in Problem 3's fix.)

### What is correct here

- The `NotificationLevel` and `Notification` Zod schemas (lines 6–15) with the
  `z.infer` type on line 16 are the canonical contract pattern: one schema is both
  runtime validator and TS type. Good.
- Putting a cross-cutting notification type in `vendor/shared/contracts/` is the right
  home for it (`rules/layers.md`: "a cross-cutting type shared between client and
  server → a contract in `vendor/shared/contracts/`").

---

## File 2 — `reviewer-core/src/enrich.ts` (Domain core: the pure engine)

reviewer-core is bound by the **iron rule**: *No I/O — no DB, fs, GitHub, or
persistence. Only the injected `LLMProvider`.* Its dependency-cruiser config enforces
`core-no-io-libraries` and `core-no-node-io-builtins` (both **error** severity), and
`rules/enforcement.md` states reviewer-core is currently at 0 violations and "must
stay that way." This file introduces **three error-level violations** and would break
`npm run arch:check`.

### Problem 1 — Node fs builtin

```ts
import { readFileSync, existsSync } from 'node:fs';          // line 2
...
if (existsSync(path)) { fileContents[file] = readFileSync(path, 'utf8'); }  // 27-28
```

- **Rule broken:** `core-no-node-io-builtins` (error) — `fs` is a forbidden Node I/O
  builtin. The engine is reading files off disk.

### Problem 2 — Node child_process builtin

```ts
import { execSync } from 'node:child_process';               // line 3
...
const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir })...  // 36-40
```

- **Rule broken:** `core-no-node-io-builtins` (error) — `child_process` shells out to
  git, which is external I/O the core must never perform.

### Problem 3 — simple-git library

```ts
import simpleGit from 'simple-git';                          // line 4
...
const git = simpleGit(repoDir);
const log = await git.log({ maxCount: 5 });                  // 32-33
```

- **Rule broken:** `core-no-io-libraries` (error) — `simple-git` is explicitly named as
  forbidden. Git access belongs behind a `GitClient` adapter on the server, not in the
  core.

### The fix (all three)

Per `rules/domain-core.md`: *"reviewer-core code that wants to read a file or call
GitHub → push that to the server caller; pass the result in. Need data? Receive it as
an argument."* The engine should be handed the already-gathered context and only build
the prompt + call the injected model. For example:

```ts
// pure: no fs, no child_process, no simple-git
export async function enrichReview(
  ctx: EnrichedContext,          // { diff, fileContents, recentCommits }
  branch: string,
  llm: LLMProvider,
): Promise<string> {
  const prompt = [
    `Branch: ${branch}`,
    `Recent commits:\n${ctx.recentCommits.join('\n')}`,
    `Changed files:\n${Object.keys(ctx.fileContents).join('\n')}`,
    'Summarize the blast radius of this change.',
  ].join('\n\n');
  const res = await llm.complete({ prompt });
  return res.text;
}
```

The **server** caller (application/infrastructure) gathers the file contents, recent
commits, and branch — reading files via an fs/GitClient adapter behind an interface —
and passes the plain `EnrichedContext` in. That keeps the same engine runnable both in
the studio and in CI, which is the whole reason for the iron rule.

### What is correct here

- The `EnrichedContext` Zod schema + `z.infer` type (lines 8–13) is the correct
  contract pattern.
- Depending on the **injected** `LLMProvider` (`import type` from `@devdigest/shared`,
  line 6) and calling `llm.complete({ prompt })` (line 49) is exactly right — the LLM
  is the *one* dependency the core is allowed, and it arrives via injection, not
  instantiation.
- Importing `zod` and (type-only) `@devdigest/shared` are the sanctioned core imports.

---

## Summary

| File | Issue | Rule | Severity |
|------|-------|------|----------|
| notifications.ts:3 | imports `fastify` | `core-stays-pure` | error (may elide as type-only) |
| notifications.ts:4,19 | imports `db/schema` Drizzle table for row type | `core-stays-pure` → move to `db/rows.ts` | error (may elide as type-only) |
| notifications.ts:27–34 | `notificationFromRequest` parses a Fastify request in the core | `core-stays-pure` / layer placement (presentation logic) | **real leak, no elision** |
| notifications.ts:21–25 | hand-written `NotificationInput` duplicating `NotificationLevel` | domain-core "derive with `z.infer`" | convention |
| enrich.ts:2,27–28 | `node:fs` file reads | `core-no-node-io-builtins` | **error — fails arch:check** |
| enrich.ts:3,36–40 | `node:child_process` shell git | `core-no-node-io-builtins` | **error — fails arch:check** |
| enrich.ts:4,32–33 | `simple-git` | `core-no-io-libraries` | **error — fails arch:check** |

Neither file is OK. `enrich.ts` is the priority: it plants three error-level I/O
imports in the pure engine and breaks the "iron rule" (currently 0 violations). Push
its file/git access to the server caller and pass the data in. `notifications.ts`
leaks both Fastify (via a runtime request-parser) and a Drizzle table into a contract;
strip it back to pure zod, relocate `NotificationRow` to `db/rows.ts`, and move request
parsing into the route. The Zod-schema-as-single-source-of-truth pattern and the
injected-`LLMProvider` usage are both done correctly and should be kept.
