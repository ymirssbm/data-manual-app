// Saved API keys: the real OS secret store of the machine running the tests (DPAPI on Windows,
// Keychain on macOS, secret-tool or the encrypted-file fallback on Linux), in a temporary folder.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'dm-keys-'));
process.env.DATA_MANUAL_HOME = home;
const store = await import('../src/keystore/node');
afterAll(async () => {
  for (const k of store.listKeys()) await store.deleteKey(k.id);
  rmSync(home, { recursive: true, force: true });
});

describe('saved API keys', () => {
  it('stores a key without writing it in plain text, and reads it back', { timeout: 30000 }, async () => {
    const secret = 'test-token-ABCDEF123456';
    const k = await store.saveKey({ kind: 'redcap', label: 'Sleep study', secret, meta: { url: 'https://redcap.example.edu/api/' } });
    expect(k.hint).toBe('tes…3456');
    expect(readFileSync(join(home, 'keys.json'), 'utf8')).not.toContain(secret);
    store.clearSecretCache();
    expect(await store.getSecret(k.id)).toBe(secret);
    expect(store.findKey('sleep study')?.id).toBe(k.id);
  });

  it('fills a saved key only into requests for its own server', { timeout: 30000 }, async () => {
    const k = store.findKey('Sleep study')!;
    const body = `token=vault%3A${k.id}&content=metadata`;
    expect(await store.fillSecrets(body, new URL('https://redcap.example.edu/api/'))).toBe('token=test-token-ABCDEF123456&content=metadata');
    await expect(store.fillSecrets(body, new URL('https://evil.example.com/api/'))).rejects.toThrow(/different server/);
    await store.deleteKey(k.id);
    expect(store.listKeys()).toHaveLength(0);
    await expect(store.fillSecrets(body, new URL('https://redcap.example.edu/api/'))).rejects.toThrow(/no longer exists/);
  });
});
