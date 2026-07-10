/**
 * Tool registry barrel. Registers all five tools against the MCP server.
 * (Kept flat and explicit so each tool lives in its own file.)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http-client.js';
import { registerListAgents } from './list-agents.js';
import { registerRunAgentOnPr } from './run-agent-on-pr.js';
import { registerGetFindings } from './get-findings.js';
import { registerGetConventions } from './get-conventions.js';
import { registerGetBlastRadius } from './get-blast-radius.js';

export function registerAllTools(server: McpServer, client: DevDigestClient): void {
  registerListAgents(server, client);
  registerRunAgentOnPr(server, client);
  registerGetFindings(server, client);
  registerGetConventions(server, client);
  registerGetBlastRadius(server, client);
}
