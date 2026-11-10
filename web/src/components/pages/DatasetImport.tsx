import { useEffect, useMemo, useState } from 'react';
import {
  attachData,
  datasetToData,
  guessHeaderRows,
  guessMapping,
  inferSpecFromData,
  isStatFile,
  parseDataset,
  readStatFile,
  statFileToTable,
  STAT_FILE_EXTENSIONS,
  validateSpec,
  type DatasetMapping,
  type DatasetTable,
  type HeaderRole,
  type StudySpec,
  type ValidationResult,
} from '../../core';
import type { LoadedSource } from './DataPull';
import { Field, Icon } from '../ui';

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TIMEZONES = [...new Set([LOCAL_TZ, 'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'])];

interface Props {
  /** File handed in from outside, shown immediately: CSV text, or a table already read from an SPSS/SAS/Stata file. */
  initial?: { name: string; text?: string; table?: DatasetTable } | null;
  spec: StudySpec | null;
  onLoaded(source: LoadedSource, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
  /** "Choose a different file": handled by the page when it owns the file picker. */
  onReset?(): void;
}

const ROLE_LABELS: Record<HeaderRole, string> = { id: 'Question IDs', text: 'Question text', ignore: 'Ignore (not data)' };

/** Upload a dataset, describe its layout, map columns, then attach it or build a study from it. */
export function DatasetImport({ initial, spec, onLoaded, notify, onReset }: Props) {
  const [file, setFile] = useState<{ name: string; table: DatasetTable } | null>(null);
  const [m, setM] = useState<DatasetMapping | null>(null);
  const [missing, setMissing] = useState('');
  const [target, setTarget] = useState<'attach' | 'new'>(spec ? 'attach' : 'new');

  const load = (name: string, text?: string, given?: DatasetTable) => {
    try {
      const table = given ?? parseDataset(text ?? '');
      if (!table.columns.length || !table.rows.length) throw new Error('The file has no rows.');
      setFile({ name, table });
      setM({ ...guessMapping(table), timeZone: LOCAL_TZ });
      // SPSS, SAS and Stata files mark their own missing values; for CSVs, -99 is a common code.
      setMissing(!table.source && table.rows.some((r) => r.includes('-99')) ? '-99' : '');
    } catch (e) {
      notify(`Couldn't read ${name}: ${(e as Error).message}`, 'error', 8000);
    }
  };
  useEffect(() => {
    if (initial) load(initial.name, initial.text, initial.table);
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
      const { spec: out, report } = attachData(spec, result.data, result.questionText);
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
  const colSelect = (label: string, key: 'participant' | 'time' | 'session' | 'survey' | 'question' | 'response' | 'questionText', optional = true, hint?: string) => (
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
            accept={['.csv', '.tsv', '.txt', 'text/csv', ...STAT_FILE_EXTENSIONS].join(',')}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (!isStatFile(f.name)) return load(f.name, await f.text());
              try {
                load(f.name, undefined, statFileToTable(await readStatFile(f.name, await f.arrayBuffer())));
              } catch (err) {
                notify(`Couldn't read ${f.name}: ${(err as Error).message}`, 'error', 8000);
              }
            }}
          />
        </label>
      </div>
    );
  }

  const mappedCols = new Set([m.participant, m.time, m.session, m.survey, m.question, m.response, m.questionText].filter(Boolean));
  const roles: HeaderRole[] = m.layout === 'wide' ? (m.headerRows?.length ? m.headerRows : ['id']) : ['id'];
  const setRole = (k: number, role: HeaderRole | 'data') => {
    // Rows below a "data starts here" row are data; picking a role for the next row adds it as a header row.
    const next = roles.slice(0, k);
    if (role !== 'data') next.push(role);
    set({ headerRows: next.length ? next : ['id'] });
  };
  const sample = preview?.ok ? preview.result.variables.slice(0, 6) : [];
  return (
    <div className="dm-dataset">
      <div className="dm-row-between">
        <p className="dm-dataset-file">
          <strong>{file.name}</strong> · {file.table.rows.length.toLocaleString()} rows · {cols.length} columns
        </p>
        {!onReset && (
          <button className="dm-link-btn" onClick={() => (setFile(null), setM(null))}>
            Choose a different file
          </button>
        )}
      </div>

      <div className="dm-segmented dm-segmented-inline" role="radiogroup" aria-label="Layout">
        <button className={m.layout === 'long' ? 'is-active' : ''} onClick={() => set({ layout: 'long', variables: undefined })}>
          Long: one row per response
        </button>
        <button
          className={m.layout === 'wide' ? 'is-active' : ''}
          onClick={() => {
            const used = new Set([m.participant, m.time, m.session, m.survey].filter(Boolean));
            set({ layout: 'wide', question: undefined, response: undefined, questionText: undefined, headerRows: guessHeaderRows(file.table, cols.filter((c) => !used.has(c))) });
          }}
        >
          Wide: one row per survey occasion, a column per question
        </button>
      </div>

      <div className="dm-map-grid">
        {colSelect('Participant ID', 'participant', false)}
        {colSelect('Response timestamp', 'time', true, 'The date and time each answer was submitted (e.g. 2026-02-17 08:11), not the study day or wave.')}
        {colSelect('Survey / form', 'survey', true, 'Optional: which survey each answer belongs to.')}
        {colSelect('Survey occasion', 'session', true, 'Optional: which answers were given together in one sitting. See below.')}
        {m.layout === 'long' && colSelect('Question ID column', 'question', false, 'The variable name, e.g. mood_1.')}
        {m.layout === 'long' && colSelect('Question text column', 'questionText', true, 'Optional: the wording, e.g. "How is your mood?"')}
        {m.layout === 'long' && colSelect('Response value column', 'response', false)}
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

      <details className="dm-explain">
        <summary>What is a survey occasion?</summary>
        <p>
          One sitting: a single prompt, beep or survey completion. The answers someone gave in it belong together, which is how response rates and
          missingness are counted (a prompt that was delivered but not answered is one missed occasion).
        </p>
        <p>
          Leave it as <em>(none)</em> if all answers from one sitting share the same timestamp: the app groups them by participant and timestamp. Pick a
          column if your file has one (a session, beep, prompt or REDCap event column), or if each answer has its own timestamp.
        </p>
      </details>

      {file.table.source && (
        <p className="dm-callout dm-callout-plain">
          <Icon name="file" />
          <span>
            Read as <strong>{file.table.source}</strong>. Question text comes from its variable labels ({Object.keys(file.table.labels ?? {}).length} of {cols.length} columns have one)
            {Object.keys(file.table.valueLabels ?? {}).length > 0 && <>, and response options from its value labels ({Object.keys(file.table.valueLabels ?? {}).length} variable{Object.keys(file.table.valueLabels ?? {}).length === 1 ? '' : 's'})</>}. Dates and missing values were read from
            the file's own formats. {file.table.notes?.join(' ')}
          </span>
        </p>
      )}

      {m.layout === 'wide' && !file.table.source && (
        <Field label="Where are the question IDs and question text?" hint="Some exports put the question text in the column names and the IDs in the first row (or the other way round). Qualtrics CSVs have IDs, then text, then an import row.">
          <div className="dm-header-rows">
            {[0, 1, 2, 3].slice(0, Math.min(roles.length + 1, 4)).map((k) => (
              <label key={k} className="dm-header-row">
                <span>{k === 0 ? 'Column names' : `Row ${k}`}</span>
                <select className="dm-input dm-select-sm" value={k < roles.length ? roles[k] : 'data'} onChange={(e) => setRole(k, e.target.value as HeaderRole | 'data')}>
                  {k > 0 && <option value="data">Data starts here</option>}
                  {(Object.keys(ROLE_LABELS) as HeaderRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Field>
      )}

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
              <th className="dm-row-tag">{m.layout === 'wide' ? ROLE_LABELS[roles[0]!] : ''}</th>
              {cols.map((c) => (
                <th key={c} className={mappedCols.has(c) ? 'is-mapped' : ''}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {file.table.rows.slice(0, 5).map((r, i) => (
              <tr key={i} className={i + 1 < roles.length ? 'is-header' : ''}>
                <td className="dm-row-tag">{i + 1 < roles.length ? ROLE_LABELS[roles[i + 1]!] : ''}</td>
                {r.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sample.length > 0 && (
        <div className="dm-var-sample">
          <span className="dm-hint">Variables as they will be read:</span>
          <ul>
            {sample.map((v) => (
              <li key={v}>
                <code>{v}</code>
                {preview?.ok && preview.result.questionText.get(v) ? <span>{preview.result.questionText.get(v)}</span> : <span className="dm-hint">no question text</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

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
