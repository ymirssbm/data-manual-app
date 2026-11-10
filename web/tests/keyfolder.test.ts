// Moving saved keys to another folder: the list and encrypted keys move, still open, and the choice
// is remembered. Uses a fake home folder so the real ~/.data-manual is never touched.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'dm-keyfolder-'));
const fakeHome = join(root, 'home');
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DATA_MANUAL_HOME: process.env.DATA_MANUAL_HOME };
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
delete process.env.DATA_MANUAL_HOME;
vi.resetModules();
const store = await import('../src/keystore/node');

afterAll(async () => {
  for (const k of store.listKeys()) await store.deleteKey(k.id);
  Object.assign(process.env, saved);
  if (saved.DATA_MANUAL_HOME === undefined) delete process.env.DATA_MANUAL_HOME;
  rmSync(root, { recursive: true, force: true });
});

describe('key folder', () => {
  it('moves saved keys to a chosen folder and back', { timeout: 30000 }, async () => {
    const def = join(fakeHome, '.data-manual');
    expect(store.keyFolder()).toEqual({ folder: def, source: 'default' });
    const secret = 'folder-test-SECRET-987654';
    const k = await store.saveKey({ kind: 'qualtrics', label: 'Move me', secret, meta: { datacenter: 'iad1' } });

    const other = join(root, 'elsewhere', 'keys');
    expect(store.setKeyFolder(other)).toEqual({ folder: other, source: 'chosen' });
    expect(JSON.parse(readFileSync(join(def, 'location.json'), 'utf8')).dir).toBe(other);
    expect(readFileSync(join(def, 'keys.json'), 'utf8').trim()).toBe('[]');
    const moved = readFileSync(join(other, 'keys.json'), 'utf8');
    expect(moved).toContain(k.id);
    expect(moved).not.toContain(secret);
    store.clearSecretCache();
    expect(await store.getSecret(k.id)).toBe(secret);

    expect(() => store.setKeyFolder('relative/path')).toThrow(/full path/);

    expect(store.setKeyFolder(null)).toEqual({ folder: def, source: 'default' });
    expect(existsSync(join(def, 'location.json'))).toBe(false);
    store.clearSecretCache();
    expect(await store.getSecret(k.id)).toBe(secret);
  });
});
