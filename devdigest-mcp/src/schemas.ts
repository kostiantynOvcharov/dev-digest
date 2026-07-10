/**
 * Zod input shapes for the tools. Flat primitives, each with a `.describe()`
 * (Tool Search matches argument names + descriptions). Tools take internal IDs
 * directly — pr_id (pull uuid), agent_id (from list_agents), repo_id.
 *
 * These are raw `ZodRawShape`s (what `McpServer.registerTool({ inputSchema })`
 * expects), not `z.object(...)`.
 */
import { z } from 'zod';

const prIdArg = z.string().describe("Pull request ID, e.g. 'pr-abc123'");

const agentIdArg = z
  .string()
  .describe(
    "Agent ID from list_agents, e.g. 'agent-456'. Always a specific agent — to run all agents call this tool once per agent.",
  );

const repoIdArg = z.string().describe("Repository ID, e.g. 'repo-789'");

export const runAgentOnPrShape = {
  pr_id: prIdArg,
  agent_id: agentIdArg,
};

export const getFindingsShape = {
  pr_id: prIdArg,
  all_runs: z
    .boolean()
    .optional()
    .describe('If true, return findings from all runs, not just the latest per agent'),
};

export const getConventionsShape = {
  repo_id: repoIdArg,
};

export const getBlastRadiusShape = {
  pr_id: prIdArg,
};

export type RunAgentOnPrInput = z.infer<z.ZodObject<typeof runAgentOnPrShape>>;
export type GetFindingsInput = z.infer<z.ZodObject<typeof getFindingsShape>>;
export type GetConventionsInput = z.infer<z.ZodObject<typeof getConventionsShape>>;
export type GetBlastRadiusInput = z.infer<z.ZodObject<typeof getBlastRadiusShape>>;
