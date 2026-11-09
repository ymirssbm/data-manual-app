// "Bring your own dataset": a table of responses + a description of its layout
// -> the spec's long-format `data` block, which every tool reads.
//
// Layouts:
//   long  one row per response: participant, time, variable-name column, value column
//         (typical EMA exports)
//   wide  one row per observation/session: participant, time, then one column per variable
//         (typical survey exports: Qualtrics/REDCap CSVs, SPSS-style files)
// The data can be attached to a loaded study (matched on Question.ID), or a study can be
// inferred from the data alone so the codebook/dictionary still work.
import { buildBlockMap } from './model';
import { parseCsv } from './csv';
import type { StudySpec, Survey } from './spec';
import { toIsoDateTime } from './time';

export interface DatasetTable {
  columns: string[];
  rows: string[][];
}

export type DatasetLayout = 'long' | 'wide';

export interface DatasetMapping {
  layout: DatasetLayout;
  /** Column holding the participant ID. */
  participant: string;
  /** Column holding when the response was given (optional). */
  time?: string;
  /** Column grouping rows into sessions/prompts (optional; derived from participant + time otherwise). */
  session?: string;
  /** Column naming the survey/form a row belongs to (optional). */
  survey?: string;
  /** long only: column naming the variable. */
  question?: string;
  /** long only: column holding the value. */
  response?: string;
  /** wide only: the variable columns (default: every unmapped column). */
  variables?: string[];
  /** IANA timezone for times written without an offset (default UTC). */
  timeZone?: string;
  /** Values that mean "missing" (in addition to blank and NA). */
  missingCodes?: string[];
}

export interface DatasetResult {
  data: Record<string, unknown[]>;
  /** Variable name -> the survey it belongs to (when a survey column was mapped). */
  variableSurveys: Map<string, string>;
  variables: string[];
  notes: string[];
}

/** Parse CSV/TSV/semicolon text; the delimiter is detected from the header line. */
export function parseDataset(text: string): DatasetTable {
  const clean = text.replace(/^﻿/, '');
  const header = clean.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, '\t': 0, ';': 0 } as Record<string, number>;
  for (const ch of header) if (ch in counts) counts[ch]!++;
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
  const [head = [], ...body] = parseCsv(clean, delim);
  const columns = head.map((c, i) => c.trim() || `column_${i + 1}`);
  return { columns, rows: body.map((r) => columns.map((_, i) => (r[i] ?? '').trim())) };
}

const has = (cols: string[], ...patterns: RegExp[]) => cols.find((c) => patterns.some((p) => p.test(c)));

/** Best guess at a mapping from column names (the user can change every choice). */
export function guessMapping(table: DatasetTable): DatasetMapping {
  const cols = table.columns;
  const participant =
    has(cols, /^(participant|subject|person|user)[ _.]?id$/i, /^(pid|sid|subid|record_id|responseid|response_id|externalreference)$/i, /^(participant|subject|id)$/i) ?? cols[0] ?? '';
  const time = has(cols, /^(survey[ _.]?date[ _.]?completed|completed|end_?date|recorded_?date|timestamp|date_?time|datetime|time_?stamp|when|submitted|submitted_?at|created_?at)$/i, /(time|date)/i);
  const session = has(cols, /^(session|session[ _.]?id|beep|prompt|occasion|wave|redcap_event_name)$/i);
  const survey = has(cols, /^(survey|survey[ _.]?name|form|instrument|questionnaire)$/i);
  const question = has(cols, /^(question[ _.]?id|question|item|variable|var|item[ _.]?id)$/i);
  const response = has(cols, /^(user[ _.]?response|response|value|answer|score)$/i);
  const layout: DatasetLayout = question && response ? 'long' : 'wide';
  const used = new Set([participant, time, session, survey].filter(Boolean) as string[]);
  return {
    layout,
    participant,
    time,
    session,
    survey: layout === 'long' ? survey : undefined,
    question: layout === 'long' ? question : undefined,
    response: layout === 'long' ? response : undefined,
    variables: layout === 'wide' ? cols.filter((c) => !used.has(c)) : undefined,
  };
}

const DEFAULT_MISSING = ['', 'na', 'n/a', 'nan', 'null', '.'];

/** Table + mapping -> the spec's data columns. */
export function datasetToData(table: DatasetTable, m: DatasetMapping, now = new Date()): DatasetResult {
  const idx = (c?: string) => (c ? table.columns.indexOf(c) : -1);
  const pI = idx(m.participant);
  if (pI < 0) throw new Error('Choose the participant ID column.');
  const tI = idx(m.time);
  const sI = idx(m.session);
  const svI = idx(m.survey);
  const missing = new Set([...DEFAULT_MISSING, ...(m.missingCodes ?? []).map((x) => x.trim().toLowerCase())]);
  const isMissing = (v: string) => missing.has(v.trim().toLowerCase());
  const fallbackTime = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const notes: string[] = [];

  const cols = { 'Participant.ID': [] as string[], 'Session.ID': [] as number[], 'Survey.Date.Completed': [] as string[], 'Question.ID': [] as string[], 'User.Response': [] as string[] };
  const sessionIds = new Map<string, number>();
  const variableSurveys = new Map<string, string>();
  let badTimes = 0;
  let skippedNoId = 0;

  const rowMeta = (r: string[]) => {
    const pid = r[pI] ?? '';
    const rawTime = tI >= 0 ? (r[tI] ?? '') : '';
    let time = tI >= 0 ? toIsoDateTime(rawTime, m.timeZone) : null;
    if (tI >= 0 && !time && rawTime) badTimes++;
    time ??= fallbackTime;
    const key = sI >= 0 ? `${pid}\u0000${r[sI]}` : `${pid}\u0000${rawTime}\u0000${svI >= 0 ? r[svI] : ''}`;
    let session = sessionIds.get(key);
    if (session == null) {
      session = sessionIds.size + 1;
      sessionIds.set(key, session);
    }
    return { pid, time, session, survey: svI >= 0 ? (r[svI] ?? '') : '' };
  };
  const push = (meta: ReturnType<typeof rowMeta>, q: string, v: string) => {
    cols['Participant.ID'].push(meta.pid);
    cols['Session.ID'].push(meta.session);
    cols['Survey.Date.Completed'].push(meta.time);
    cols['Question.ID'].push(q);
    cols['User.Response'].push(isMissing(v) ? '' : v);
    if (meta.survey && !variableSurveys.has(q)) variableSurveys.set(q, meta.survey);
  };

  if (m.layout === 'long') {
    const qI = idx(m.question);
    const vI = idx(m.response);
    if (qI < 0 || vI < 0) throw new Error('Choose the question (variable name) and response columns.');
    for (const r of table.rows) {
      if (!r[pI]) {
        skippedNoId++;
        continue;
      }
      const q = (r[qI] ?? '').trim();
      if (q) push(rowMeta(r), q, r[vI] ?? '');
    }
  } else {
    const mapped = new Set([m.participant, m.time, m.session, m.survey].filter(Boolean));
    const vars = (m.variables?.length ? m.variables : table.columns.filter((c) => !mapped.has(c))).filter((c) => table.columns.includes(c));
    if (!vars.length) throw new Error('Choose at least one variable column.');
    const vIdx = vars.map((v) => table.columns.indexOf(v));
    for (const r of table.rows) {
      if (!r[pI]) {
        skippedNoId++;
        continue;
      }
      const meta = rowMeta(r);
      vars.forEach((v, k) => push(meta, v, r[vIdx[k]!] ?? ''));
    }
  }

  if (sI < 0) notes.push('Sessions were numbered from each participant + time combination.');
  if (tI < 0) notes.push(`No time column was chosen, so every response is dated ${fallbackTime.slice(0, 10)} (the import date).`);
  if (badTimes) notes.push(`${badTimes} row(s) had a time that couldn't be read; they use the import date.`);
  if (skippedNoId) notes.push(`Skipped ${skippedNoId} row(s) with no participant ID.`);
  const variables = [...new Set(cols['Question.ID'])];
  notes.unshift(`Read ${table.rows.length.toLocaleString()} rows: ${new Set(cols['Participant.ID']).size} participants, ${variables.length} variables, ${cols['Question.ID'].length.toLocaleString()} responses.`);
  return { data: cols, variableSurveys, variables, notes };
}

export interface AttachReport {
  matched: string[];
  /** Variables in the data with no question in the study. */
  unmatchedInData: string[];
  /** Questions in the study with no data. */
  questionsWithoutData: string[];
}

/**
 * Put response data into a study, matching data variables to Question.ID
 * (case-insensitive; Item.ID also accepted and rewritten to the Question.ID).
 */
export function attachData(spec: StudySpec, data: Record<string, unknown[]>): { spec: StudySpec; report: AttachReport } {
  const lookup = new Map<string, string>();
  const questionIds = new Set<string>();
  for (const s of spec.surveys)
    for (const q of s.questions ?? []) {
      if (q['Item.Type'] !== 'Question') continue;
      questionIds.add(q['Question.ID']);
      lookup.set(q['Question.ID'].toLowerCase(), q['Question.ID']);
      if (!lookup.has(q['Item.ID'].toLowerCase())) lookup.set(q['Item.ID'].toLowerCase(), q['Question.ID']);
    }
  const qcol = (data['Question.ID'] as string[]).map((q) => lookup.get(String(q).toLowerCase()) ?? q);
  const inData = new Set(qcol);
  const report: AttachReport = {
    matched: [...inData].filter((q) => questionIds.has(q)),
    unmatchedInData: [...inData].filter((q) => !questionIds.has(q)),
    questionsWithoutData: [...questionIds].filter((q) => !inData.has(q)),
  };
  return { spec: { ...spec, data: { ...data, 'Question.ID': qcol } as unknown as StudySpec['data'] }, report };
}

/** Build a study from data alone: one survey per survey value (or one survey), a question per variable. */
export function inferSpecFromData(result: DatasetResult, studyName: string): StudySpec {
  const values = new Map<string, string[]>();
  const q = result.data['Question.ID'] as string[];
  const v = result.data['User.Response'] as string[];
  for (let i = 0; i < q.length; i++) {
    const list = values.get(q[i]!) ?? [];
    if (v[i] !== '') list.push(v[i]!);
    values.set(q[i]!, list);
  }
  const bySurvey = new Map<string, string[]>();
  for (const name of result.variables) {
    const s = result.variableSurveys.get(name) || 'dataset';
    bySurvey.set(s, [...(bySurvey.get(s) ?? []), name]);
  }
  const surveys: Survey[] = [...bySurvey.entries()].map(([survey, vars]) => ({
    'Survey.Name': survey,
    'Survey.LongName': survey === 'dataset' ? 'Dataset variables' : survey,
    questions: vars.map((name) => inferQuestion(name, values.get(name) ?? [])),
  }));
  return {
    'Study.Metadata': { 'Study.Name': studyName },
    schedules: [],
    surveys,
    blockMap: buildBlockMap(surveys),
    data: result.data as unknown as StudySpec['data'],
  };
}

type Question = NonNullable<Survey['questions']>[number];

/** Guess a question's type from its values. Labels are unknown, so values label themselves. */
export function inferQuestion(name: string, values: string[]): Question {
  const base = { 'Item.ID': name, 'Question.ID': name, 'Item.Type': 'Question' as const, Parent: null, 'Question.Description': 'Inferred from the data: add question text and labels when available.' };
  const distinct = [...new Set(values)];
  const isNum = (x: string) => x.trim() !== '' && Number.isFinite(Number(x));
  if (values.length && values.some((x) => /^\d+(\s*[,;|]\s*\d+)+$/.test(x)) && values.every((x) => /^\d+(\s*[,;|]\s*\d+)*$/.test(x))) {
    const codes = [...new Set(values.flatMap((x) => x.split(/[,;|]/).map((c) => c.trim())))].sort((a, b) => +a - +b);
    return { ...base, 'Question.Text': name, 'Question.Type.Display.Name': 'Multiple Select', 'Data.Type': 'integer', responseKey: codes.map((c) => ({ value: c, definition: c })) };
  }
  if (values.length && values.every(isNum)) {
    const ints = values.every((x) => Number.isInteger(Number(x)));
    if (ints && distinct.length <= 11) {
      const sorted = distinct.sort((a, b) => +a - +b);
      return { ...base, 'Question.Text': name, 'Question.Type.Display.Name': 'Multiple Choice', 'Data.Type': 'integer', responseKey: sorted.map((c) => ({ value: c, definition: c })) };
    }
    const nums = values.map(Number);
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const slider = lo >= 0 && hi <= 100 && distinct.length > 11;
    return {
      ...base,
      'Question.Text': name,
      'Question.Type.Display.Name': slider ? 'Slider' : 'Free Response',
      'Data.Type': ints ? 'integer' : 'numeric',
      responseKey: slider ? [{ value: '0', definition: '0' }, { value: '100', definition: '100' }] : [],
    };
  }
  if (distinct.length && distinct.length <= 8 && distinct.every((x) => x.length <= 40) && values.length >= distinct.length * 3) {
    return { ...base, 'Question.Text': name, 'Question.Type.Display.Name': 'Multiple Choice', 'Data.Type': 'character', responseKey: distinct.sort().map((c) => ({ value: c, definition: c })) };
  }
  return { ...base, 'Question.Text': name, 'Question.Type.Display.Name': 'Free Response', 'Data.Type': 'character', responseKey: [] };
}
