// Shared dashboard building blocks: boxes, page titles, form fields, icons, toasts.
import { useCallback, useState, type ReactNode } from 'react';

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="dm-page-header">
      <h2>{children}</h2>
      {actions && <div className="dm-header-actions">{actions}</div>}
    </div>
  );
}

/** A solid-header primary box (the dashboard's main container). */
export function Box({ title, children, width = 12, tools }: { title?: ReactNode; children: ReactNode; width?: 6 | 12; tools?: ReactNode }) {
  return (
    <section className={`dm-box dm-col-${width}`}>
      {title != null && (
        <div className="dm-box-header">
          <h3 className="dm-box-title">{title}</h3>
          {tools && <div className="dm-box-tools">{tools}</div>}
        </div>
      )}
      <div className="dm-box-body">{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="dm-row">{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="dm-field">
      <span className="dm-label">{label}</span>
      {children}
      {hint && <span className="dm-hint">{hint}</span>}
    </label>
  );
}

const ICONS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
  download: 'M12 3v12m0 0l-5-5m5 5l5-5M4 19h16',
  book: 'M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5v-17zM4 19.5A2.5 2.5 0 016.5 17H20',
  cog: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2.2-1.3L14.3 3h-4l-.4 2.5a7.6 7.6 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002.2 1.3l.4 2.5h4l.4-2.5a7.6 7.6 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  table: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16',
  diagram: 'M4 3h6v5H4zM14 16h6v5h-6zM4 16h6v5H4zM7 8v8M7 12h10v4',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  bars: 'M3 6h18M3 12h18M3 18h18',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  export: 'M12 15V3m0 0L7 8m5-5l5 5M4 15v5h16v-5',
  import: 'M12 3v12m0 0l-5-5m5 5l5-5M4 15v5h16v-5',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  bug: 'M8 8a4 4 0 018 0v1H8zM6 10h12v5a6 6 0 01-12 0zM12 10v11M3 13h3M18 13h3M4 19l2.5-2M20 19l-2.5-2M4 7l3 2M20 7l-3 2',
  upload: 'M12 21V9m0 0l-5 5m5-5l5 5M4 5h16',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  spark: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg className="dm-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export interface Toast {
  id: number;
  kind: 'message' | 'error' | 'warning';
  text: string;
}

let toastId = 0;
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((text: string, kind: Toast['kind'] = 'message', ms = 5000) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, kind, text }]);
    if (ms > 0) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
    return id;
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, notify, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss(id: number): void }) {
  return (
    <div className="dm-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`dm-toast dm-toast-${t.kind}`}>
          <span>{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
