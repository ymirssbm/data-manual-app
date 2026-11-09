import { useRef, useState } from 'react';
import { validateSpec, type ValidationResult } from '../../core';
import { pullWearit, WEARIT_SERVERS, type WearitServer } from '../../connectors/wearit/fetch';
import { wearitPagesToSpec } from '../../connectors/wearit/convert';
import { detectTranslator, TRANSLATORS } from '../../translators';
import type { Session } from '../App';
import { IssueList } from '../IssueList';
import { Box, Field, Icon, PageTitle, Row } from '../ui';

export interface LoadedSource {
  fileName: string;
  translatorLabel: string;
  notes: string[];
}

interface Props {
  session: Session | null;
  onLoaded(source: LoadedSource, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

const exampleFiles = import.meta.glob('../../../../examples/**/*.{json,qsf,csv}', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

const EXAMPLES: Array<{ path: string; title: string; detail: string }> = [
  { path: 'branching-ema-study.json', title: 'Branching EMA study', detail: 'Complex skip logic: nested branches, multi-select follow-ups, threshold and mutually exclusive paths' },
  { path: 'wearit/sample-getData.json', title: 'Wear-IT daily diary', detail: 'Saved Wear-IT pull: blocks, skip logic and 40 sessions of data' },
  { path: 'minimal-study.json', title: 'Daily mood study', detail: 'Study spec with a schedule and simulated responses' },
  { path: 'older-format/ai-generated-ema-study.json', title: 'AI-generated EMA study', detail: 'Older spec format with a 30-day schedule' },
  { path: 'qualtrics/wellbeing-survey.qsf', title: 'Qualtrics wellbeing survey', detail: 'Qualtrics .qsf export with display logic' },
  { path: 'redcap/SleepStudy_DataDictionary.csv', title: 'REDCap sleep study', detail: 'REDCap data dictionary with branching logic' },
];

export function DataPullPage({ session, onLoaded, notify }: Props) {
  const [studyId, setStudyId] = useState('');
  const [token, setToken] = useState('');
  const [server, setServer] = useState<WearitServer>('wearables-survey');
  const [pulling, setPulling] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const pull = async () => {
    abort.current = new AbortController();
    setPulling('Connecting to Wear-IT…');
    try {
      const pages = await pullWearit({
        server,
        studyId,
        token,
        signal: abort.current.signal,
        onPage: (n) => setPulling(`Pulling data… page ${n}`),
      });
      setPulling('Processing…');
      const { spec, notes } = wearitPagesToSpec(pages, { studyId: studyId.trim() });
      onLoaded({ fileName: `Wear-IT study ${studyId.trim()} (${server})`, translatorLabel: 'Wear-IT API', notes }, validateSpec(spec));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify((e as Error).message, 'error', 10000);
    } finally {
      setPulling(null);
      abort.current = null;
    }
  };

  const loadText = (fileName: string, text: string) => {
    const input = { fileName, text };
    const t = detectTranslator(input);
    if (!t) {
      notify(`Couldn't recognize ${fileName}. Supported: ${TRANSLATORS.map((x) => x.label).join(', ')}.`, 'error', 10000);
      return;
    }
    try {
      const { spec, notes } = t.translate(input);
      onLoaded({ fileName, translatorLabel: t.label, notes }, validateSpec(spec));
    } catch (e) {
      notify((e as Error).message, 'error', 10000);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (file) loadText(file.name, await file.text());
  };

  const loadExample = async (path: string) => {
    const key = Object.keys(exampleFiles).find((k) => k.endsWith(`/examples/${path}`));
    if (key) loadText(path.split('/').pop()!, await exampleFiles[key]!());
  };

  return (
    <>
      <PageTitle>Pull Data</PageTitle>
      <Box title="Pull from Wear-IT">
        <form
          className="dm-grid-2"
          onSubmit={(e) => {
            e.preventDefault();
            void pull();
          }}
        >
          <div>
            <Field label="Study ID">
              <input className="dm-input" value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="Enter Study ID" autoComplete="off" />
            </Field>
            <Field label="API Token">
              <input className="dm-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Enter API Token" autoComplete="off" />
            </Field>
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
            <div className="dm-pull-actions">
              <button className="dm-btn dm-btn-primary dm-btn-lg" type="submit" disabled={!!pulling || !studyId.trim() || !token.trim()}>
                <Icon name="download" size={18} /> {pulling ? 'Pulling…' : 'Pull Data from Wear-IT'}
              </button>
              {pulling && (
                <button type="button" className="dm-btn dm-btn-secondary" onClick={() => abort.current?.abort()}>
                  Cancel
                </button>
              )}
            </div>
            {pulling && <p className="dm-progress">{pulling}</p>}
          </div>
        </form>
        <div className="dm-security-note">
          <Icon name="lock" /> Your credentials are only sent to Wear-IT and are never stored.
        </div>
      </Box>

      <Row>
        <Box title="Import a File" width={6}>
          <div
            className="dm-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <Icon name="upload" size={28} />
            <p>Drop a file here</p>
            <label className="dm-btn dm-btn-primary">
              Choose file
              <input
                type="file"
                hidden
                accept={[...new Set(TRANSLATORS.flatMap((t) => t.accept.split(',')))].join(',')}
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <ul className="dm-sources">
            {TRANSLATORS.map((t) => (
              <li key={t.id}>
                <strong>{t.label}</strong>
                <span>{t.howToGet}</span>
              </li>
            ))}
          </ul>
        </Box>
        <Box title="Example Studies" width={6}>
          <div className="dm-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex.path} className="dm-example" onClick={() => void loadExample(ex.path)}>
                <strong>{ex.title}</strong>
                <span>{ex.detail}</span>
              </button>
            ))}
          </div>
        </Box>
      </Row>

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
