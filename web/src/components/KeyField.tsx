// Picking an API key: saved keys first (kept in this computer's secret storage), with "Add a key"
// (paste once or load from a file, then saved) and "Use once without saving" as alternatives.
// The value is either a saved-key reference ("vault:<id>") or, for one-off use, the key itself,
// which then lives only in memory for this tab.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { deleteVaultKey, isVaultRef, keyFromFile, KIND_LABELS, loadVault, openVaultFolder, saveVaultKey, setVaultFolder, vaultRef, type KeyEntry, type KeyKind, type KeyVault } from '../connectors/keys';
import { forgetKey, listEncryptedKeys, rememberKey, unlockKey } from '../connectors/browserKeyStore';
import { Icon } from './ui';

// ---- One shared copy of the saved-key list for the whole app.
let current: KeyVault | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export async function refreshVault(): Promise<KeyVault | null> {
  current = await loadVault();
  emit();
  return current;
}
export function useVault(): KeyVault | null | undefined {
  const v = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  useEffect(() => {
    if (current === undefined) void refreshVault();
  }, []);
  return v;
}
export async function addKey(kind: KeyKind, label: string, secret: string, meta: Record<string, string> = {}): Promise<KeyEntry> {
  const k = await saveVaultKey({ kind, label, secret, meta });
  await refreshVault();
  return k;
}
export async function removeKey(id: string): Promise<void> {
  await deleteVaultKey(id);
  await refreshVault();
}

export const keyLabel = (vault: KeyVault | null | undefined, value: string) => {
  if (!isVaultRef(value)) return value ? 'key entered for this session' : 'no key';
  const k = vault?.keys.find((x) => vaultRef(x) === value);
  return k ? `${k.label} (${k.hint})` : 'missing saved key';
};

interface Props {
  kind: KeyKind;
  value: string;
  onChange(value: string): void;
  /** Non-secret details saved with a new key (REDCap URL, AI base URL, ...); also filters the list. */
  meta?: Record<string, string>;
  /** Default name for a new key. */
  suggestedLabel?: string;
  label?: string;
  hint?: string;
}

export function KeyField({ kind, value, onChange, meta = {}, suggestedLabel, label = 'API key', hint }: Props) {
  const vault = useVault();
  const matches = (k: KeyEntry) => k.kind === kind && Object.entries(meta).every(([m, v]) => !v || !k.meta[m] || k.meta[m] === v);
  const saved = vault?.keys.filter(matches) ?? [];
  const [mode, setMode] = useState<'pick' | 'add' | 'once'>(() => (value && !isVaultRef(value) ? 'once' : 'pick'));
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Nothing saved yet: go straight to adding one (or one-off entry when keys can't be saved here).
  useEffect(() => {
    if (vault === undefined) return;
    if (!vault && mode !== 'once') setMode('once');
    else if (vault && mode === 'pick' && !saved.length) setMode('add');
    else if (vault && mode === 'pick' && !value && saved.length) onChange(vaultRef(saved[saved.length - 1]!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, saved.length]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const k = await addKey(kind, name.trim() || suggestedLabel || `${KIND_LABELS[kind]} key`, secret, Object.fromEntries(Object.entries(meta).filter(([, v]) => v)));
      setSecret('');
      setName('');
      setMode('pick');
      onChange(vaultRef(k));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fromFile = async (f: File) => {
    try {
      setSecret(await keyFromFile(f));
      if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
    } catch {
      setError(`Could not read ${f.name}.`);
    }
  };

  return (
    <div className="dm-field dm-keyfield">
      <span className="dm-label">{label}</span>
      {vault && mode === 'pick' && saved.length > 0 && (
        <div className="dm-key-pick">
          <select className="dm-input" value={isVaultRef(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
            {!isVaultRef(value) && <option value="">Choose a saved key</option>}
            {saved.map((k) => (
              <option key={k.id} value={vaultRef(k)}>
                {k.label} · {k.hint}
              </option>
            ))}
          </select>
          <button type="button" className="dm-link-btn" onClick={() => setMode('add')}>
            + Add a key
          </button>
        </div>
      )}
      {vault && mode === 'add' && (
        <div className="dm-key-add">
          <input className="dm-input dm-input-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedLabel ?? 'Name, e.g. "Sleep study"'} aria-label="Key name" />
          <div className="dm-key-secret">
            <input className="dm-input dm-input-sm" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Paste the key" autoComplete="off" aria-label="Key" />
            <label className="dm-btn dm-btn-secondary dm-btn-sm" title="A text file holding the key (or a KEY=value line)">
              From file
              <input type="file" accept=".txt,.env,.key,text/plain" hidden onChange={(e) => e.target.files?.[0] && void fromFile(e.target.files[0])} />
            </label>
          </div>
          <div className="dm-key-actions">
            <button type="button" className="dm-btn dm-btn-primary dm-btn-sm" disabled={busy || !secret.trim()} onClick={() => void save()}>
              <Icon name="lock" size={14} /> Save to {vault.storage}
            </button>
            {saved.length > 0 && (
              <button type="button" className="dm-link-btn" onClick={() => setMode('pick')}>
                Cancel
              </button>
            )}
            <button type="button" className="dm-link-btn" onClick={() => (setMode('once'), onChange(''))}>
              Use once without saving
            </button>
          </div>
        </div>
      )}
      {vault === null && <BrowserKey kind={kind} value={value} onChange={onChange} label={suggestedLabel ?? `${KIND_LABELS[kind]} key`} />}
      {(mode === 'once' || vault === null) && (
        <div className="dm-key-once">
          <input className="dm-input" type="password" value={isVaultRef(value) ? '' : value} onChange={(e) => onChange(e.target.value)} placeholder="Paste the key" autoComplete="off" aria-label="Key" />
          {vault && (
            <button type="button" className="dm-link-btn" onClick={() => (setMode(saved.length ? 'pick' : 'add'), onChange(saved.length ? vaultRef(saved[saved.length - 1]!) : ''))}>
              Use a saved key instead
            </button>
          )}
        </div>
      )}
      {error && <span className="dm-bad dm-hint">{error}</span>}
      <span className="dm-hint">
        {vault === null
          ? 'Without “Remember”, the key is forgotten when you close the tab.'
          : mode === 'once'
            ? 'Used for this session only and never stored.'
            : mode === 'add'
              ? `Saved keys are stored by ${vault?.storage ?? 'your computer'}, not in the browser. The app only ever sees their names.`
              : (hint ?? 'Kept in your computer\'s secure storage; the app never sees the key itself.')}
      </span>
    </div>
  );
}

/** Settings panel: every saved key, with delete, and the folder they're kept in. */
export function SavedKeysList() {
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);
  if (vault === undefined) return <p className="dm-hint">Loading…</p>;
  if (vault === null) return <BrowserKeysList />;
  return (
    <>
      {vault.keys.length ? (
        <ul className="dm-keys">
          {vault.keys.map((k) => (
            <li key={k.id}>
              <span>
                <strong>{k.label}</strong>
                <span className="dm-hint">
                  {KIND_LABELS[k.kind]} · {k.hint}
                  {k.meta.url ? ` · ${new URL(k.meta.url).host}` : ''}
                  {k.meta.datacenter ? ` · ${k.meta.datacenter}` : ''}
                </span>
              </span>
              <button
                className="dm-icon-btn"
                aria-label={`Delete ${k.label}`}
                title="Delete this key from this computer"
                onClick={() => removeKey(k.id).catch((e: Error) => setError(e.message))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dm-hint">No saved keys yet. Add one wherever a key is asked for (Data Import, AI Study Generator).</p>
      )}
      {error && <p className="dm-bad dm-hint">{error}</p>}
      <KeyFolderSetting vault={vault} />
    </>
  );
}

/** Where the key list and encrypted keys are kept, with a way to move them. */
function KeyFolderSetting({ vault }: { vault: KeyVault }) {
  const [editing, setEditing] = useState(false);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!vault.folder) return <p className="dm-hint">Encrypted by {vault.storage}.</p>;
  const win = vault.storage.startsWith('Windows');
  const what = win || vault.storage === 'your system keyring' ? 'The key list and the encrypted keys' : 'The key list (the keys themselves are in the ' + vault.storage + ')';
  const move = async (to: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await setVaultFolder(to);
      await refreshVault();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dm-keyfolder">
      <div className="dm-keyfolder-row">
        <span className="dm-hint">Folder</span>
        <code title={vault.folder}>{vault.folder}</code>
      </div>
      <p className="dm-hint">
        {what} are kept here, encrypted by {vault.storage}.
        {vault.source === 'env' ? ' This folder is set by the DATA_MANUAL_HOME environment variable.' : ''}
        {vault.source === 'host' ? ' Your R session reads and saves keys here. Change the folder in the standalone app.' : ''}
      </p>
      {editing ? (
        <form
          className="dm-keyfolder-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void move(dir);
          }}
        >
          <input className="dm-input" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={win ? 'D:\Secure\data-manual-keys' : '/Volumes/Secure/data-manual-keys'} autoFocus spellCheck={false} />
          <button className="dm-btn dm-btn-primary dm-btn-sm" disabled={busy || !dir.trim()}>
            {busy ? 'Moving…' : 'Move keys here'}
          </button>
          <button type="button" className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="dm-keyfolder-actions">
          <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => openVaultFolder().catch((e: Error) => setError(e.message))}>
            Open folder
          </button>
          {vault.source !== 'env' && vault.source !== 'host' && (
            <button
              className="dm-btn dm-btn-secondary dm-btn-sm"
              onClick={() => {
                setDir(vault.folder ?? '');
                setEditing(true);
              }}
            >
              Change folder…
            </button>
          )}
          {vault.source === 'chosen' && (
            <button className="dm-btn dm-btn-ghost dm-btn-sm" disabled={busy} onClick={() => void move(null)}>
              Back to default
            </button>
          )}
        </div>
      )}
      {editing && <p className="dm-hint">Any keys already saved move with it. The folder is created if it doesn't exist. Keys encrypted by Windows only open for your Windows account, wherever the folder is.</p>}
      {error && <p className="dm-bad dm-hint">{error}</p>}
    </div>
  );
}

/**
 * The online version (no local app server): optionally remember a key in this browser, encrypted
 * with a passphrase, and unlock it on later visits.
 */
function BrowserKey({ kind, value, onChange, label }: { kind: KeyKind; value: string; onChange(v: string): void; label: string }) {
  const [stored, setStored] = useState(() => listEncryptedKeys().find((k) => k.kind === kind));
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // A remembered key that isn't unlocked yet.
  if (stored && !value)
    return (
      <form className="dm-key-unlock" onSubmit={(e) => (e.preventDefault(), void run(async () => (onChange(await unlockKey(stored, pass)), setPass(''))))}>
        <span className="dm-hint">
          <Icon name="lock" size={13} /> {stored.label} ({stored.hint}) is saved in this browser, encrypted.
        </span>
        <div className="dm-key-secret">
          <input className="dm-input dm-input-sm" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" autoComplete="current-password" aria-label="Passphrase" />
          <button className="dm-btn dm-btn-primary dm-btn-sm" disabled={busy || !pass}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
        <button type="button" className="dm-link-btn" onClick={() => (forgetKey(kind), setStored(undefined))}>
          Forget the saved key
        </button>
        {error && <span className="dm-bad dm-hint">{error}</span>}
      </form>
    );
  if (stored)
    return (
      <span className="dm-hint">
        <Icon name="lock" size={13} /> Unlocked: {stored.label} ({stored.hint}), saved encrypted in this browser.{' '}
        <button type="button" className="dm-link-btn" onClick={() => (forgetKey(kind), setStored(undefined), onChange(''))}>
          Forget it
        </button>
      </span>
    );
  if (!value || isVaultRef(value)) return null;
  return (
    <div className="dm-key-remember">
      <label className="dm-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this key in this browser, encrypted with a passphrase
      </label>
      {remember && (
        <form className="dm-key-secret" onSubmit={(e) => (e.preventDefault(), void run(async () => setStored(await rememberKey(kind, label, value, pass))))}>
          <input className="dm-input dm-input-sm" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase (8+ characters)" autoComplete="new-password" aria-label="Passphrase" />
          <input className="dm-input dm-input-sm" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Again" autoComplete="new-password" aria-label="Passphrase again" />
          <button className="dm-btn dm-btn-primary dm-btn-sm" disabled={busy || pass.length < 8 || pass !== pass2}>
            {busy ? 'Encrypting…' : 'Remember'}
          </button>
        </form>
      )}
      {remember && <span className="dm-hint">Only the encrypted key is kept; the passphrase is never stored, so it can’t be recovered. You’ll type it once per visit.</span>}
      {error && <span className="dm-bad dm-hint">{error}</span>}
    </div>
  );
}

/** Settings (online version): keys remembered in this browser, encrypted, with a way to forget each. */
function BrowserKeysList() {
  const [keys, setKeys] = useState(listEncryptedKeys);
  return (
    <>
      <p className="dm-hint">
        This online version has no access to your computer's secure key storage. A key is used for the tab you enter it in, unless you choose <strong>Remember</strong>: then it's kept in this
        browser encrypted with a passphrase you choose (asked for once per visit). The installed app saves keys in your computer's secure storage instead.
      </p>
      {keys.length > 0 && (
        <ul className="dm-keys">
          {keys.map((k) => (
            <li key={k.kind}>
              <span>
                <strong>{k.label}</strong>
                <span className="dm-hint">
                  {KIND_LABELS[k.kind]} · {k.hint} · encrypted in this browser
                </span>
              </span>
              <button className="dm-icon-btn" aria-label={`Forget ${k.label}`} title="Forget this key" onClick={() => (forgetKey(k.kind), setKeys(listEncryptedKeys()))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
