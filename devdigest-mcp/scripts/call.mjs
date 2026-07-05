// Functional test: call each read tool + error paths through the MCP protocol.
// Usage: node scripts/call.mjs <prId> <repoId>
//   e.g. node scripts/call.mjs a23e635c-cb87-4230-8bb8-ff3fa63d1c30 508e60af-755c-4457-83fa-65d9a0f5d7e5
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PR_ID = process.argv[2];
const REPO_ID = process.argv[3];
if (!PR_ID || !REPO_ID) {
  console.error('Usage: node scripts/call.mjs <prId> <repoId>');
  process.exit(2);
}

const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'] });
const client = new Client({ name: 'call', version: '0.0.0' });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  console.log('▶', name, JSON.stringify(args));
  console.log('  isError:', res.isError ?? false);
  console.log('  text   :', text.length > 400 ? text.slice(0, 400) + '…' : text);
  console.log();
}

await call('list_agents', {});
await call('get_conventions', { repo_id: REPO_ID });
await call('get_blast_radius', { pr_id: PR_ID });
await call('get_findings', { pr_id: PR_ID });
await call('get_findings', { pr_id: PR_ID, all_runs: true });
// Forward-leading error path (bad id → 422 with hint):
await call('get_findings', { pr_id: 'not-a-uuid' });

await client.close();
