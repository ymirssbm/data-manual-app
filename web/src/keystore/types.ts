// Shared by the browser app and the Node key store. Never contains a secret.
export type KeyKind = 'wearit' | 'redcap' | 'qualtrics' | 'anthropic' | 'openai';

export interface KeyEntry {
  id: string;
  kind: KeyKind;
  /** The user's name for it, e.g. "Sleep study (REDCap)". */
  label: string;
  /** Non-secret details the key belongs to: REDCap API URL, Qualtrics datacenter, AI base URL. */
  meta: Record<string, string>;
  /** First and last characters, for recognizing the key. */
  hint: string;
  created: string;
}

export interface NewKey {
  kind: KeyKind;
  label: string;
  meta?: Record<string, string>;
  secret: string;
}

/** In requests, a saved key is referenced as "vault:<id>"; the local server swaps in the secret. */
export const VAULT_PREFIX = 'vault:';
export const isVaultRef = (s: string) => s.startsWith(VAULT_PREFIX);
export const vaultId = (s: string) => s.slice(VAULT_PREFIX.length);

/**
 * Where a saved key of each kind may be sent. The relay refuses to put a key into a request to
 * any other host, so a saved key can't be pointed at the wrong server.
 */
export function keyAllowedFor(entry: KeyEntry, target: URL): boolean {
  const host = target.hostname.toLowerCase();
  switch (entry.kind) {
    case 'wearit':
      return host === 'wearables.vmhost.psu.edu';
    case 'qualtrics':
      return host.endsWith('.qualtrics.com');
    case 'redcap':
      return !!entry.meta.url && safeHost(entry.meta.url) === host;
    case 'anthropic':
      return host === 'api.anthropic.com';
    case 'openai':
      return !!entry.meta.baseUrl && safeHost(entry.meta.baseUrl) === host;
  }
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}
