// Saved API keys, from the browser's side. The keys live in this computer's secret storage, managed
// by the app's local server (src/server/relay.ts); the browser only sees names and references
// ("vault:<id>"), never the secrets.
import { VAULT_PREFIX, isVaultRef, type KeyEntry, type KeyKind, type NewKey } from '../keystore/types';

export type { KeyEntry, KeyKind };
export { isVaultRef, VAULT_PREFIX };

/** Header every request touching saved keys must carry (see the relay for why). */
export const APP_HEADER = { 'x-data-manual': '1' } as const;

export interface KeyVault {
  /** Where secrets are kept, in words, e.g. "macOS Keychain". */
  storage: string;
  keys: KeyEntry[];
}

/** The saved keys, or null when there is no local server (e.g. a static website). */
export async function loadVault(): Promise<KeyVault | null> {
  try {
    const res = await fetch('/keys', { headers: APP_HEADER, cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as KeyVault;
  } catch {
    return null;
  }
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `The local server answered ${res.status}.`;
  try {
    message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
  } catch {
    // keep the status text
  }
  throw new Error(message);
}

export async function saveVaultKey(k: NewKey): Promise<KeyEntry> {
  const res = await check(await fetch('/keys', { method: 'POST', headers: { ...APP_HEADER, 'content-type': 'application/json' }, body: JSON.stringify(k) }));
  return (await res.json()) as KeyEntry;
}

export async function deleteVaultKey(id: string): Promise<void> {
  await check(await fetch(`/keys/${encodeURIComponent(id)}`, { method: 'DELETE', headers: APP_HEADER }));
}

export const vaultRef = (k: KeyEntry) => `${VAULT_PREFIX}${k.id}`;

/** Reads a key from a text file: the whole file, or the value of the first KEY=value line. */
export async function keyFromFile(file: File): Promise<string> {
  const text = (await file.text()).replace(/^﻿/, '').trim();
  const line = text.split(/\r?\n/).find((l) => /^\s*[\w.-]+\s*=/.test(l));
  const value = line ? line.slice(line.indexOf('=') + 1) : text.split(/\r?\n/)[0] ?? '';
  return value.trim().replace(/^["']|["']$/g, '');
}

export const KIND_LABELS: Record<KeyKind, string> = {
  wearit: 'Wear-IT',
  redcap: 'REDCap',
  qualtrics: 'Qualtrics',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI-compatible',
};
