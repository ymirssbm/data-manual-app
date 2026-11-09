// Standalone build: a static web app (dev server, GitHub Pages, etc.)
import { defineConfig, type Connect, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// The Wear-IT API sends no CORS headers, so the browser can't call it directly.
// The dev and preview servers forward /proxy/wearit/<server>/... to it.
// Only these two server paths are allowed through.
const wearitProxy: Record<string, ProxyOptions> = {
  '^/proxy/wearit/(wearables-survey|wearables-survey_sdb)/': {
    target: 'https://wearables.vmhost.psu.edu',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/proxy\/wearit/, ''),
  },
};

/**
 * Relay for OpenAI-compatible chat endpoints (Azure AI Foundry, OpenAI, ...),
 * which usually reject browser requests. POST /proxy/ai with the real URL in
 * x-target-url. Only https URLs ending in /chat/completions are forwarded, and
 * only the auth and content-type headers are passed on.
 */
function aiRelay(): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== '/proxy/ai') return next();
    const send = (status: number, message: string) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message } }));
    };
    if (req.method !== 'POST') return send(405, 'POST only');
    const target = String(req.headers['x-target-url'] ?? '');
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return send(400, 'Missing or invalid x-target-url');
    }
    if (url.protocol !== 'https:' || !url.pathname.endsWith('/chat/completions')) return send(400, 'Only https …/chat/completions endpoints can be relayed');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    for (const h of ['authorization', 'api-key']) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;
    try {
      const upstream = await fetch(url, { method: 'POST', headers, body: Buffer.concat(chunks) });
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      send(502, `Could not reach ${url.host}: ${(e as Error).message}`);
    }
  };
  return {
    name: 'data-manual-ai-relay',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), aiRelay()],
  // Relative asset paths so the built app works from any static host or subfolder.
  base: './',
  server: {
    // The authoritative schema and examples live one level up.
    fs: { allow: ['..'] },
    proxy: wearitProxy,
  },
  preview: { proxy: wearitProxy },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
