// The app's local server (Vite dev/preview middleware). Node only, never bundled into the app.
//
// 1. Relay for APIs that refuse browser requests (no CORS): REDCap, Qualtrics, OpenAI-compatible
//    chat endpoints (/proxy/http), the Anthropic API (/proxy/anthropic/...), and Wear-IT
//    (/proxy/wearit/..., forwarded by Vite's proxy).
// 2. Saved API keys (/keys): kept in the operating system's secret storage (src/keystore/node.ts).
//    The browser only ever holds a reference ("vault:<id>"); the relay swaps in the secret, and only
//    for the host that key belongs to.
//
// Requests that touch saved keys must carry "x-data-manual: 1" and come from this app's own origin.
// A custom header forces a CORS preflight, which this server never approves, so other websites
// can't use the keys through it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Connect, Plugin } from 'vite';
import { deleteKey, fillSecrets, keyFolder, listKeys, openKeyFolder, saveKey, setKeyFolder, storageName, VAULT_RE } from '../keystore/node';
import type { KeyEntry, NewKey } from '../keystore/types';

/**
 * Only https URLs of these shapes are forwarded:
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

function sameOrigin(req: IncomingMessage): boolean {
  if (req.headers['x-data-manual'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
const fail = (res: ServerResponse, status: number, message: string) => send(res, status, { error: { message } });

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function pipe(upstream: Response, res: ServerResponse) {
  res.statusCode = upstream.status;
  for (const h of ['content-type', 'request-id', 'retry-after']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
}

const handler: Connect.NextHandleFunction = async (req, res, next) => {
  const path = (req.url ?? '').split('?')[0]!;

  // ---- Saved keys
  if (path === '/keys' || path.startsWith('/keys/')) {
    if (!sameOrigin(req)) return fail(res, 403, 'Not allowed.');
    try {
      if (req.method === 'GET' && path === '/keys') return send(res, 200, { storage: storageName(), ...keyFolder(), keys: listKeys() });
      if (req.method === 'POST' && path === '/keys/folder') {
        const { dir } = JSON.parse((await readBody(req)).toString('utf8')) as { dir?: string | null };
        try {
          return send(res, 200, setKeyFolder(typeof dir === 'string' && dir.trim() ? dir : null));
        } catch (e) {
          return fail(res, 400, (e as Error).message);
        }
      }
      if (req.method === 'POST' && path === '/keys/open-folder') {
        await openKeyFolder();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/keys') {
        const k = JSON.parse((await readBody(req)).toString('utf8')) as NewKey;
        if (!['wearit', 'redcap', 'qualtrics', 'anthropic', 'openai'].includes(k.kind) || typeof k.secret !== 'string') return fail(res, 400, 'Invalid key.');
        return send(res, 200, await saveKey({ kind: k.kind, label: String(k.label ?? ''), meta: k.meta ?? {}, secret: k.secret }));
      }
      if (req.method === 'DELETE' && path.startsWith('/keys/')) {
        await deleteKey(decodeURIComponent(path.slice('/keys/'.length)));
        return send(res, 200, { ok: true });
      }
      return fail(res, 405, 'Method not allowed.');
    } catch (e) {
      return fail(res, 500, `Could not use this computer's key storage: ${(e as Error).message}`);
    }
  }

  // ---- Wear-IT: swap a saved key into the query string, then Vite's proxy forwards the request.
  if (path.startsWith('/proxy/wearit/') && VAULT_RE.test(req.url ?? '')) {
    VAULT_RE.lastIndex = 0;
    if (!sameOrigin(req)) return fail(res, 403, 'Not allowed.');
    try {
      req.url = await fillSecrets(req.url!, new URL('https://wearables.vmhost.psu.edu/'));
    } catch (e) {
      return fail(res, 400, (e as Error).message);
    }
    return next();
  }
  VAULT_RE.lastIndex = 0;

  // ---- Anthropic API (streams). /proxy/anthropic/v1/messages -> https://api.anthropic.com/v1/messages
  if (path.startsWith('/proxy/anthropic/')) {
    if (!sameOrigin(req)) return fail(res, 403, 'Not allowed.');
    const target = new URL(`https://api.anthropic.com/${(req.url ?? '').slice('/proxy/anthropic/'.length)}`);
    if (!target.pathname.startsWith('/v1/')) return fail(res, 403, 'Only the Anthropic /v1/ API is relayed.');
    const headers: Record<string, string> = {};
    for (const [h, v] of Object.entries(req.headers)) if (typeof v === 'string' && (h.startsWith('anthropic-') || ['x-api-key', 'content-type', 'accept'].includes(h))) headers[h] = v;
    try {
      if (headers['x-api-key']) headers['x-api-key'] = await fillSecrets(headers['x-api-key'], target);
      delete headers['anthropic-dangerous-direct-browser-access'];
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const upstream = await fetch(target, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined });
      return pipe(upstream, res);
    } catch (e) {
      return fail(res, 502, (e as Error).message);
    }
  }

  // ---- Generic relay
  if (path !== '/proxy/http' && path !== '/proxy/ai') return next();
  let url: URL;
  try {
    url = new URL(String(req.headers['x-target-url'] ?? ''));
  } catch {
    return fail(res, 400, 'Missing or invalid x-target-url');
  }
  const method = req.method ?? 'GET';
  if (!relayAllowed(url, method)) return fail(res, 403, 'This URL is not one the relay forwards (REDCap /api/, Qualtrics /API/v3/, or /chat/completions over https).');
  const headers: Record<string, string> = {};
  for (const h of ['authorization', 'api-key', 'x-api-token', 'content-type', 'accept']) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;
  try {
    let body = method === 'POST' ? (await readBody(req)).toString('utf8') : undefined;
    const usesVault = [...Object.values(headers), body ?? '', url.search].some((t) => {
      VAULT_RE.lastIndex = 0;
      return VAULT_RE.test(t);
    });
    VAULT_RE.lastIndex = 0;
    if (usesVault) {
      if (!sameOrigin(req)) return fail(res, 403, 'Not allowed.');
      for (const h of Object.keys(headers)) headers[h] = await fillSecrets(headers[h]!, url);
      if (body) body = await fillSecrets(body, url);
      url = new URL(await fillSecrets(url.href, url));
    }
    const upstream = await fetch(url, { method, headers, body });
    return pipe(upstream, res);
  } catch (e) {
    return fail(res, 502, `Could not reach ${url.host}: ${(e as Error).message}`);
  }
};

export function localServer(): Plugin {
  return {
    name: 'data-manual-local-server',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export type { KeyEntry };
