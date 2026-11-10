// Where the app's local-server calls go (saved keys, the API relay).
//
// Standalone, the Vite dev/preview server answers at /keys and /proxy/... (src/server/relay.ts).
// Inside R/Shiny, the R package answers instead, at one session-scoped URL that Shiny hands out
// (session$registerDataObj); the route is passed as a query parameter because that URL can't take
// extra path segments.

let endpoint: string | null = null;

/** Use the R/Shiny relay at `url` (null = the standalone local server). */
export function setHostEndpoint(url: string | null): void {
  endpoint = url;
}

/** True when an R/Shiny session is relaying requests. */
export const hostRelay = (): boolean => endpoint != null;

/** URL for a local-server route such as "/keys" or "/proxy/http". */
export function hostUrl(route: string): string {
  if (!endpoint) return route;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}route=${encodeURIComponent(route)}`;
}
