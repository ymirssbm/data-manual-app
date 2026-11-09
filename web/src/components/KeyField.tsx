// Picking an API key: saved keys first (kept in this computer's secret storage), with "Add a key"
// (paste once or load from a file, then saved) and "Use once without saving" as alternatives.
// The value is either a saved-key reference ("vault:<id>") or, for one-off use, the key itself,
// which then lives only in memory for this tab.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { deleteVaultKey, isVaultRef, keyFromFile, KIND_LABELS, loadVault, saveVaultKey, vaultRef, type KeyEntry, type KeyKind, type KeyVault } from '../connectors/keys';
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
          ? "Keys can't be saved here (no local app server), so this one is forgotten when you close the tab."
          : mode === 'once'
            ? 'Used for this session only and never stored.'
            : mode === 'add'
              ? `Saved keys are stored by ${vault?.storage ?? 'your computer'}, not in the browser. The app only ever sees their names.`
              : (hint ?? 'Kept in your computer\'s secure storage; the app never sees the key itself.')}
      </span>
    </div>
  );
}

/** Settings panel: every saved key, with delete. */
export function SavedKeysList() {
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);
  if (vault === undefined) return <p className="dm-hint">Loading…</p>;
  if (vault === null) return <p className="dm-hint">Saved keys need the app's local server (npm run dev / preview). Here, keys are entered per session.</p>;
  if (!vault.keys.length) return <p className="dm-hint">No saved keys yet. Add one wherever a key is asked for (Data Import, AI Study Generator).</p>;
  return (
    <>
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
      {error && <p className="dm-bad dm-hint">{error}</p>}
      <p className="dm-hint">Stored by {vault.storage}.</p>
    </>
  );
}
