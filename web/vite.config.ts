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
 * Relay for APIs that refuse browser requests (no CORS): REDCap, Qualtrics, and
 * OpenAI-compatible chat endpoints. The browser sends the real URL in
 * x-target-url to /proxy/http (or /proxy/ai). Only https URLs of these shapes
 * are forwarded, and only auth/content headers are passed on:
 *   - REDCap API:      https://<host>/<...>/api/          (POST)
 *   - Qualtrics API:   https://<dc>.qualtrics.com/API/v3/... (GET/POST)
 *   - Chat completions https://<host>/.../chat/completions (POST)
 */
export function relayAllowed(url: URL, method: string): boolean {
  if (url.protocol !== 'https:') return false;
  if (/\.qualtrics\.com$/i.test(url.hostname) && url.pathname.startsWith('/API/v3/')) return method === 'GET' || method === 'POST';
  if (method !== 'POST') return false;
  return /\/api\/?$/i.test(url.pathname) || url.pathname.endsWith('/chat/completions');
}

function apiRelay(): Plugin {
  const forward = ['authorization', 'api-key', 'x-api-token', 'content-type', 'accept'];
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== '/proxy/http' && req.url !== '/proxy/ai') return next();
    const send = (status: number, message: string) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message } }));
    };
    let url: URL;
    try {
      url = new URL(String(req.headers['x-target-url'] ?? ''));
    } catch {
      return send(400, 'Missing or invalid x-target-url');
    }
    const method = req.method ?? 'GET';
    if (!relayAllowed(url, method)) return send(403, 'This URL is not one the relay forwards (REDCap /api/, Qualtrics /API/v3/, or /chat/completions over https).');
    const headers: Record<string, string> = {};
    for (const h of forward) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;
    let body: Buffer | undefined;
    if (method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = Buffer.concat(chunks);
    }
    try {
      const upstream = await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      send(502, `Could not reach ${url.host}: ${(e as Error).message}`);
    }
  };
  return {
    name: 'data-manual-api-relay',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), apiRelay()],
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
