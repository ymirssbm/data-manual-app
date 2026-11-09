// Saved platform connections ("My REDCap projects", the Qualtrics account). Only non-secret details
// are stored in the browser: the token field holds a saved-key reference ("vault:<id>"), whose secret
// lives in the computer's own secure storage (see connectors/keys.ts). A key typed in for one-off use
// stays in memory and is never written to browser storage.
import { isVaultRef } from './keys';

export interface RedcapProject {
  url: string;
  title: string;
  projectId: string;
  /** "vault:<id>" (saved) or, for this session only, the key itself. */
  token: string;
}

export interface SavedConnections {
  qualtrics: { datacenter: string; token: string } | null;
  redcap: RedcapProject[];
}

const KEY = 'data-manual:connections';
const EMPTY: SavedConnections = { qualtrics: null, redcap: [] };

export function loadConnections(): SavedConnections {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const c = JSON.parse(raw) as Partial<SavedConnections>;
    return { qualtrics: c.qualtrics ?? null, redcap: c.redcap ?? [] };
  } catch {
    return EMPTY;
  }
}

/** True when an older version left a plain-text token in browser storage. */
export const hasPlainTokens = (c: SavedConnections) => !!(c.qualtrics && !isVaultRef(c.qualtrics.token)) || c.redcap.some((p) => !isVaultRef(p.token));

export function saveConnections(c: SavedConnections): void {
  try {
    const keep: SavedConnections = {
      qualtrics: c.qualtrics && isVaultRef(c.qualtrics.token) ? c.qualtrics : null,
      redcap: c.redcap.filter((p) => isVaultRef(p.token)),
    };
    localStorage.setItem(KEY, JSON.stringify(keep));
    sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable: connections last until the page closes
  }
}
