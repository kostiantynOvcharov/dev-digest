import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http-client.js';
import { getFindingsShape, type GetFindingsInput } from '../schemas.js';
import { toolOk, guard } from '../format.js';
import { fetchGroupedReviews } from '../core/findings.js';

export function registerGetFindings(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'get_findings',
    {
      description:
        'Get the latest review verdict and findings for a pull request, grouped by agent. ' +
        'Each review includes its findings nested inside. By default returns only the latest run per agent.',
      inputSchema: getFindingsShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard<GetFindingsInput>(async ({ pr_id, all_runs }) => {
      const reviews = await fetchGroupedReviews(client, pr_id, all_runs ?? false);
      return toolOk({ reviews });
    }),
  );
}
