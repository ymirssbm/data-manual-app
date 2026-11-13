// Opt-in key storage for the online version (no local app server, so no OS key storage): a key is
// encrypted with a passphrase the person chooses (PBKDF2-SHA-256, 600,000 rounds, into an AES-GCM
// 256-bit key) and only the ciphertext is kept in this browser. The passphrase is never stored;
// it's asked for once per visit to unlock the key, which then lives in memory for the tab.
// Without the passphrase the stored data is useless, but anyone who can run code on this page
// while the key is unlocked can read it, as with any key typed into a web page.
import type { KeyKind } from './keys';

const STORE = 'dm.keys.encrypted';
const ROUNDS = 600_000;

export interface EncryptedKey {
  kind: KeyKind;
  label: string;
  /** Last characters of the key, to tell keys apart. */
  hint: string;
  salt: string;
  iv: string;
  data: string;
  created: string;
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ROUNDS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function listEncryptedKeys(): EncryptedKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '[]') as EncryptedKey[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(keys: EncryptedKey[]) {
  if (keys.length) localStorage.setItem(STORE, JSON.stringify(keys));
  else localStorage.removeItem(STORE);
}

/** Encrypt `secret` with `passphrase` and keep it (one per kind: a new one replaces the old). */
export async function rememberKey(kind: KeyKind, label: string, secret: string, passphrase: string): Promise<EncryptedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
  const entry: EncryptedKey = { kind, label, hint: `…${secret.trim().slice(-4)}`, salt: b64(salt), iv: b64(iv), data: b64(data), created: new Date().toISOString() };
  write([...listEncryptedKeys().filter((k) => k.kind !== kind), entry]);
  return entry;
}

/** Decrypt a remembered key. Throws "Wrong passphrase" when it doesn't open. */
export async function unlockKey(entry: EncryptedKey, passphrase: string): Promise<string> {
  try {
    const key = await derive(passphrase, unb64(entry.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(entry.iv) }, key, unb64(entry.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Wrong passphrase.');
  }
}

export function forgetKey(kind: KeyKind) {
  write(listEncryptedKeys().filter((k) => k.kind !== kind));
}
