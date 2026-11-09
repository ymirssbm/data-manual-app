// Data Manual MCP server: lets AI assistants (Claude, ChatGPT, Copilot, ...) design studies, pull
// data and generate codebooks, data dictionaries and flowcharts in a folder on this computer.
//
//   Desktop apps with a config file:  node data-manual-mcp.mjs --dir <study folder>        (stdio)
//   Apps that take a URL:             node data-manual-mcp.mjs --http [--port 8765]        (http://localhost:8765/mcp)
//   Web apps (claude.ai, ChatGPT):    node data-manual-mcp.mjs --http --public             (adds a temporary https link)
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools';

const VERSION = '0.1.0';

const INSTRUCTIONS = `Data Manual documents research studies. The current study is study.json in the working folder.
Typical flow: get_study_schema, then save_study to create a study (or import_file / pull_data to bring one in), then generate_codebook, generate_data_dictionary, survey_flowchart, export_study.
Always send the whole study to save_study. No tool returns participant responses; describe_variable gives aggregate statistics only.`;

interface Args {
  dir: string;
  http: boolean;
  port: number;
  isPublic: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(`data-manual-mcp ${VERSION}
  --dir <folder>   study folder (default: DATA_MANUAL_DIR or the current folder)
  --http           serve over HTTP instead of stdio
  --port <n>       HTTP port (default 8765)
  --public         also open a temporary public https link (needs cloudflared on PATH); pull_data is disabled
`);
    process.exit(0);
  }
  const isPublic = argv.includes('--public');
  return {
    dir: resolve(get('--dir') ?? process.env.DATA_MANUAL_DIR ?? process.cwd()),
    http: argv.includes('--http') || isPublic,
    port: Number(get('--port') ?? 8765),
    isPublic,
  };
}

function newServer(args: Args): McpServer {
  const server = new McpServer({ name: 'data-manual', version: VERSION }, { instructions: INSTRUCTIONS });
  registerTools(server, { dir: args.dir, isPublic: args.isPublic });
  return server;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

async function serveHttp(args: Args): Promise<void> {
  const http = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/mcp') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Data Manual MCP server: use the /mcp endpoint.');
      return;
    }
    try {
      // Stateless: a fresh server and transport per request.
      const server = newServer(args);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.method === 'POST' ? await readBody(req) : undefined);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: (e as Error).message }, id: null }));
    }
  });
  await new Promise<void>((ok, fail) => {
    http.once('error', fail);
    http.listen(args.port, args.isPublic ? '127.0.0.1' : '127.0.0.1', () => ok());
  });
  const local = `http://localhost:${args.port}/mcp`;
  process.stderr.write(`Data Manual MCP server is on.\n  Study folder   : ${args.dir}\n  Desktop AI apps: ${local}\n`);
  if (args.isPublic) {
    const tunnel = openTunnel(args.port);
    process.on('exit', () => tunnel?.kill());
  }
  process.stderr.write('Paste a link into your AI tool\'s connector / MCP settings. Press Ctrl+C to stop.\n');
}

/** A temporary public https link through Cloudflare's free quick tunnels (no account). */
function openTunnel(port: number): ChildProcess | null {
  let proc: ChildProcess;
  try {
    proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    process.stderr.write('Could not start cloudflared. Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) for a public link.\n');
    return null;
  }
  proc.on('error', () => process.stderr.write('cloudflared was not found on PATH. Install it for a public link; desktop apps can still use the local link.\n'));
  const scan = (buf: Buffer) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
    if (m) process.stderr.write(`  Web AI apps    : ${m[0]}/mcp  (anyone with this link can use these tools; stop the server when done)\n`);
  };
  proc.stdout?.on('data', scan);
  proc.stderr?.on('data', scan);
  return proc;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.dir)) mkdirSync(args.dir, { recursive: true });
  if (args.http) {
    await serveHttp(args);
  } else {
    // stdio: stdout carries the protocol, so all messages go to stderr.
    await newServer(args).connect(new StdioServerTransport());
    process.stderr.write(`Data Manual MCP server (stdio), study folder: ${args.dir}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
