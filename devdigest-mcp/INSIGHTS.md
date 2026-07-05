# Insights — devdigest-mcp (@devdigest/mcp)

Non-obvious, file-grounded findings for the local MCP server. Append-only; newest
facts win over older ones. Keep entries actionable and concrete.

## What Works
- **2026-07-04** — MCP tools return `{ content:[{type:'text',...}], structuredContent }`; type the helpers as the SDK's `CallToolResult` (from `@modelcontextprotocol/sdk/types.js`) — a hand-rolled result interface fails to assign to the `registerTool` callback (SDK type has an index signature `[x:string]:unknown` that a plain interface lacks). Evidence: `src/format.ts` `toolOk`/`toolError`.
- **2026-07-04** — `run_agent_on_pr` must BLOCK: `POST /pulls/:id/review` is fire-and-forget (returns run ids instantly); poll `GET /pulls/:id/runs` until the run's status ∈ `{done,failed,cancelled}`, then `GET /pulls/:id/reviews` filtered by `run_id`. Evidence: `src/core/run-review.ts`.

## What Doesn't Work
- **2026-07-04** — Do NOT import `@devdigest/shared` into this package via a tsconfig path alias. `tsc` pulls the whole contract source graph into the build: with no `rootDir` the output nests (`dist/server/…`, `dist/devdigest-mcp/…`) so the `bin` `dist/index.js` never exists; with `rootDir:"src"` it errors `TS6059` ("not under rootDir") — even though the imports are `import type` only (type-only files are still in the program for rootDir). Fix: define narrow local inbound types in `src/format.ts` (`ApiAgent`, `ApiRunSummary`, `PrRef`, `ReviewDto`, `ConventionDto`, `ApiFinding`) and drop the alias. Evidence: `tsconfig.json`, `src/format.ts`.

## Codebase Patterns
- **2026-07-04** — This package is a thin HTTP client over the running API on `:3001` (base from `DEVDIGEST_API_URL`), NOT an in-process consumer of server services. Layering: `src/tools/*` bind MCP (schema+annotations+map result) → `src/core/*` hold app logic (`resolve.ts`, `run-review.ts`, `findings.ts`) → `src/http-client.ts` transport. Onion/Fastify/`arch:check` do not apply here.
- **2026-07-04** — Run terminal statuses are `done|failed|cancelled` — there is NO `error` status (see server `contracts/trace.ts`). A poll loop keyed on `error` never terminates on failure. Evidence: `src/core/run-review.ts` `TERMINAL`.
- **2026-07-04** — API list routes return arrays directly (`/agents`, `/repos/:id/pulls`, `/pulls/:id/runs`, `/pulls/:id/reviews`, `/repos/:id/conventions`); only `POST /pulls/:id/review` wraps as `{ pr_id, runs, reviews }`. `GET /repos/:id/pulls` `PrMeta.id` is nullish — always guard `pull?.id`.

## Tool & Library Notes
- **2026-07-04** — stdio MCP server: stdout is the JSON-RPC channel — log ONLY to `stderr` (`console.error`), never `console.log`. Verified: `node dist/index.js` writes 0 bytes to stdout before the handshake. Evidence: `src/index.ts`.
- **2026-07-04** — `registerTool` config accepts `_meta` (used `{'anthropic/requiresUserInteraction':true}` on the paid `run_agent_on_pr`) and `annotations` (`readOnlyHint`/`idempotentHint`); `inputSchema` is a raw Zod shape (object of validators), not `z.object(...)`. Confirmed via `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`.

## Recurring Errors & Fixes
- **2026-07-04** — `TS6059 … not under rootDir`: caused by the `@devdigest/shared` alias (see What Doesn't Work). Fix = local types, no alias.
- **2026-07-04** — `GET /repos/:id/...` returns **HTTP 422 "Request validation failed"** when `:id` is not a UUID (route `params: IdParams` = `{ id: uuid }`). A human passing a repo slug like `owner/name` hits this.
- **2026-07-05 (supersedes the slug-resolution note above)** — The tool surface was redesigned to take internal IDs directly: `pr_id` (pull uuid), `agent_id`, `repo_id` — no slug/number/name resolution, so `core/resolve.ts` was deleted. A non-UUID id now surfaces the API 422; `http-client.ts` appends a "check the id is a valid resource UUID" hint on any 422. Evidence: `src/schemas.ts`, `src/http-client.ts`.

## Session Notes
### 2026-07-05
- Redesigned tool args to internal IDs: `run_agent_on_pr(pr_id, agent_id)`, `get_findings(pr_id, all_runs?)`, `get_conventions(repo_id)`, `get_blast_radius(pr_id)`. Deleted `core/resolve.ts`.
- `get_findings` now returns reviews **grouped by agent** (latest run per agent; `all_runs:true` → every run), each with `agent_id`/`agent_name`/`run_id` + nested findings. `get_conventions` filters to `status==='accepted'`.
- Tool descriptions set to the product's canonical short strings; dropped `title` fields.

### 2026-07-04
- Built `devdigest-mcp` (L04): 5 tools (`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius` stub) as a thin stdio HTTP client over the API.
- Refactored orchestration into `src/core/` (run-review, findings, resolve); tools are thin bindings.
- Verified typecheck+build+stdio startup and all read tools + error paths against the live API on :3001. The real paid `run_agent_on_pr` LLM run was left untriggered pending user consent.

## Open Questions
- **2026-07-04** — `run_agent_on_pr` blocks with no client-side timeout cap (by decision). If the API ever leaves a run non-terminal (hang), the tool polls forever — revisit with a large sanity ceiling if observed. Evidence: `src/core/run-review.ts`.
