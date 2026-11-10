import { useEffect, useRef, useState } from 'react';
import { validateSpec, type StudySpec, type ValidationResult } from '../../core';
import { pullWearit, WEARIT_SERVERS, type WearitServer } from '../../connectors/wearit/fetch';
import { wearitPagesToSpec } from '../../connectors/wearit/convert';
import { normalizeRedcapUrl, pullRedcap, redcapProjectInfo } from '../../connectors/redcap';
import { listQualtricsSurveys, pullQualtrics, type QualtricsSurveySummary } from '../../connectors/qualtrics';
import { hasPlainTokens, loadConnections, saveConnections, type SavedConnections } from '../../connectors/saved';
import { isVaultRef, vaultRef } from '../../connectors/keys';
import { addKey, keyLabel, KeyField, useVault } from '../KeyField';
import { detectTranslator, TRANSLATORS } from '../../translators';
import type { PageId, Session } from '../App';
import { IssueList } from '../IssueList';
import { DatasetImport } from './DatasetImport';
import { Box, Field, Icon, PageTitle } from '../ui';

export interface LoadedSource {
  fileName: string;
  translatorLabel: string;
  notes: string[];
}

export type ImportTab = 'api' | 'file' | 'example';
type DataFile = { name: string; text: string };

interface Props {
  session: Session | null;
  spec: StudySpec | null;
  onLoaded(source: LoadedSource, result: ValidationResult): void;
  /** A response dataset was mapped and loaded (the app then goes Home). */
  onDatasetLoaded(source: LoadedSource, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
  tab: ImportTab;
  setTab(t: ImportTab): void;
  /** The response CSV being mapped, kept by the app so it survives leaving the page. */
  datasetFile: DataFile | null;
  setDatasetFile(f: DataFile | null): void;
  go(id: PageId): void;
}

/** What the file importer reads: one line per kind of file, however many translators sit behind it. */
const FILE_KINDS = [
  { label: 'Study spec (.json)', text: 'A study saved from this app (current or older format), or a saved Wear-IT getData response.' },
  { label: 'Qualtrics survey (.qsf)', text: 'In Qualtrics: Survey → Tools → Import/Export → Export Survey.' },
  { label: 'REDCap data dictionary (.csv)', text: 'In REDCap: Project Setup → Data Dictionary → Download the current Data Dictionary.' },
  { label: 'Response data (.csv / .tsv)', text: 'Raw responses from anywhere (an EMA app export, a spreadsheet, SPSS or R saved as CSV). You map its columns next.' },
];

type Source = 'wearit' | 'redcap' | 'qualtrics';
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const redcapUrlOrEmpty = (u: string) => {
  try {
    return u.trim() ? normalizeRedcapUrl(u) : '';
  } catch {
    return '';
  }
};

// The standalone app bundles the example files (loaded on demand). The R widget is one script file,
// so it leaves them out (they are several MB) and fetches them from the repository instead.
declare const __DM_WIDGET__: boolean;
const EXAMPLES_URL = 'https://raw.githubusercontent.com/ymirssbm/data-manual-app/main/examples/';
const exampleFiles = (
  typeof __DM_WIDGET__ !== 'undefined' && __DM_WIDGET__ ? {} : import.meta.glob('../../../../examples/**/*.{json,qsf,csv}', { query: '?raw', import: 'default' })
) as Record<string, () => Promise<string>>;
export const readExample = async (path: string) => {
  const key = Object.keys(exampleFiles).find((k) => k.endsWith(`/examples/${path}`));
  if (key) return exampleFiles[key]!();
  const res = await fetch(EXAMPLES_URL + path);
  if (!res.ok) throw new Error(`Example ${path} could not be downloaded (${res.status}).`);
  return res.text();
};

const EXAMPLE = {
  title: 'Recovery Pathways EMA (example study)',
  detail:
    'Three 7-day measurement bursts with morning, evening and weekly surveys, complex branching (nested, multi-select, threshold and mutually exclusive paths) and simulated responses from 200 participants enrolled over six months (about 80% of surveys completed).',
};

export function DataPullPage({ session, spec, onLoaded, onDatasetLoaded, notify, tab, setTab, datasetFile, setDatasetFile }: Props) {
  const [source, setSource] = useState<Source>('wearit');
  const [busy, setBusy] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Bring the column mapper into view when a response file is picked.
  const mapperTop = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (datasetFile) mapperTop.current?.closest('.dm-box')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [datasetFile]);
  const [conn, setConnState] = useState<SavedConnections>(loadConnections);
  const setConn = (c: SavedConnections) => {
    setConnState(c);
    saveConnections(c);
  };

  // Move tokens an older version kept in browser storage into the computer's key storage.
  const vault = useVault();
  useEffect(() => {
    if (!vault || !hasPlainTokens(conn)) return;
    void (async () => {
      const next: SavedConnections = { ...conn, redcap: [] };
      for (const p of conn.redcap) {
        next.redcap.push(isVaultRef(p.token) ? p : { ...p, token: vaultRef(await addKey('redcap', p.title, p.token, { url: p.url })) });
      }
      if (conn.qualtrics && !isVaultRef(conn.qualtrics.token)) {
        next.qualtrics = { ...conn.qualtrics, token: vaultRef(await addKey('qualtrics', `Qualtrics (${conn.qualtrics.datacenter})`, conn.qualtrics.token, { datacenter: conn.qualtrics.datacenter })) };
      }
      setConn(next);
      notify("Moved your saved tokens out of the browser and into this computer's secure key storage.");
    })().catch((e: Error) => notify(`Could not move saved tokens: ${e.message}`, 'warning', 8000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  // Wear-IT
  const [studyId, setStudyId] = useState('');
  const [wToken, setWToken] = useState('');
  const [server, setServer] = useState<WearitServer>('wearables-survey');
  // REDCap: add-project form
  const [rUrl, setRUrl] = useState(conn.redcap[0]?.url ?? '');
  const [rToken, setRToken] = useState('');
  const [rRecords, setRRecords] = useState(true);
  // Qualtrics
  const [qDc, setQDc] = useState(conn.qualtrics?.datacenter ?? '');
  const [qToken, setQToken] = useState(conn.qualtrics?.token ?? '');
  const [qSurveys, setQSurveys] = useState<QualtricsSurveySummary[] | null>(null);
  const [qFilter, setQFilter] = useState('');
  const [qManual, setQManual] = useState('');
  const [qResponses, setQResponses] = useState(true);

  const run = async (what: string, job: (signal: AbortSignal) => Promise<void>) => {
    abort.current = new AbortController();
    setBusy(`Connecting to ${what}…`);
    try {
      await job(abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify((e as Error).message, 'error', 10000);
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  // Reconnect to a remembered Qualtrics account automatically.
  useEffect(() => {
    if (source === 'qualtrics' && conn.qualtrics && !qSurveys && !busy) connectQualtrics(conn.qualtrics.datacenter, conn.qualtrics.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const connectQualtrics = (dc: string, token: string) =>
    run('Qualtrics', async (signal) => {
      setBusy('Loading your surveys…');
      const list = await listQualtricsSurveys(dc, token, signal);
      setQSurveys(list);
      setConn({ ...conn, qualtrics: { datacenter: dc.trim(), token: token.trim() } });
    });

  const pullQualtricsSurvey = (surveyId: string, name?: string) =>
    run('Qualtrics', async (signal) => {
      const { result, notes } = await pullQualtrics({ datacenter: qDc, surveyId, token: qToken, includeResponses: qResponses, signal, onStatus: setBusy });
      onLoaded({ fileName: `Qualtrics: ${name ?? surveyId}`, translatorLabel: 'Qualtrics API', notes }, result);
    });

  const addRedcapProject = () =>
    run('REDCap', async (signal) => {
      const info = await redcapProjectInfo(rUrl, rToken, signal);
      const others = conn.redcap.filter((p) => !(p.url === info.url && p.projectId === info.projectId));
      setConn({ ...conn, redcap: [...others, { ...info, token: rToken.trim() }] });
      setRToken('');
      notify(`Added "${info.title}".`);
    });

  const pullRedcapProject = (p: SavedConnections['redcap'][number]) =>
    run('REDCap', async (signal) => {
      const { result, notes, title } = await pullRedcap({ url: p.url, token: p.token, includeRecords: rRecords, timeZone: LOCAL_TZ, signal, onStatus: setBusy });
      onLoaded({ fileName: `REDCap: ${title}`, translatorLabel: 'REDCap API', notes }, result);
    });

  const pullWear = () =>
    run('Wear-IT', async (signal) => {
      const pages = await pullWearit({ server, studyId, token: wToken, signal, onPage: (n) => setBusy(`Pulling data… page ${n}`) });
      setBusy('Processing…');
      const { spec: s, notes } = wearitPagesToSpec(pages, { studyId: studyId.trim() });
      onLoaded({ fileName: `Wear-IT study ${studyId.trim()} (${server})`, translatorLabel: 'Wear-IT API', notes }, validateSpec(s));
    });

  const loadText = (fileName: string, text: string) => {
    const input = { fileName, text };
    const t = detectTranslator(input);
    if (!t) {
      if (/\.(csv|tsv|txt)$/i.test(fileName)) return setDatasetFile({ name: fileName, text });
      notify(`Couldn't recognize ${fileName}. Supported: ${TRANSLATORS.map((x) => x.label).join(', ')}, or a dataset CSV.`, 'error', 10000);
      return;
    }
    try {
      const { spec: s, notes } = t.translate(input);
      onLoaded({ fileName, translatorLabel: t.label, notes }, validateSpec(s));
    } catch (e) {
      notify((e as Error).message, 'error', 10000);
    }
  };

  const loadExample = async () => {
    try {
      loadText('branching-ema-study.json', await readExample('branching-ema-study.json'));
    } catch (e) {
      notify((e as Error).message, 'error', 8000);
    }
  };

  const label = { wearit: 'Wear-IT', redcap: 'REDCap', qualtrics: 'Qualtrics' }[source];
  const filtered = (qSurveys ?? []).filter((s) => !qFilter || `${s.name} ${s.id}`.toLowerCase().includes(qFilter.toLowerCase()));
  const status = busy && (
    <p className="dm-progress">
      <span className="dm-spinner" /> {busy}{' '}
      <button type="button" className="dm-link-btn" onClick={() => abort.current?.abort()}>
        Cancel
      </button>
    </p>
  );

  return (
    <>
      <PageTitle>Data Import</PageTitle>
      <div className="dm-segmented dm-segmented-inline dm-import-tabs" role="tablist">
        {(
          [
            ['api', 'API Pull'],
            ['file', 'Your dataset (CSV, JSON, QSF)'],
            ['example', 'Example Study'],
          ] as const
        ).map(([id, text]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'api' && (
      <Box title="Pull from a Data Collection Platform">
        {vault === null && (
          <div className="dm-callout">
            <Icon name="lock" />
            <div>
              <strong>API pulls need the installed app.</strong> Wear-IT, REDCap and Qualtrics block requests that come straight from a website, so this
              online version can't reach them. Instead, export from the platform and drop the file on{' '}
              <button className="dm-link-btn" onClick={() => setTab('file')}>
                Your dataset
              </button>{' '}
              (a Qualtrics .qsf, a REDCap data dictionary, a saved Wear-IT response, or your response CSV), or look around with the{' '}
              <button className="dm-link-btn" onClick={() => setTab('example')}>
                Example Study
              </button>
              .
            </div>
          </div>
        )}
        <div className="dm-segmented dm-segmented-inline" role="tablist">
          {(['wearit', 'redcap', 'qualtrics'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={source === s} className={source === s ? 'is-active' : ''} onClick={() => setSource(s)} disabled={!!busy}>
              {{ wearit: 'Wear-IT', redcap: 'REDCap', qualtrics: 'Qualtrics' }[s]}
            </button>
          ))}
        </div>

        {source === 'wearit' && (
          <form
            className="dm-grid-2"
            onSubmit={(e) => {
              e.preventDefault();
              pullWear();
            }}
          >
            <div>
              <Field label="Study ID">
                <input className="dm-input" value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="Enter Study ID" autoComplete="off" />
              </Field>
              <KeyField kind="wearit" label="API Token" value={wToken} onChange={setWToken} suggestedLabel="Wear-IT token" />
            </div>
            <div>
              <Field label="Wear-IT URL">
                <select className="dm-input" value={server} onChange={(e) => setServer(e.target.value as WearitServer)}>
                  {WEARIT_SERVERS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="dm-pull-row">
              <button className="dm-btn dm-btn-primary dm-btn-lg" type="submit" disabled={!!busy || !studyId.trim() || !wToken.trim()}>
                <Icon name="download" size={18} /> Pull Data from Wear-IT
              </button>
              {status}
            </div>
          </form>
        )}

        {source === 'redcap' && (
          <div className="dm-stack-md">
            <div>
              <h4 className="dm-subhead">My REDCap projects</h4>
              {conn.redcap.length ? (
                <div className="dm-list">
                  {conn.redcap.map((p) => (
                    <div key={`${p.url}#${p.projectId}`} className="dm-list-row">
                      <div>
                        <strong>{p.title}</strong>
                        <span className="dm-hint">
                          {new URL(p.url).host} · project {p.projectId || '?'} · {keyLabel(vault, p.token)}
                        </span>
                      </div>
                      <div className="dm-inline dm-inline-tight">
                        <button className="dm-btn dm-btn-primary dm-btn-sm" disabled={!!busy} onClick={() => pullRedcapProject(p)}>
                          Pull
                        </button>
                        <button className="dm-link-btn" onClick={() => setConn({ ...conn, redcap: conn.redcap.filter((x) => x !== p) })}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="dm-hint">No projects yet. REDCap gives each project its own API token, so add each project once below and it stays in this list.</p>
              )}
              <label className="dm-check dm-mt">
                <input type="checkbox" checked={rRecords} onChange={(e) => setRRecords(e.target.checked)} /> Include records (response data) when pulling
              </label>
            </div>
            <form
              className="dm-add-project"
              onSubmit={(e) => {
                e.preventDefault();
                addRedcapProject();
              }}
            >
              <h4 className="dm-subhead">Add a project</h4>
              <div className="dm-grid-2">
                <Field label="REDCap API URL" hint="Your REDCap address followed by /api/ (shown on the project's API page).">
                  <input className="dm-input" value={rUrl} onChange={(e) => setRUrl(e.target.value)} placeholder="https://redcap.your-university.edu/api/" autoComplete="off" />
                </Field>
                <KeyField
                  kind="redcap"
                  label="Project API token"
                  value={rToken}
                  onChange={setRToken}
                  meta={{ url: redcapUrlOrEmpty(rUrl) }}
                  suggestedLabel="REDCap project"
                  hint="In the project: API → Generate token (needs API Export rights)."
                />
              </div>
              <div className="dm-pull-row">
                <button className="dm-btn dm-btn-secondary" type="submit" disabled={!!busy || !rUrl.trim() || !rToken.trim()}>
                  Add project
                </button>
                {status}
              </div>
            </form>
          </div>
        )}

        {source === 'qualtrics' && (
          <div className="dm-stack-md">
            {!qSurveys ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  connectQualtrics(qDc, qToken);
                }}
              >
                <p className="dm-hint">Connect once with your account's API token to browse all your surveys.</p>
                <div className="dm-grid-2">
                  <Field label="Datacenter ID" hint="Account Settings → Qualtrics IDs → User → Datacenter ID (e.g. iad1).">
                    <input className="dm-input" value={qDc} onChange={(e) => setQDc(e.target.value)} placeholder="iad1" autoComplete="off" />
                  </Field>
                  <KeyField
                    kind="qualtrics"
                    label="API Token"
                    value={qToken}
                    onChange={setQToken}
                    meta={{ datacenter: qDc.trim() }}
                    suggestedLabel={`Qualtrics${qDc.trim() ? ` (${qDc.trim()})` : ''}`}
                    hint="Account Settings → Qualtrics IDs → API → Generate Token."
                  />
                </div>
                <div className="dm-pull-row">
                  <button className="dm-btn dm-btn-primary dm-btn-lg" type="submit" disabled={!!busy || !qDc.trim() || !qToken.trim()}>
                    Connect to Qualtrics
                  </button>
                  {status}
                </div>
              </form>
            ) : (
              <div>
                <div className="dm-row-between">
                  <h4 className="dm-subhead">
                    Your surveys <span className="dm-hint">({qSurveys.length} on {qDc})</span>
                  </h4>
                  <div className="dm-inline dm-inline-tight">
                    <label className="dm-check">
                      <input type="checkbox" checked={qResponses} onChange={(e) => setQResponses(e.target.checked)} /> Include responses
                    </label>
                    <button
                      className="dm-link-btn"
                      onClick={() => {
                        setQSurveys(null);
                        setConn({ ...conn, qualtrics: null });
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
                <input className="dm-input dm-search" type="search" placeholder="Search surveys…" value={qFilter} onChange={(e) => setQFilter(e.target.value)} />
                <div className="dm-list dm-list-scroll">
                  {filtered.map((s) => (
                    <div key={s.id} className="dm-list-row">
                      <div>
                        <strong>{s.name}</strong>
                        <span className="dm-hint">
                          {s.id} · {s.isActive ? 'active' : 'inactive'} · modified {s.lastModified.slice(0, 10)}
                        </span>
                      </div>
                      <button className="dm-btn dm-btn-primary dm-btn-sm" disabled={!!busy} onClick={() => pullQualtricsSurvey(s.id, s.name)}>
                        Pull
                      </button>
                    </div>
                  ))}
                  {!filtered.length && <p className="dm-empty">{qSurveys.length ? 'No surveys match.' : 'This account has no surveys.'}</p>}
                </div>
                <form
                  className="dm-inline dm-mt"
                  onSubmit={(e) => {
                    e.preventDefault();
                    pullQualtricsSurvey(qManual.trim());
                  }}
                >
                  <span className="dm-hint">Shared with you and not listed?</span>
                  <input className="dm-input dm-input-sm" value={qManual} onChange={(e) => setQManual(e.target.value)} placeholder="SV_..." />
                  <button className="dm-btn dm-btn-secondary dm-btn-sm" disabled={!!busy || !qManual.trim()}>
                    Pull by ID
                  </button>
                </form>
                {status}
              </div>
            )}
          </div>
        )}

        <div className="dm-security-note">
          <Icon name="lock" />{' '}
          {vault === null
            ? 'Keys entered here are only sent to the platform, are never saved, and are forgotten when you close the tab.'
            : `Keys are only sent to ${label}, through this app's local server. ${vault ? `Saved keys are kept by ${vault.storage}, never in the browser.` : ''}`}
        </div>
      </Box>
      )}

      {tab === 'file' && (
        <>
          {datasetFile ? (
            // Once a response file is picked, the file picker folds to one line and mapping takes the page.
            <div className="dm-file-picked">
              <Icon name="file" />
              <span>
                <strong>{datasetFile.name}</strong>: map its columns below.
              </span>
              <button className="dm-link-btn" onClick={() => setDatasetFile(null)}>
                Choose a different file
              </button>
            </div>
          ) : (
          <Box title="Import a File">
            <div
              className="dm-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) void f.text().then((t) => loadText(f.name, t));
              }}
            >
              <Icon name="upload" size={28} />
              <p>Drop a file here</p>
              <label className="dm-btn dm-btn-primary">
                Choose file
                <input
                  type="file"
                  hidden
                  accept={[...new Set([...TRANSLATORS.flatMap((t) => t.accept.split(',')), '.tsv', '.txt'])].join(',')}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void f.text().then((t) => loadText(f.name, t));
                  }}
                />
              </label>
            </div>
            <ul className="dm-sources">
              {FILE_KINDS.map((k) => (
                <li key={k.label}>
                  <strong>{k.label}</strong>
                  <span>{k.text}</span>
                </li>
              ))}
            </ul>
          </Box>
          )}
          {datasetFile && (
            <Box title={`Map Your Response Data: ${datasetFile.name}`}>
              <span ref={mapperTop} />
              <p className="dm-hint">
                Say how the file is laid out: <strong>long</strong> (one row per response) or <strong>wide</strong> (one row per survey occasion, a column per question).{' '}
                {spec ? (
                  <>
                    The data can be attached to <strong>{spec['Study.Metadata']['Study.Name']}</strong> (matched by question ID, or by question text), or used to build a new study.
                  </>
                ) : (
                  <>No study is loaded, so a study will be built from the data. For question text and labels, load the study or survey first, then attach this data to it.</>
                )}
              </p>
              <DatasetImport initial={datasetFile} spec={spec} onLoaded={onDatasetLoaded} notify={notify} onReset={() => setDatasetFile(null)} />
            </Box>
          )}
        </>
      )}

      {tab === 'example' && (
        <Box title="Example Study">
          <div className="dm-examples">
            <button className="dm-example" onClick={() => void loadExample()}>
              <strong>{EXAMPLE.title}</strong>
              <span>{EXAMPLE.detail}</span>
            </button>
          </div>
          <p className="dm-hint dm-mt">
            To try importing your own data, use{' '}
            <button
              className="dm-link-btn"
              onClick={() =>
                void readExample('branching-ema-data.csv')
                  .then((text) => {
                    setDatasetFile({ name: 'branching-ema-data.csv', text });
                    setTab('file');
                  })
                  .catch((e: Error) => notify(e.message, 'error', 8000))
              }
            >
              the example's responses as a plain CSV
            </button>
            : it opens in Your dataset, ready to map its columns.
          </p>
        </Box>
      )}

      {session && (
        <Box title={`Loaded: ${session.source.fileName}`}>
          <p>
            <strong>Read as:</strong> {session.source.translatorLabel}
          </p>
          {session.source.notes.length > 0 && (
            <ul className="dm-notes">
              {session.source.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </Box>
      )}
      {session && <IssueList result={session.result} />}
    </>
  );
}
