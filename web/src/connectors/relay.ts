// Calls an external API through the app's local relay (see vite.config.ts),
// because REDCap, Qualtrics and many AI endpoints refuse browser requests.

export class ConnectorError extends Error {}

/** Outside a browser (the MCP server runs in Node) there is no CORS, so calls go straight to the API. */
export const DIRECT = typeof window === 'undefined';

export async function relayFetch(target: string, init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}): Promise<Response> {
  let res: Response;
  if (DIRECT) {
    try {
      return await fetch(target, { method: init.method ?? 'GET', signal: init.signal, headers: init.headers, body: init.body });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ConnectorError(`Could not reach ${new URL(target).host}: ${(e as Error).message}`);
    }
  }
  try {
    res = await fetch('/proxy/http', {
      method: init.method ?? 'GET',
      signal: init.signal,
      headers: { ...init.headers, 'x-target-url': target },
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
