# @devdigest/mcp

Local **stdio MCP server** that exposes DevDigest's PR reviewer to Claude Code /
Claude Desktop. It is a thin HTTP client over the running DevDigest API
(default `http://localhost:3001`) — it holds no domain logic, just resolves ids,
calls the existing REST routes, and returns concise structured results.

## Tools

| Tool | Args (flat) | What it does |
|------|-------------|--------------|
| `list_agents` | — | List configured review agents with their IDs and models. Get a valid `agent_id` here. |
| `run_agent_on_pr` | `pr_id`, `agent_id` | Run one agent on a PR **end-to-end**: trigger → wait for completion → return `{verdict, score, findings[]}`. The only tool that starts a (paid) LLM run. One agent per call. |
| `get_findings` | `pr_id`, `all_runs?` | Latest review verdict + findings for a PR, **grouped by agent** (latest run per agent; `all_runs:true` for every run). |
| `get_conventions` | `repo_id` | Accepted coding conventions for a repository. |
| `get_blast_radius` | `pr_id` | PR impact map. **Stub** — returns `status:"not_implemented"` (the L04 homework wires the real `RepoIntel.getBlastRadius` facade). |

- All ids are internal DevDigest UUIDs: `pr_id` = pull-request id (from the studio's pulls list / `GET /repos/:id/pulls`), `agent_id` = from `list_agents`, `repo_id` = repository id.
- Design: outcome-oriented (not operation), flat id args, concise responses, forward-leading errors.

## Run from scratch

Prerequisites: **Node ≥ 22**, **pnpm ≥ 10**.

**1. Start the DevDigest API** (the MCP server is a client of it). This does NOT
start the MCP server — see [_Not started by the app scripts_](#not-started-by-the-app-scripts).

```sh
./scripts/dev.sh          # repo root: Postgres + migrate + seed + API (:3001) + web (:3000)
# or API-only:  ./scripts/dev.sh --no-client
```

Make sure there's data: at least one repo with an imported PR (the seed provides one).

**2. Install + build the MCP server** (one-time, and after any code change):

```sh
pnpm -C devdigest-mcp install
pnpm -C devdigest-mcp build       # emits dist/ (dist/index.js is the bin)
pnpm -C devdigest-mcp typecheck   # optional
```

**3. Launch it separately, on demand — pick one:**

```sh
# a) Interactive UI to poke the tools (recommended for trying it out):
npx @modelcontextprotocol/inspector node devdigest-mcp/dist/index.js

# b) Register with Claude Code on demand (local scope — private, not committed):
claude mcp add devdigest --scope local \
  --env DEVDIGEST_API_URL=http://localhost:3001 \
  -- node devdigest-mcp/dist/index.js
claude mcp list            # verify it shows `devdigest`
claude mcp remove devdigest # unregister when done

# c) Raw stdio process (for scripting; waits on stdin for JSON-RPC):
DEVDIGEST_API_URL=http://localhost:3001 node devdigest-mcp/dist/index.js
```

`DEVDIGEST_API_URL` overrides the API base (default `http://localhost:3001`). Logs go
to **stderr**; stdout is the JSON-RPC channel.

Quick local smoke tests (dev helpers):

```sh
node devdigest-mcp/scripts/inspect.mjs                  # list tools + schemas
node devdigest-mcp/scripts/call.mjs    <prId> <repoId>  # exercise read tools + error paths
node devdigest-mcp/scripts/run-e2e.mjs <prId> <agentId> # real (paid) run
```

## Not started by the app scripts

`./scripts/dev.sh` launches **only** Postgres + API + web — it never starts this MCP
server (grep the script: zero `mcp` references). The MCP server is a separate process
spawned **on demand** by an MCP client, so it stays out of your normal app run.

The one thing that auto-starts it is **Claude Code reading the project-scoped
[`.mcp.json`](../.mcp.json)** when you open a session in this repo — and only after you
approve it on first use (toggle any time via `/mcp`). If you'd rather it never auto-load
and only ever launch it yourself via step 3 above, delete `.mcp.json` and use the local
`claude mcp add` registration (option b) instead.

Tool schemas are deferred by Claude Code's Tool Search (only tool names + the server
`instructions` load at session start), so the server adds minimal context cost.
`alwaysLoad` is intentionally NOT set.

## Security note

`run_agent_on_pr`, `get_findings`, and `get_conventions` return **LLM-derived
analysis of untrusted PR code**. Treat their text as opaque data — it can contain
adversarial instructions (prompt injection). The server returns it as JSON,
length-capped, and never interpolates it into any executed context.
