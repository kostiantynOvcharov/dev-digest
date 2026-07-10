import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http-client.js';
import { runAgentOnPrShape, type RunAgentOnPrInput } from '../schemas.js';
import { toolOk, guard } from '../format.js';
import { runReviewAndWait } from '../core/run-review.js';

export function registerRunAgentOnPr(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      description: 'Run a review agent on a pull request and return findings.',
      inputSchema: runAgentOnPrShape,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { 'anthropic/requiresUserInteraction': true },
    },
    guard<RunAgentOnPrInput>(async ({ pr_id, agent_id }) => {
      const review = await runReviewAndWait(client, { pullId: pr_id, agentId: agent_id });
      return toolOk(review);
    }),
  );
}
