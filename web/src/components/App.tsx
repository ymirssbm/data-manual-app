import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettings, saveSettings, textAfterEdit, textFromSpec, type CodebookSettings } from './codebookBuild';
import { validateSpec, type DatasetTable, type StudySpec, type ValidationResult } from '../core';
import { codebookItemKey } from '../generators';
import type { HostAdapter } from '../adapters/types';
import { demoScreenshots, EMPTY_EXTRAS, EXAMPLE_STUDY_NAME, loadStudyExtras, saveStudyExtras } from './studyExtras';
import { Icon, Toasts, useToasts } from './ui';
import type { LiveEditOptions } from './useLiveDraft';
import { HomePage } from './pages/Home';
import { StandardPage } from './pages/Standard';
import { DataPullPage, type ImportTab, type LoadedSource } from './pages/DataPull';
import { CodebookGeneratorPage, type GeneratedCodebook } from './pages/Codebook';
import { DictionaryPage } from './pages/Dictionary';
import { FlowchartPage } from './pages/Flowchart';
import { SchedulePage } from './pages/Schedule';
import { AiPage, useAiChat } from './pages/Ai';
import { AiBubble, loadAssistantHidden, saveAssistantHidden } from './AiBubble';
import { DataExportPage } from './pages/DataExport';
import { SurveyEditorPage } from './pages/SurveyEditor';
import { appStyle, ContactDialog, loadAppSettings, saveAppSettings, SettingsDialog, useResolvedMode, type AppSettings } from './AppSettings';

export type PageId = 'home' | 'datapull' | 'dataset' | 'export' | 'editor' | 'codebook_gen' | 'codebook_view' | 'datadict' | 'flowchart' | 'schedule' | 'ai' | 'standard';

interface MenuItem {
  id?: PageId;
  label: string;
  icon: string;
  children?: Array<{ id: PageId; label: string; icon: string; also?: PageId[] }>;
}

const MENU: MenuItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  {
    label: 'Data',
    icon: 'table',
    children: [
      { id: 'datapull', label: 'Data Import', icon: 'import' },
      { id: 'export', label: 'Data Export', icon: 'export' },
    ],
  },
  { id: 'editor', label: 'Survey Editor', icon: 'edit' },
  { id: 'codebook_gen', label: 'Codebook', icon: 'book' },
  { id: 'datadict', label: 'Data Dictionary', icon: 'table' },
  { id: 'flowchart', label: 'Study Flowchart', icon: 'diagram' },
  { id: 'schedule', label: 'Study Schedule', icon: 'calendar' },
  { id: 'ai', label: 'AI Study Generator', icon: 'spark' },
  { id: 'standard', label: 'Data Description Standard', icon: 'file' },
];

export interface Session {
  source: LoadedSource;
  result: ValidationResult;
}

const STORAGE_KEY = 'data-manual:last-session';

function restore(adapter: HostAdapter): Session | null {
  if (adapter.initialSpec != null) {
    return { source: { fileName: adapter.kind === 'widget' ? 'your R session' : 'the host page', translatorLabel: 'Study spec (JSON)', notes: [] }, result: validateSpec(adapter.initialSpec) };
  }
  if (adapter.kind !== 'standalone') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { source: LoadedSource; spec: unknown };
    return { source: saved.source, result: validateSpec(saved.spec) };
  } catch {
    return null;
  }
}

export function App({ adapter }: { adapter: HostAdapter }) {
  const [session, setSession] = useState<Session | null>(() => restore(adapter));
  const [page, setPage] = useState<PageId>('home');
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [codebook, setCodebook] = useState<GeneratedCodebook | null>(null);
  const { toasts, notify, dismiss } = useToasts();
  const [datasetFile, setDatasetFile] = useState<{ name: string; text?: string; table?: DatasetTable } | null>(null);
  const [importTab, setImportTab] = useState<ImportTab>('api');
  const spec: StudySpec | null = session?.result.spec ?? null;
  /** The Survey Editor opens on this survey and tab (e.g. from the Study Schedule page). */
  const [editorTarget, setEditorTarget] = useState<{ surveyName: string; tab: 'edit' | 'schedule' } | null>(null);
  const clearEditorTarget = useCallback(() => setEditorTarget(null), []);
  /** A variable the Codebook page should scroll to when it opens. */
  const [codebookFocus, setCodebookFocus] = useState<string | null>(null);
  const [cbSettings, setCbSettingsState] = useState<CodebookSettings>(() => loadSettings(spec));
  const setCbSettings = useCallback((s: CodebookSettings) => {
    setCbSettingsState(s);
    saveSettings(s);
  }, []);

  useEffect(() => {
    adapter.onSpecChange(spec);
    if (adapter.kind !== 'standalone' || !session?.result.spec) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ source: session.source, spec: session.result.spec }));
    } catch {
      // Storage unavailable (private window, quota): the app works without it.
    }
  }, [adapter, session, spec]);

  /** Bumped on every fresh load, so the study's saved extras are read again (even for the same study). */
  const [loadTick, setLoadTick] = useState(0);
  const loadedFor = useRef<string | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  /** A new study resets the codebook's study details and variable choices; an edit of the same study keeps them. */
  const onLoaded = useCallback(
    (source: LoadedSource, result: ValidationResult, how: { edit?: boolean } = {}) => {
      const before = specRef.current;
      if (!how.edit) {
        loadedFor.current = null;
        setLoadTick((n) => n + 1);
        setHistory({ past: [], future: [] });
      }
      setSession({ source, result });
      setCodebook(null);
      setCbSettingsState((s) =>
        how.edit ? { ...s, text: textAfterEdit(s.text, before, result.spec) } : { ...s, text: textFromSpec(result.spec), exclude: [], extras: EMPTY_EXTRAS },
      );
      if (how.edit) return;
      if (result.spec) notify(`Loaded "${result.spec['Study.Metadata']['Study.Name']}".`);
      else notify('The study was read, but it has problems. See the details below.', 'warning', 8000);
    },
    [notify],
  );

  // ---- Undo / redo of edits to the loaded study (from any page). A newly loaded study starts fresh.
  const [history, setHistory] = useState<{ past: Array<{ spec: StudySpec; label: string }>; future: Array<{ spec: StudySpec; label: string }> }>({ past: [], future: [] });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const historyRef = useRef(history);
  historyRef.current = history;
  /** The last edit's merge key: typing in one field is one undo step. */
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  /**
   * Change the loaded study, keeping the previous version for undo. Live edits (`opts.merge` or
   * `opts.quiet`) are only applied when the study stays valid; the reason is returned otherwise.
   */
  const editStudy = useCallback(
    (next: StudySpec, label: string, opts: string | LiveEditOptions = {}): string | null => {
      const o: LiveEditOptions & { message?: string } = typeof opts === 'string' ? { message: opts } : opts;
      const prev = specRef.current;
      const s = sessionRef.current;
      if (!prev || !s) return 'No study is loaded.';
      // Editing a survey's questions defines its flow: it no longer needs "order unknown".
      const before = new Map(prev.surveys.map((x) => [x['Survey.Name'], JSON.stringify(x.questions)]));
      next = {
        ...next,
        surveys: next.surveys.map((x) => {
          if (x['Survey.Flow.Known'] !== false || before.get(x['Survey.Name']) === JSON.stringify(x.questions)) return x;
          const { 'Survey.Flow.Known': _drop, ...rest } = x;
          return rest;
        }),
      };
      const r = validateSpec(next);
      const live = !!(o.merge || o.quiet);
      if (live && !r.spec) return r.issues.find((i) => i.severity === 'error')?.message ?? 'The study is not valid.';
      const now = Date.now();
      const m = lastMerge.current;
      const merging = !!o.merge && m?.key === o.merge && now - m.at < 5000;
      lastMerge.current = o.merge ? { key: o.merge, at: now } : null;
      setHistory((h) => (merging && h.past.length ? { ...h, future: [] } : { past: [...h.past, { spec: prev, label }].slice(-50), future: [] }));
      onLoaded(s.source, r, { edit: true });
      if (!o.quiet) notify(o.message ?? `${label}. Undo with Ctrl+Z.`);
      return null;
    },
    [onLoaded, notify],
  );
  // One AI conversation for the AI page and the floating assistant on every other page.
  const [assistantHidden, setAssistantHiddenState] = useState(loadAssistantHidden);
  const setAssistantHidden = useCallback((h: boolean) => (setAssistantHiddenState(h), saveAssistantHidden(h)), []);
  const aiChat = useAiChat({ spec, onLoaded, onEdit: (s) => editStudy(s, 'AI changes'), notify, documents: cbSettings.extras.attachments });

  const undo = useCallback(() => {
    const h = historyRef.current;
    const last = h.past[h.past.length - 1];
    const cur = specRef.current;
    const s = sessionRef.current;
    if (!last || !cur || !s) return;
    lastMerge.current = null;
    setHistory({ past: h.past.slice(0, -1), future: [{ spec: cur, label: last.label }, ...h.future] });
    onLoaded(s.source, validateSpec(last.spec), { edit: true });
    notify(`Undid: ${last.label}.`);
  }, [onLoaded, notify]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    const next = h.future[0];
    const cur = specRef.current;
    const s = sessionRef.current;
    if (!next || !cur || !s) return;
    lastMerge.current = null;
    setHistory({ past: [...h.past, { spec: cur, label: next.label }], future: h.future.slice(1) });
    onLoaded(s.source, validateSpec(next.spec), { edit: true });
    notify(`Redid: ${next.label}.`);
  }, [onLoaded, notify]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      // Text boxes keep their own undo.
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Each study's codebook details, media, documents and variable choices are kept in this browser
  // (IndexedDB) by study name: restored when the study is loaded, saved as they change.
  const studyName = spec?.['Study.Metadata']['Study.Name'] ?? null;
  useEffect(() => {
    if (!studyName) return;
    let cancelled = false;
    loadedFor.current = null;
    const example = studyName === EXAMPLE_STUDY_NAME ? specRef.current : null;
    void loadStudyExtras(studyName).then((saved) => {
      if (cancelled) return;
      if (saved)
        setCbSettingsState((s) => ({
          ...s,
          text: Object.fromEntries(Object.entries({ ...s.text, ...saved.text }).map(([k, v]) => [k, v || (s.text as Record<string, string | undefined>)[k] || ''])),
          extras: { ...EMPTY_EXTRAS, ...saved.extras },
          exclude: saved.exclude ?? s.exclude,
        }));
      // The example study shows what screenshots look like, with made-up ones.
      if (example && !Object.keys(saved?.extras.screenshots ?? {}).length) setCbSettingsState((s) => ({ ...s, extras: { ...s.extras, ...demoScreenshots(example) } }));
      loadedFor.current = studyName;
    });
    return () => {
      cancelled = true;
    };
  }, [studyName, loadTick]);
  useEffect(() => {
    if (!studyName || loadedFor.current !== studyName) return;
    const t = setTimeout(() => void saveStudyExtras(studyName, { extras: cbSettings.extras, text: cbSettings.text, exclude: cbSettings.exclude }), 400);
    return () => clearTimeout(t);
  }, [studyName, cbSettings.extras, cbSettings.text, cbSettings.exclude]);

  const [look, setLook] = useState<AppSettings>(loadAppSettings);
  const [dialog, setDialog] = useState<'settings' | 'contact' | null>(null);
  const mode = useResolvedMode(look.mode);
  const changeLook = (s: AppSettings) => {
    setLook(s);
    saveAppSettings(s);
  };

  const go = (id: PageId) => {
    // "Your dataset" is a tab of Data Import.
    // The codebook generator and viewer are one page now.
    if (id === 'codebook_view') id = 'codebook_gen';
    if (id === 'dataset') {
      setImportTab('file');
      id = 'datapull';
    }
    setPage(id);
    if (window.matchMedia('(max-width: 767px)').matches) setCollapsed(true);
  };

  return (
    <div className={`dm-app ${collapsed ? 'is-collapsed' : ''}`} data-theme={mode} data-sidebar={look.sidebar} style={appStyle(look, mode)}>
      <header className="dm-topbar">
        <div className="dm-logo">
          <span className="dm-logo-mark">
            <Icon name="book" size={20} />
          </span>
          <span className="dm-logo-text">Data Manual</span>
        </div>
        <nav className="dm-navbar">
          <button className="dm-sidebar-toggle" aria-label="Toggle navigation" onClick={() => setCollapsed((c) => !c)}>
            <Icon name="bars" size={18} />
          </button>
          {spec && <span className="dm-navbar-study">{spec['Study.Metadata']['Study.Name']}</span>}
          {spec && (
            <span className="dm-undo">
              <button
                type="button"
                onClick={undo}
                disabled={!history.past.length}
                title={history.past.length ? `Undo: ${history.past[history.past.length - 1]!.label} (Ctrl+Z)` : 'Nothing to undo'}
                aria-label="Undo"
              >
                ↶ Undo
              </button>
              <button type="button" onClick={redo} disabled={!history.future.length} title={history.future.length ? `Redo: ${history.future[0]!.label} (Ctrl+Y)` : 'Nothing to redo'} aria-label="Redo">
                ↷ Redo
              </button>
            </span>
          )}
        </nav>
      </header>

      <aside className="dm-sidebar" aria-label="Main navigation">
        <ul className="dm-menu">
          {MENU.map((m) =>
            m.children ? (
              <li key={m.label} className="dm-treeview">
                <span className="dm-menu-link dm-menu-header">
                  <Icon name={m.icon} />
                  <span>{m.label}</span>
                </span>
                <ul className="dm-submenu">
                  {m.children.map((c) => (
                    <li key={c.id} className={page === c.id || c.also?.includes(page) ? 'active' : ''}>
                      <a href={`#${c.id}`} onClick={(e) => (e.preventDefault(), go(c.id))}>
                        <Icon name={c.icon} size={14} />
                        <span>{c.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ) : (
              <li key={m.id} className={page === m.id ? 'active' : ''}>
                <a className="dm-menu-link" href={`#${m.id}`} onClick={(e) => (e.preventDefault(), go(m.id!))}>
                  <Icon name={m.icon} />
                  <span>{m.label}</span>
                </a>
              </li>
            ),
          )}
        </ul>
        <div className="dm-side-foot">
          <button className="dm-side-btn" aria-haspopup="dialog" aria-expanded={dialog === 'settings'} onClick={() => setDialog('settings')}>
            <Icon name="cog" size={15} /> Settings
          </button>
          <button className="dm-side-btn" aria-haspopup="dialog" aria-expanded={dialog === 'contact'} onClick={() => setDialog('contact')}>
            <Icon name="mail" size={15} /> Contact
          </button>
        </div>
      </aside>
      {dialog === 'settings' && <SettingsDialog value={look} onChange={changeLook} onClose={() => setDialog(null)} />}
      {dialog === 'contact' && <ContactDialog onClose={() => setDialog(null)} />}

      <main className="dm-content">
        {page === 'home' && <HomePage session={session} go={go} onLoaded={onLoaded} notify={notify} />}
        {page === 'datapull' && (
          <DataPullPage
            session={session}
            spec={spec}
            onLoaded={onLoaded}
            onDatasetLoaded={(s, r) => {
              onLoaded(s, r);
              setDatasetFile(null);
            }}
            notify={notify}
            go={go}
            tab={importTab}
            setTab={setImportTab}
            datasetFile={datasetFile}
            setDatasetFile={setDatasetFile}
          />
        )}
        {page === 'export' && <DataExportPage spec={spec} go={go} notify={notify} />}
        {page === 'editor' && (
          <SurveyEditorPage
            spec={spec}
            target={editorTarget}
            onTargetUsed={clearEditorTarget}
            go={go}
            notify={notify}
            onEdit={editStudy}
          />
        )}
        {page === 'codebook_gen' && (
          <CodebookGeneratorPage
            spec={spec}
            settings={cbSettings}
            setSettings={setCbSettings}
            codebook={codebook}
            onBuilt={setCodebook}
            go={go}
            notify={notify}
            focus={codebookFocus}
            onFocused={() => setCodebookFocus(null)}
            onSpecEdit={(s, label, opts) => editStudy(s, label ?? 'Edited the study', opts)}
          />
        )}
        {page === 'datadict' && <DictionaryPage spec={spec} go={go} />}
        {page === 'flowchart' && (
          <FlowchartPage
            spec={spec}
            go={go}
            notify={notify}
            onChange={(s, label, opts) => editStudy(s, label ?? 'Edited the study', opts)}
            openInCodebook={(surveyName, itemId) => {
              setCodebookFocus(codebookItemKey(surveyName, itemId));
              go('codebook_view');
            }}
          />
        )}
        {page === 'schedule' && (
          <SchedulePage
            spec={spec}
            go={go}
            onEditSchedule={(surveyName) => {
              setEditorTarget({ surveyName, tab: 'schedule' });
              go('editor');
            }}
            onChange={(s, label, opts) => editStudy(s, label, opts)}
          />
        )}
        {page === 'standard' && <StandardPage />}
        {page === 'ai' && <AiPage chat={aiChat} assistantHidden={assistantHidden} onAssistantHidden={setAssistantHidden} />}
      </main>

      {page !== 'ai' && <AiBubble chat={aiChat} openPage={() => go('ai')} hidden={assistantHidden} onHide={() => (setAssistantHidden(true), notify('The AI assistant is hidden. Turn it back on from the AI Study Generator page.'))} />}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
