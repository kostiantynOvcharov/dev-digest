import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http-client.js';
import { toCompactAgents, toolOk, toolError, type ApiAgent } from '../format.js';

export function registerListAgents(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'list_agents',
    {
      description: 'List configured review agents with their IDs and models.',
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const agents = await client.get<ApiAgent[]>('/agents');
        return toolOk({ agents: toCompactAgents(agents) });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
