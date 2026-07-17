// Real end-to-end: run_agent_on_pr (paid LLM run) through the MCP protocol.
// Usage: node scripts/run-e2e.mjs <prId> <agentId>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PR_ID = process.argv[2];
const AGENT_ID = process.argv[3];
if (!PR_ID || !AGENT_ID) {
  console.error('Usage: node scripts/run-e2e.mjs <prId> <agentId>');
  process.exit(2);
}

const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'] });
const client = new Client({ name: 'run-e2e', version: '0.0.0' });
await client.connect(transport);

console.error(`[e2e] run_agent_on_pr pr_id=${PR_ID} agent_id=${AGENT_ID} — blocking…`);
const t0 = Date.now();
const res = await client.callTool({
  name: 'run_agent_on_pr',
  arguments: { pr_id: PR_ID, agent_id: AGENT_ID },
});
console.error(`[e2e] done in ${((Date.now() - t0) / 1000).toFixed(1)}s · isError=${res.isError ?? false}`);
console.log('CONTENT:', res.content?.[0]?.text ?? '');
console.log('STRUCTURED:', JSON.stringify(res.structuredContent ?? null, null, 2));

await client.close();
