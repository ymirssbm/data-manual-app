import { useEffect, useMemo, useState } from 'react';
import {
  attachData,
  datasetToData,
  guessMapping,
  inferSpecFromData,
  parseDataset,
  validateSpec,
  type DatasetMapping,
  type DatasetTable,
  type StudySpec,
  type ValidationResult,
} from '../../core';
import type { LoadedSource } from './DataPull';
import { Field, Icon } from '../ui';

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TIMEZONES = [...new Set([LOCAL_TZ, 'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'])];

interface Props {
  /** File handed in from outside (an example), shown immediately. */
  initial?: { name: string; text: string } | null;
  spec: StudySpec | null;
  onLoaded(source: LoadedSource, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

/** Upload a dataset, describe its layout, map columns, then attach it or build a study from it. */
export function DatasetImport({ initial, spec, onLoaded, notify }: Props) {
  const [file, setFile] = useState<{ name: string; table: DatasetTable } | null>(null);
  const [m, setM] = useState<DatasetMapping | null>(null);
  const [missing, setMissing] = useState('');
  const [target, setTarget] = useState<'attach' | 'new'>(spec ? 'attach' : 'new');

  const load = (name: string, text: string) => {
    try {
      const table = parseDataset(text);
      if (!table.columns.length || !table.rows.length) throw new Error('The file has no rows.');
      setFile({ name, table });
      setM({ ...guessMapping(table), timeZone: LOCAL_TZ });
      setMissing(table.rows.some((r) => r.includes('-99')) ? '-99' : '');
    } catch (e) {
      notify(`Couldn't read ${name}: ${(e as Error).message}`, 'error', 8000);
    }
  };
  useEffect(() => {
    if (initial) load(initial.name, initial.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  useEffect(() => setTarget(spec ? 'attach' : 'new'), [spec]);

  const preview = useMemo(() => {
    if (!file || !m) return null;
    try {
      return { ok: true as const, result: datasetToData(file.table, { ...m, missingCodes: missing.split(',').map((x) => x.trim()).filter(Boolean) }) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [file, m, missing]);

  const apply = () => {
    if (!file || !preview?.ok) return;
    const { result } = preview;
    if (target === 'attach' && spec) {
      const { spec: out, report } = attachData(spec, result.data);
      const notes = [...result.notes, `Matched ${report.matched.length} variable(s) to questions in "${spec['Study.Metadata']['Study.Name']}".`];
      if (report.unmatchedInData.length) notes.push(`Not in the study (kept in the data, but no codebook entry): ${report.unmatchedInData.slice(0, 12).join(', ')}${report.unmatchedInData.length > 12 ? '…' : ''}.`);
      if (report.questionsWithoutData.length) notes.push(`Questions with no data: ${report.questionsWithoutData.slice(0, 12).join(', ')}${report.questionsWithoutData.length > 12 ? '…' : ''}.`);
      onLoaded({ fileName: file.name, translatorLabel: 'Dataset attached to study', notes }, validateSpec(out));
    } else {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      onLoaded(
        { fileName: file.name, translatorLabel: 'Dataset (study inferred from data)', notes: [...result.notes, 'Question types were inferred from the values; add question text and labels by attaching this data to a study spec, or with the AI assistant.'] },
        validateSpec(inferSpecFromData(result, name)),
      );
    }
  };

  const cols = file?.table.columns ?? [];
  const set = (patch: Partial<DatasetMapping>) => setM((cur) => (cur ? { ...cur, ...patch } : cur));
  const colSelect = (label: string, key: 'participant' | 'time' | 'session' | 'survey' | 'question' | 'response', optional = true, hint?: string) => (
    <Field label={label} hint={hint}>
      <select className="dm-input" value={m?.[key] ?? ''} onChange={(e) => set({ [key]: e.target.value || undefined })}>
        {optional && <option value="">(none)</option>}
        {cols.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </Field>
  );

  if (!file || !m) {
    return (
      <div className="dm-dataset-empty">
        <p>
          Upload a CSV or TSV of responses from any source, then say how it's laid out. Every tool (codebook, dictionary, descriptives, outliers) then works on it.
        </p>
        <label className="dm-btn dm-btn-primary">
          <Icon name="upload" /> Choose dataset
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) load(f.name, await f.text());
            }}
          />
        </label>
      </div>
    );
  }

  const mappedCols = new Set([m.participant, m.time, m.session, m.survey, m.question, m.response].filter(Boolean));
  return (
    <div className="dm-dataset">
      <div className="dm-row-between">
        <p className="dm-dataset-file">
          <strong>{file.name}</strong> · {file.table.rows.length.toLocaleString()} rows · {cols.length} columns
        </p>
        <button className="dm-link-btn" onClick={() => (setFile(null), setM(null))}>
          Choose a different file
        </button>
      </div>

      <div className="dm-segmented dm-segmented-inline" role="radiogroup" aria-label="Layout">
        <button className={m.layout === 'long' ? 'is-active' : ''} onClick={() => set({ layout: 'long', variables: undefined })}>
          Long: one row per response
        </button>
        <button className={m.layout === 'wide' ? 'is-active' : ''} onClick={() => set({ layout: 'wide', question: undefined, response: undefined })}>
          Wide: one row per session, a column per variable
        </button>
      </div>

      <div className="dm-map-grid">
        {colSelect('Participant ID', 'participant', false)}
        {colSelect('Time', 'time', true, 'When the response was given')}
        {colSelect('Survey / form', 'survey', true, 'Optional: groups variables into surveys')}
        {colSelect('Session', 'session', true, 'Optional: otherwise participant + time')}
        {m.layout === 'long' && colSelect('Variable name column', 'question', false)}
        {m.layout === 'long' && colSelect('Value column', 'response', false)}
        <Field label="Times without a timezone are in">
          <select className="dm-input" value={m.timeZone ?? ''} onChange={(e) => set({ timeZone: e.target.value })}>
            {TIMEZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <Field label="Missing-value codes" hint="Comma-separated, e.g. -99, 999. Blank and NA are always missing.">
          <input className="dm-input" value={missing} onChange={(e) => setMissing(e.target.value)} placeholder="-99" />
        </Field>
      </div>

      {m.layout === 'wide' && (
        <Field label="Variable columns">
          <div className="dm-chip-select">
            {cols
              .filter((c) => !mappedCols.has(c))
              .map((c) => {
                const on = !m.variables?.length || m.variables.includes(c);
                return (
                  <button
                    key={c}
                    className={on ? 'is-on' : ''}
                    onClick={() => {
                      const all = cols.filter((x) => !mappedCols.has(x));
                      const cur = m.variables?.length ? m.variables : all;
                      set({ variables: on ? cur.filter((x) => x !== c) : [...cur, c] });
                    }}
                  >
                    {c}
                  </button>
                );
              })}
          </div>
        </Field>
      )}

      <div className="dm-dd-wrap dm-preview-table">
        <table className="dm-dd">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className={mappedCols.has(c) ? 'is-mapped' : ''}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {file.table.rows.slice(0, 5).map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dm-dataset-foot">
        <div className="dm-dataset-result">
          {preview?.ok ? (
            <span className="dm-ok">✓ {preview.result.notes[0]}</span>
          ) : (
            <span className="dm-bad">{preview?.error}</span>
          )}
        </div>
        <div className="dm-inline dm-inline-tight">
          {spec && (
            <select className="dm-input dm-select-sm" value={target} onChange={(e) => setTarget(e.target.value as 'attach' | 'new')}>
              <option value="attach">Attach to "{spec['Study.Metadata']['Study.Name']}"</option>
              <option value="new">Build a new study from this data</option>
            </select>
          )}
          <button className="dm-btn dm-btn-primary" disabled={!preview?.ok} onClick={apply}>
            Use this data
          </button>
        </div>
      </div>
    </div>
  );
}
