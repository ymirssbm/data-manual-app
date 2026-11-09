// Saved platform connections ("My REDCap projects", the Qualtrics account).
// Tokens are secrets: kept for this browser tab only unless the user ticks
// "Remember on this computer", which moves them to localStorage.

export interface RedcapProject {
  url: string;
  title: string;
  projectId: string;
  token: string;
}

export interface SavedConnections {
  remember: boolean;
  qualtrics: { datacenter: string; token: string } | null;
  redcap: RedcapProject[];
}

const KEY = 'data-manual:connections';
const EMPTY: SavedConnections = { remember: false, qualtrics: null, redcap: [] };

export function loadConnections(): SavedConnections {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<SavedConnections>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveConnections(c: SavedConnections): void {
  try {
    const raw = JSON.stringify(c);
    if (c.remember) {
      localStorage.setItem(KEY, raw);
      sessionStorage.removeItem(KEY);
    } else {
      sessionStorage.setItem(KEY, raw);
      localStorage.removeItem(KEY);
    }
  } catch {
    // storage unavailable: connections last until the page closes
  }
}

export const maskToken = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : '••••');
