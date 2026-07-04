#!/usr/bin/env node
/**
 * devdigest-mcp — local stdio MCP server exposing DevDigest's PR reviewer.
 *
 * It is a thin HTTP client over the running DevDigest API (default :3001).
 * stdout is the JSON-RPC channel — NEVER write to it; all logging goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DevDigestClient } from './http-client.js';
import { registerAllTools } from './tools/index.js';

// Kept short (Tool Search shows this at session start; truncated at ~2KB).
const INSTRUCTIONS = `DevDigest local PR reviewer. Use these tools to review GitHub pull requests with configured AI review agents and read the results.

- list_agents: list configured review agents (get a valid agent id here).
- run_agent_on_pr: run an agent on a PR and wait for grounded findings (verdict + findings). The only tool that starts a paid LLM run.
- get_findings: read the verdict + findings of an already-reviewed PR.
- get_conventions: read the coding conventions DevDigest learned for a repo.
- get_blast_radius: PR impact map (stubbed — not implemented yet).

Reach for these when asked to review a PR, list reviewers, or inspect review findings/conventions. Requires the DevDigest API running on :3001.`;

async function main(): Promise<void> {
  const client = new DevDigestClient();
  const server = new McpServer(
    { name: 'devdigest-mcp', version: '0.0.0' },
    { instructions: INSTRUCTIONS },
  );

  registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout carries JSON-RPC.
  console.error(`[devdigest-mcp] ready on stdio · API base ${client.baseUrl}`);
}

main().catch((err: unknown) => {
  console.error('[devdigest-mcp] fatal:', err);
  process.exit(1);
});
