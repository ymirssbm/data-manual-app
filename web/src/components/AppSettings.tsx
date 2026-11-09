import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './ui';

/** App look (not the codebook's): colour mode, accent, sidebar, text size and font. */
export interface AppSettings {
  mode: 'light' | 'dark' | 'system';
  accent: string;
  sidebar: 'dark' | 'light';
  textSize: 'small' | 'default' | 'large';
  font: 'system' | 'humanist' | 'serif';
}

export const DEFAULT_APP_SETTINGS: AppSettings = { mode: 'light', accent: 'blue', sidebar: 'dark', textSize: 'default', font: 'system' };

/** Accent presets: [label, main (buttons, box headers), bright (links, focus), dark (text on tints)]. */
export const ACCENTS: Record<string, { label: string; main: string; bright: string; dark: string }> = {
  blue: { label: 'Blue (classic)', main: '#3c8dbc', bright: '#2563eb', dark: '#1e40af' },
  indigo: { label: 'Indigo', main: '#4f46e5', bright: '#6366f1', dark: '#3730a3' },
  teal: { label: 'Teal', main: '#0f8b8d', bright: '#0d9488', dark: '#115e59' },
  green: { label: 'Green', main: '#2f8a4c', bright: '#16a34a', dark: '#166534' },
  purple: { label: 'Purple', main: '#7c4dbc', bright: '#9333ea', dark: '#6b21a8' },
  rose: { label: 'Rose', main: '#c2416b', bright: '#e11d48', dark: '#9f1239' },
  orange: { label: 'Orange', main: '#c8661c', bright: '#ea580c', dark: '#9a3412' },
  slate: { label: 'Slate', main: '#475569', bright: '#475569', dark: '#1e293b' },
};

const FONTS: Record<AppSettings['font'], string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  humanist: "'Segoe UI Variable', Calibri, 'Gill Sans', 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif",
  serif: "Charter, 'Sitka Text', Cambria, Georgia, serif",
};
const SIZES: Record<AppSettings['textSize'], string> = { small: '14px', default: '15px', large: '16.5px' };

const KEY = 'data-manual:app-settings:v1';

export function loadAppSettings(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AppSettings>;
    const s = { ...DEFAULT_APP_SETTINGS, ...saved };
    if (!ACCENTS[s.accent]) s.accent = DEFAULT_APP_SETTINGS.accent;
    return s;
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private window or blocked storage: settings last for this visit only.
  }
}

/** Resolves "system" against the OS setting, and follows it live. */
export function useResolvedMode(mode: AppSettings['mode']): 'light' | 'dark' {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [osDark, setOsDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = (e: MediaQueryListEvent) => setOsDark(e.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query]);
  return mode === 'system' ? (osDark ? 'dark' : 'light') : mode;
}

/** CSS variables for the root element. */
export function appStyle(s: AppSettings, mode: 'light' | 'dark' = 'light'): CSSProperties {
  const a = ACCENTS[s.accent] ?? ACCENTS.blue!;
  return {
    '--topbar': a.main,
    '--topbar-logo': `color-mix(in srgb, ${a.main} 88%, #000)`,
    '--box-primary': a.main,
    '--sidebar-active': a.bright,
    '--blue': a.bright,
    '--blue-light': `color-mix(in srgb, ${a.bright} 75%, #fff)`,
    // Text-on-surface accent: the dark shade on light pages, a light tint on dark pages.
    '--blue-dark': mode === 'dark' ? `color-mix(in srgb, ${a.bright} 55%, #fff)` : a.dark,
    fontFamily: FONTS[s.font],
    fontSize: SIZES[s.textSize],
  } as CSSProperties;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="dm-segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-active' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="dm-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dm-modal-head">
          <h3>{title}</h3>
          <button className="dm-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dm-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function SettingsDialog({ value, onChange, onClose }: { value: AppSettings; onChange: (s: AppSettings) => void; onClose: () => void }) {
  const set = (patch: Partial<AppSettings>) => onChange({ ...value, ...patch });
  return (
    <Modal title="Settings" onClose={onClose}>
      <div>
        <div className="dm-set-label">Appearance</div>
        <Segmented label="Appearance" value={value.mode} onChange={(mode) => set({ mode })} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match system']]} />
      </div>
      <div>
        <div className="dm-set-label">Accent color</div>
        <div className="dm-swatches" role="radiogroup" aria-label="Accent color">
          {Object.entries(ACCENTS).map(([k, a]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={value.accent === k}
              aria-label={a.label}
              title={a.label}
              className={`dm-swatch${value.accent === k ? ' is-active' : ''}`}
              style={{ background: a.main }}
              onClick={() => set({ accent: k })}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="dm-set-label">Side panel</div>
        <Segmented label="Side panel" value={value.sidebar} onChange={(sidebar) => set({ sidebar })} options={[['dark', 'Dark'], ['light', 'Light']]} />
      </div>
      <div>
        <div className="dm-set-label">Text size</div>
        <Segmented label="Text size" value={value.textSize} onChange={(textSize) => set({ textSize })} options={[['small', 'Small'], ['default', 'Default'], ['large', 'Large']]} />
      </div>
      <div>
        <div className="dm-set-label">Font</div>
        <Segmented label="Font" value={value.font} onChange={(font) => set({ font })} options={[['system', 'System'], ['humanist', 'Humanist'], ['serif', 'Serif']]} />
      </div>
      <div className="dm-modal-foot">
        <span className="dm-hint">Saved in this browser. Codebook colors are set in the Codebook Generator.</span>
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => onChange(DEFAULT_APP_SETTINGS)}>
          Reset
        </button>
      </div>
    </Modal>
  );
}

export const CONTACT = {
  name: 'Ethan O. Kile',
  email: 'eok5206@psu.edu',
  repo: 'https://github.com/ymirssbm/data-manual-app',
};

export function ContactDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Contact" onClose={onClose}>
      <div className="dm-contact">
        <span className="dm-set-label">Created and maintained by</span>
        <strong>{CONTACT.name}</strong>
        <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
        <div className="dm-contact-links">
          <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('Data Manual question')}`}>
            <Icon name="mail" size={15} /> Email a question or feedback
          </a>
          <a href={`${CONTACT.repo}/issues/new`} target="_blank" rel="noreferrer">
            <Icon name="bug" size={15} /> Report a bug or request a feature
          </a>
          <a href={`${CONTACT.repo}#readme`} target="_blank" rel="noreferrer">
            <Icon name="book" size={15} /> Documentation
          </a>
        </div>
      </div>
    </Modal>
  );
}
