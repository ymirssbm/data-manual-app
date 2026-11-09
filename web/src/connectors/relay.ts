// Calls an external API through the app's local relay (see vite.config.ts),
// because REDCap, Qualtrics and many AI endpoints refuse browser requests.

export class ConnectorError extends Error {}

/** Outside a browser (the MCP server runs in Node) there is no CORS, so calls go straight to the API. */
export const DIRECT = typeof window === 'undefined';

/**
 * In Node, the host (the MCP server) supplies saved keys: it replaces "vault:<id>" references with
 * the secret, refusing keys that belong to another server. In the browser the local server does it.
 */
type Resolver = (text: string, target: URL) => Promise<string>;
let resolver: Resolver | null = null;
export function setSecretResolver(fn: Resolver): void {
  resolver = fn;
}
export async function resolveSecrets(text: string, target: URL): Promise<string> {
  if (!/vault(?::|%3A)/i.test(text)) return text;
  if (!resolver) throw new ConnectorError('Saved keys are not available here.');
  return resolver(text, target);
}

export async function relayFetch(target: string, init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}): Promise<Response> {
  let res: Response;
  if (DIRECT) {
    try {
      const url = new URL(target);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k] = await resolveSecrets(v, url);
      const body = init.body == null ? undefined : await resolveSecrets(init.body, url);
      return await fetch(await resolveSecrets(target, url), { method: init.method ?? 'GET', signal: init.signal, headers, body });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ConnectorError(`Could not reach ${new URL(target).host}: ${(e as Error).message}`);
    }
  }
  try {
    res = await fetch('/proxy/http', {
      method: init.method ?? 'GET',
      signal: init.signal,
      // x-data-manual lets the local server swap saved keys into this request (see src/server/relay.ts).
      headers: { ...init.headers, 'x-target-url': target, 'x-data-manual': '1' },
      body: init.body,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ConnectorError('Could not reach the app\'s local server. Run the app with "npm run dev" (or "npm run preview").');
  }
  if ((res.headers.get('content-type') ?? '').includes('text/html') && res.ok) {
    throw new ConnectorError('API pulls need the app\'s local server (it relays requests that browsers can\'t make). Run the app with "npm run dev".');
  }
  return res;
}

/** Error text from a failed response: JSON {error:{message}}, {error: "..."}, {meta:{error}}, or raw text. */
export async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j?.error?.message ?? (typeof j?.error === 'string' ? j.error : null) ?? j?.meta?.error?.errorMessage ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
