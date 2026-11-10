import { useCallback, useEffect, useState } from 'react';
import { loadSettings, saveSettings, textFromSpec, type CodebookSettings } from './codebookBuild';
import { validateSpec, type DatasetTable, type StudySpec, type ValidationResult } from '../core';
import type { HostAdapter } from '../adapters/types';
import { Icon, Toasts, useToasts } from './ui';
import { HomePage } from './pages/Home';
import { StandardPage } from './pages/Standard';
import { DataPullPage, type ImportTab, type LoadedSource } from './pages/DataPull';
import { CodebookGeneratorPage, CodebookViewerPage, type GeneratedCodebook } from './pages/Codebook';
import { DictionaryPage } from './pages/Dictionary';
import { FlowchartPage } from './pages/Flowchart';
import { SchedulePage } from './pages/Schedule';
import { AiPage } from './pages/Ai';
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
  {
    label: 'Codebook',
    icon: 'book',
    children: [
      { id: 'codebook_gen', label: 'Codebook Generator', icon: 'cog' },
      { id: 'codebook_view', label: 'Codebook Viewer', icon: 'eye' },
    ],
  },
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

  const onLoaded = useCallback(
    (source: LoadedSource, result: ValidationResult) => {
      setSession({ source, result });
      setCodebook(null);
      setCbSettingsState((s) => ({ ...s, text: textFromSpec(result.spec) }));
      if (result.spec) notify(`Loaded "${result.spec['Study.Metadata']['Study.Name']}".`);
      else notify('The study was read, but it has problems. See the details below.', 'warning', 8000);
    },
    [notify],
  );

  const [look, setLook] = useState<AppSettings>(loadAppSettings);
  const [dialog, setDialog] = useState<'settings' | 'contact' | null>(null);
  const mode = useResolvedMode(look.mode);
  const changeLook = (s: AppSettings) => {
    setLook(s);
    saveAppSettings(s);
  };

  const go = (id: PageId) => {
    // "Your dataset" is a tab of Data Import.
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
            go={go}
            notify={notify}
            onApply={(_s, r) => {
              // Editing a survey defines its flow: it no longer needs "order unknown".
              const before = new Map((spec?.surveys ?? []).map((x) => [x['Survey.Name'], JSON.stringify(x.questions)]));
              if (r.spec) {
                r.spec.surveys = r.spec.surveys.map((x) => {
                  if (x['Survey.Flow.Known'] !== false || before.get(x['Survey.Name']) === JSON.stringify(x.questions)) return x;
                  const { 'Survey.Flow.Known': _drop, ...rest } = x;
                  return rest;
                });
              }
              onLoaded({ fileName: 'Edited in the Survey Editor', translatorLabel: 'Study spec (JSON)', notes: [] }, r);
            }}
          />
        )}
        {page === 'codebook_gen' && (
          <CodebookGeneratorPage spec={spec} settings={cbSettings} setSettings={setCbSettings} codebook={codebook} onBuilt={setCodebook} go={go} notify={notify} />
        )}
        {page === 'codebook_view' && <CodebookViewerPage spec={spec} settings={cbSettings} codebook={codebook} onBuilt={setCodebook} go={go} notify={notify} />}
        {page === 'datadict' && <DictionaryPage spec={spec} go={go} />}
        {page === 'flowchart' && (
          <FlowchartPage spec={spec} go={go} notify={notify} onChange={(s) => session && setSession({ source: session.source, result: validateSpec(s) })} />
        )}
        {page === 'schedule' && <SchedulePage spec={spec} go={go} />}
        {page === 'standard' && <StandardPage />}
        {page === 'ai' && <AiPage spec={spec} onLoaded={(s, r) => { onLoaded(s, r); go('home'); }} notify={notify} />}
      </main>

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
