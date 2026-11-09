// Saved API keys, kept by the operating system's secret storage (Node only: used by the app's local
// server and the MCP server, never bundled into the browser app).
//
//   Windows: DPAPI (encrypted for the signed-in Windows user, via PowerShell's SecureString)
//   macOS:   the login Keychain (`security` CLI)
//   Linux:   the Secret Service (`secret-tool`), or, if unavailable, an AES-256-GCM encrypted file
//            whose key sits in ~/.data-manual/master.key (readable by this user only)
//
// ~/.data-manual/keys.json holds the list of keys (name, platform, URL, a masked hint) and, on
// Windows/fallback, the encrypted blobs. It never holds a key in plain text.
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { keyAllowedFor, type KeyEntry, type KeyKind, type NewKey } from './types';

export type { KeyEntry, KeyKind, NewKey };

interface Stored extends KeyEntry {
  method: 'dpapi' | 'keychain' | 'libsecret' | 'file';
  blob?: string;
}

const DIR = process.env.DATA_MANUAL_HOME ?? join(homedir(), '.data-manual');
const LIST = join(DIR, 'keys.json');
const SERVICE = 'data-manual';
const cache = new Map<string, string>();
/** Tests only: forget decrypted secrets so the next read goes to the OS store. */
export const clearSecretCache = () => cache.clear();

function run(cmd: string, args: string[], input?: string): Promise<string> {
  return new Promise((ok, fail) => {
    const child = execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => (err ? fail(new Error(stderr?.toString().trim() || err.message)) : ok(stdout.toString())));
    if (input != null) {
      child.stdin?.end(input);
    }
  });
}

function readList(): Stored[] {
  try {
    return JSON.parse(readFileSync(LIST, 'utf8')) as Stored[];
  } catch {
    return [];
  }
}

function writeList(list: Stored[]): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(LIST, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
}

const hint = (s: string) => (s.length > 8 ? `${s.slice(0, 3)}…${s.slice(-4)}` : '••••');
const PS = ['-NoProfile', '-NonInteractive', '-Command'];

// ---- file fallback (AES-256-GCM)
function masterKey(): Buffer {
  const f = join(DIR, 'master.key');
  if (!existsSync(f)) {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(f, randomBytes(32).toString('base64'), { mode: 0o600 });
    try {
      chmodSync(f, 0o600);
    } catch {
      // best effort on filesystems without POSIX modes
    }
  }
  return Buffer.from(readFileSync(f, 'utf8'), 'base64');
}
function encryptFile(secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
function decryptFile(blob: string): string {
  const [iv, tag, data] = blob.split('.').map((b) => Buffer.from(b, 'base64'));
  const d = createDecipheriv('aes-256-gcm', masterKey(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(data!), d.final()]).toString('utf8');
}

async function hasSecretTool(): Promise<boolean> {
  try {
    await run('secret-tool', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Where secrets go on this computer, in words (shown in the app). */
export function storageName(): string {
  if (process.platform === 'win32') return 'Windows (encrypted for your user account)';
  if (process.platform === 'darwin') return 'macOS Keychain';
  return 'your system keyring';
}

export function listKeys(): KeyEntry[] {
  return readList().map(({ method: _m, blob: _b, ...e }) => e);
}

export async function saveKey(k: NewKey): Promise<KeyEntry> {
  const secret = k.secret.trim();
  if (!secret) throw new Error('The key is empty.');
  const id = randomUUID();
  let method: Stored['method'];
  let blob: string | undefined;
  if (process.platform === 'win32') {
    method = 'dpapi';
    blob = (await run('powershell.exe', [...PS, '$s = [Console]::In.ReadToEnd(); ConvertTo-SecureString -String $s -AsPlainText -Force | ConvertFrom-SecureString'], secret)).trim();
  } else if (process.platform === 'darwin') {
    method = 'keychain';
    await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', id, '-l', `Data Manual: ${k.label}`, '-w', secret]);
  } else if (await hasSecretTool()) {
    method = 'libsecret';
    await run('secret-tool', ['store', `--label=Data Manual: ${k.label}`, 'service', SERVICE, 'id', id], secret);
  } else {
    method = 'file';
    blob = encryptFile(secret);
  }
  const entry: Stored = { id, kind: k.kind, label: k.label.trim() || k.kind, meta: k.meta ?? {}, hint: hint(secret), created: new Date().toISOString(), method, blob };
  writeList([...readList(), entry]);
  cache.set(id, secret);
  const { method: _m, blob: _b, ...pub } = entry;
  return pub;
}

export async function deleteKey(id: string): Promise<void> {
  const list = readList();
  const e = list.find((x) => x.id === id);
  if (!e) return;
  if (e.method === 'keychain') await run('security', ['delete-generic-password', '-s', SERVICE, '-a', id]).catch(() => undefined);
  if (e.method === 'libsecret') await run('secret-tool', ['clear', 'service', SERVICE, 'id', id]).catch(() => undefined);
  writeList(list.filter((x) => x.id !== id));
  cache.delete(id);
}

export function findKey(idOrLabel: string): KeyEntry | undefined {
  const list = listKeys();
  return list.find((k) => k.id === idOrLabel) ?? list.find((k) => k.label.toLowerCase() === idOrLabel.toLowerCase());
}

/** The secret for a saved key (cached in memory for the life of this process). */
export async function getSecret(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit) return hit;
  const e = readList().find((x) => x.id === id);
  if (!e) throw new Error('That saved key no longer exists.');
  let secret: string;
  switch (e.method) {
    case 'dpapi':
      secret = (
        await run('powershell.exe', [...PS, '$b = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString -String $b; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))'], e.blob ?? '')
      ).replace(/\r?\n$/, '');
      break;
    case 'keychain':
      secret = (await run('security', ['find-generic-password', '-s', SERVICE, '-a', id, '-w'])).replace(/\n$/, '');
      break;
    case 'libsecret':
      secret = await run('secret-tool', ['lookup', 'service', SERVICE, 'id', id]);
      break;
    default:
      secret = decryptFile(e.blob ?? '');
  }
  cache.set(id, secret);
  return secret;
}

/** A saved-key reference in a URL, header or body: vault:<id> (or URL-encoded vault%3A<id>). */
export const VAULT_RE = /vault(?::|%3A)([0-9a-f-]{36})/gi;

/** Replace every vault reference in `text` with its secret, checking each key may go to `target`. */
export async function fillSecrets(text: string, target: URL): Promise<string> {
  const ids = [...new Set([...text.matchAll(VAULT_RE)].map((m) => m[1]!.toLowerCase()))];
  if (!ids.length) return text;
  const keys = new Map(listKeys().map((k) => [k.id, k]));
  const secrets = new Map<string, string>();
  for (const id of ids) {
    const k = keys.get(id);
    if (!k) throw new Error('A saved key used by this request no longer exists. Pick another key.');
    if (!keyAllowedFor(k, target)) throw new Error(`The saved key "${k.label}" belongs to a different server than ${target.host}.`);
    secrets.set(id, await getSecret(id));
  }
  return text.replace(VAULT_RE, (m, id: string) => {
    const s = secrets.get(id.toLowerCase())!;
    return m.includes('%3A') || m.includes('%3a') ? encodeURIComponent(s) : s;
  });
}

