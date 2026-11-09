// Smoke test for the built MCP server: node scripts/mcp-smoke.mjs <study folder> [--http]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const http = process.argv.includes('--http');
const server = fileURLToPath(new URL('../dist-mcp/data-manual-mcp.mjs', import.meta.url));
const example = fileURLToPath(new URL('../../examples/branching-ema-study.json', import.meta.url));
const client = new Client({ name: 'smoke', version: '1' });
let proc;
if (http) {
  proc = spawn(process.execPath, [server, '--http', '--port', '8799', '--dir', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((r) => proc.stderr.on('data', (b) => String(b).includes('Paste a link') && r()));
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:8799/mcp')));
} else {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, '--dir', dir], stderr: 'ignore' }));
}
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content.map((c) => c.text).join('\n');
  console.log(`\n## ${name} ${JSON.stringify(args).slice(0, 80)}${r.isError ? '  [ERROR]' : ''}\n${t.slice(0, 600)}${t.length > 600 ? ` …(${t.length} chars)` : ''}`);
  return t;
};
const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));
await call('import_file', { path: example });
await call('validate_study');
await call('survey_flowchart');
await call('survey_flowchart', { survey: 'evening' });
await call('describe_variable', { item_id: 'ev_mood' });
await call('study_schedule');
await call('generate_codebook', { exclude: ['Outlier Plots'], include: ['Title Page'] });
await call('generate_data_dictionary');
for (const format of ['redcap', 'qualtrics', 'surveyjs', 'data-wide']) await call('export_study', { format });
const cur = await call('get_current_study');
const design = JSON.parse(cur.slice(cur.indexOf('\n\n') + 2));
design['Study.Metadata'].abstract = 'Edited through MCP.';
await call('save_study', { study_json: JSON.stringify(design), prompt: 'Change the abstract', model: 'smoke-test' });
await call('save_study', { study_json: '{"surveys": 3}', prompt: 'bad', model: 'smoke-test' });
await call('pull_data', { source: 'redcap', url: 'https://redcap.example.edu/api/' });
await client.close();
proc?.kill();
