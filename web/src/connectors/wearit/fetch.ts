// Pulls every getData page for a study through the app's local proxy.
// The Wear-IT server sends no CORS headers, so browsers can't call it directly;
// the dev/preview server forwards /proxy/wearit/<server>/... to it (see vite.config.ts).

export const WEARIT_SERVERS = [
  { id: 'wearables-survey', label: 'wearables-survey' },
  { id: 'wearables-survey_sdb', label: 'wearables-survey_sdb' },
] as const;
export type WearitServer = (typeof WEARIT_SERVERS)[number]['id'];

export const WEARIT_HOST = 'https://wearables.vmhost.psu.edu';
const proxyBase = (server: string) => `/proxy/wearit/${server}`;

export interface PullOptions {
  server: WearitServer;
  studyId: string;
  token: string;
  maxPages?: number;
  signal?: AbortSignal;
  onPage?(pageNumber: number): void;
}

export class WearitError extends Error {}

export async function pullWearit({ server, studyId, token, maxPages = 5000, signal, onPage }: PullOptions): Promise<unknown[]> {
  const id = studyId.trim();
  if (!/^[\w-]+$/.test(id)) throw new WearitError('Enter a valid study ID.');
  if (!token.trim()) throw new WearitError('Enter your API token.');

  const pages: unknown[] = [];
  let url: string | null = `${proxyBase(server)}/api/getData/${encodeURIComponent(id)}`;
  while (url && pages.length < maxPages) {
    const res = await fetch(withToken(url, token.trim()), { signal, headers: { Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new WearitError('Wear-IT rejected the request: check the study ID, API token and server.');
    // A static host without the proxy answers 200 with the app's own HTML page (or a 404).
    if ((res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) || (res.status === 404 && pages.length === 0)) {
      throw new WearitError('Wear-IT pulls need the app\'s local server (it relays requests to Wear-IT). Run the app with "npm run dev" or "npm run preview".');
    }
    if (!res.ok) throw new WearitError(`Wear-IT returned an error (${res.status}).`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new WearitError('Wear-IT returned something that isn\'t JSON. Check the server selection.');
    }
    pages.push(json);
    onPage?.(pages.length);
    const next = (json as { links?: { next?: unknown } })?.links?.next;
    url = typeof next === 'string' && next ? toProxy(next, server) : null;
  }
  return pages;
}

function withToken(url: string, token: string): string {
  const u = new URL(url, window.location.origin);
  u.searchParams.set('api_token', token);
  return u.pathname + u.search;
}

/** Rewrite the server's absolute "next" links onto the proxy. */
function toProxy(next: string, server: string): string {
  try {
    const u = new URL(next, WEARIT_HOST);
    const prefix = `/${server}`;
    const path = u.pathname.startsWith(prefix) ? u.pathname.slice(prefix.length) : u.pathname;
    u.searchParams.delete('api_token');
    return `${proxyBase(server)}${path}${u.search}`;
  } catch {
    return next;
  }
}
