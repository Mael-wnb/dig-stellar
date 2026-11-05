// Minimal MCP client: spawns the built server (dist/cli.js) over stdio, lists the tools and
// calls list_protocols and get_pool against the configured API (production by default).
//   pnpm -C packages/mcp build && pnpm -C packages/mcp example [pool-slug]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2] ?? 'blend-fixed-pool';
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [cli], env: { ...process.env } as Record<string, string> });
const client = new Client({ name: 'stdio-example', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`server tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);

for (const call of [
  { name: 'list_protocols', arguments: {} },
  { name: 'get_pool', arguments: { slug } },
]) {
  const result = (await client.callTool(call)) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  const [summary, json] = result.content.map((c) => c.text ?? '');
  console.log(`\n# ${call.name} ${JSON.stringify(call.arguments)}${result.isError ? ' [error]' : ''}`);
  console.log(`  ${summary}`);
  if (json) console.log(`  payload: ${json.length} chars of JSON, starts ${json.slice(0, 80)}...`);
}

await client.close();
