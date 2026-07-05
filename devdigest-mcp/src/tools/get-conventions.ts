import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http-client.js';
import { getConventionsShape, type GetConventionsInput } from '../schemas.js';
import { toCompactConventions, toolOk, guard, type ConventionDto } from '../format.js';

export function registerGetConventions(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'get_conventions',
    {
      description: 'Get accepted coding conventions for a repository.',
      inputSchema: getConventionsShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard<GetConventionsInput>(async ({ repo_id }) => {
      const rows = await client.get<ConventionDto[]>(`/repos/${repo_id}/conventions`);
      const accepted = rows.filter((c) => c.status === 'accepted');
      return toolOk({ conventions: toCompactConventions(accepted) });
    }),
  );
}
