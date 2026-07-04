// Ad-hoc MCP client: connects to the built server over stdio and lists tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
});
const client = new Client({ name: 'inspect', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
for (const t of tools) {
  console.log('—'.repeat(60));
  console.log('name       :', t.name);
  console.log('title      :', t.annotations?.title ?? t.title ?? '');
  console.log('readOnly   :', t.annotations?.readOnlyHint);
  console.log('idempotent :', t.annotations?.idempotentHint);
  console.log('_meta      :', JSON.stringify(t._meta ?? {}));
  console.log('inputSchema:', JSON.stringify(t.inputSchema?.properties ?? {}));
}
console.log('—'.repeat(60));
console.log('total tools:', tools.length);
await client.close();
