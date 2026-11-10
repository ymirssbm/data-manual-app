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
import type { StatFile, ValueLabel } from './statfiles';
import { toIsoDateTime } from './time';

export interface DatasetTable {
  columns: string[];
  rows: string[][];
  /** From SPSS, SAS and Stata files: column -> variable label (the question text). */
  labels?: Record<string, string>;
  /** From SPSS and Stata files: column -> value labels (the response options). */
  valueLabels?: Record<string, ValueLabel[]>;
  /** e.g. "SPSS (.sav)" when the table came from a statistical package's file. */
  source?: string;
  notes?: string[];
}

/** An SPSS, SAS or Stata file as a dataset table, keeping its labels. */
export function statFileToTable(f: StatFile): DatasetTable {
  return { columns: f.columns, rows: f.rows, labels: f.labels, valueLabels: f.valueLabels, source: f.format, notes: f.notes };
}

export type DatasetLayout = 'long' | 'wide';

/** What a header row holds, in a wide file: the variables' question IDs, their question text, or nothing useful. */
export type HeaderRole = 'id' | 'text' | 'ignore';

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
  /** long only: column naming the variable (its question ID). */
  question?: string;
  /** long only: column holding the question text (optional). */
  questionText?: string;
  /** long only: column holding the value. */
  response?: string;
  /** wide only: the variable columns (default: every unmapped column). */
  variables?: string[];
  /**
   * wide only: what the column names and any rows under them hold, top down. ['id'] (the default)
   * means the column names are question IDs and data starts on the first row; ['text', 'id'] means
   * the column names are question text and the first row holds the IDs, with data from row 2.
   */
  headerRows?: HeaderRole[];
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
  /** Question ID -> question text, when the file has it. */
  questionText: Map<string, string>;
  /** Question ID -> its response options, from SPSS or Stata value labels. */
  valueLabels: Map<string, ValueLabel[]>;
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

/** The first column matching the first pattern that matches any column: earlier patterns are better guesses. */
const has = (cols: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const c = cols.find((x) => p.test(x));
    if (c) return c;
  }
  return undefined;
};

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
  const questionText = has(cols, /^(question[ _.]?text|item[ _.]?text|text|label|prompt[ _.]?text|wording)$/i);
  const layout: DatasetLayout = question && response ? 'long' : 'wide';
  const used = new Set([participant, time, session, survey].filter(Boolean) as string[]);
  // Survey platforms' bookkeeping columns aren't questions: leave them out of the variables by default.
  const bookkeeping = /^(start_?date|end_?date|recorded_?date|status|ip_?address|progress|duration.*|finished|recipient.*|external_?(data_?)?reference|location.*|distribution_?channel|user_?language|q_.*|redcap_.*|.*_complete|.*_timestamp)$/i;
  const variables = layout === 'wide' ? cols.filter((c) => !used.has(c) && !bookkeeping.test(c)) : undefined;
  return {
    layout,
    participant,
    time,
    session,
    survey: layout === 'long' ? survey : undefined,
    question: layout === 'long' ? question : undefined,
    response: layout === 'long' ? response : undefined,
    questionText: layout === 'long' ? questionText : undefined,
    variables,
    // Labelled files (SPSS, SAS, Stata) have one header row of names; the text comes from the labels.
    headerRows: variables ? (table.labels ? ['id'] : guessHeaderRows(table, variables)) : undefined,
  };
}

const looksLikeText = (v: string) => /\s/.test(v.trim()) && v.trim().length > 12;
const looksLikeId = (v: string) => /^[A-Za-z_][\w.]*$/.test(v.trim()) && v.trim().length <= 40;

/**
 * Guess what the header rows of a wide file hold, from the variable columns: column names that read
 * like sentences are question text; a first row of short identifiers (or of sentences, under ID
 * column names) is a second header row; Qualtrics' third row ({"ImportId": ...}) is ignored.
 */
export function guessHeaderRows(table: DatasetTable, variableColumns: string[]): HeaderRole[] {
  const vars = variableColumns.map((c) => table.columns.indexOf(c)).filter((i) => i >= 0);
  if (!vars.length || table.rows.length < 2) return ['id'];
  const share = (row: string[] | undefined, test: (v: string) => boolean) => (row ? vars.filter((i) => test(row[i] ?? '')).length / vars.length : 0);
  const names = vars.map((i) => table.columns[i]!);
  const namesAreText = names.filter(looksLikeText).length / vars.length > 0.5;
  const roles: HeaderRole[] = [namesAreText ? 'text' : 'id'];
  const r1 = table.rows[0];
  if (namesAreText && share(r1, looksLikeId) > 0.8) roles.push('id');
  else if (!namesAreText && share(r1, looksLikeText) > 0.5) roles.push('text');
  if (roles.length > 1 && share(table.rows[1], (v) => /^\{\s*"?ImportId/.test(v)) > 0.5) roles.push('ignore');
  return roles;
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
  const questionText = new Map<string, string>();
  const valueLabels = new Map<string, ValueLabel[]>();
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
    const xI = idx(m.questionText);
    if (qI < 0 || vI < 0) throw new Error('Choose the question ID and response value columns.');
    for (const r of table.rows) {
      if (!r[pI]) {
        skippedNoId++;
        continue;
      }
      const q = (r[qI] ?? '').trim();
      if (!q) continue;
      push(rowMeta(r), q, r[vI] ?? '');
      const text = xI >= 0 ? (r[xI] ?? '').trim() : '';
      if (text && !questionText.has(q)) questionText.set(q, text);
    }
  } else {
    const mapped = new Set([m.participant, m.time, m.session, m.survey].filter(Boolean));
    const vars = (m.variables?.length ? m.variables : table.columns.filter((c) => !mapped.has(c))).filter((c) => table.columns.includes(c));
    if (!vars.length) throw new Error('Choose at least one variable column.');
    const vIdx = vars.map((v) => table.columns.indexOf(v));
    // Header rows: the column names, then any rows under them that hold IDs or text, not data.
    const roles: HeaderRole[] = m.headerRows?.length ? m.headerRows : ['id'];
    const headerAt = (k: number) => (k === 0 ? table.columns : (table.rows[k - 1] ?? []));
    const idRow = roles.indexOf('id');
    const textRow = roles.indexOf('text');
    const ids = vIdx.map((ci, k) => (idRow >= 0 ? (headerAt(idRow)[ci] ?? '').trim() : '') || vars[k]!);
    if (new Set(ids).size < ids.length) notes.push('Some question IDs repeat; their responses are combined under one variable.');
    if (textRow >= 0)
      vIdx.forEach((ci, k) => {
        const text = (headerAt(textRow)[ci] ?? '').trim();
        if (text && text !== ids[k]) questionText.set(ids[k]!, text);
      });
    vIdx.forEach((ci, k) => {
      const col = table.columns[ci]!;
      const label = table.labels?.[col];
      if (label && !questionText.has(ids[k]!)) questionText.set(ids[k]!, label);
      const vl = table.valueLabels?.[col];
      if (vl?.length) valueLabels.set(ids[k]!, vl);
    });
    for (const r of table.rows.slice(roles.length - 1)) {
      if (!r[pI]) {
        skippedNoId++;
        continue;
      }
      const meta = rowMeta(r);
      vIdx.forEach((ci, k) => push(meta, ids[k]!, r[ci] ?? ''));
    }
  }

  if (sI < 0) notes.push('Answers from the same participant with the same timestamp were grouped as one survey occasion.');
  if (tI < 0) notes.push(`No timestamp column was chosen, so every response is dated ${fallbackTime.slice(0, 10)} (the import date).`);
  if (badTimes) notes.push(`${badTimes} row(s) had a timestamp that couldn't be read; they use the import date.`);
  if (skippedNoId) notes.push(`Skipped ${skippedNoId} row(s) with no participant ID.`);
  const variables = [...new Set(cols['Question.ID'])];
  const dataRows = m.layout === 'wide' ? Math.max(0, table.rows.length - Math.max(0, (m.headerRows?.length ?? 1) - 1)) : table.rows.length;
  notes.unshift(`Read ${dataRows.toLocaleString()} rows: ${new Set(cols['Participant.ID']).size} participants, ${variables.length} variables, ${cols['Question.ID'].length.toLocaleString()} responses.`);
  if (questionText.size) notes.push(`Question text found for ${questionText.size} of ${variables.length} variables.`);
  if (valueLabels.size) notes.push(`Response options (value labels) found for ${valueLabels.size} variables.`);
  return { data: cols, variableSurveys, variables, questionText, valueLabels, notes };
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
export function attachData(spec: StudySpec, data: Record<string, unknown[]>, questionText?: Map<string, string>): { spec: StudySpec; report: AttachReport } {
  const lookup = new Map<string, string>();
  const byText = new Map<string, string>();
  const norm = (t: string) => t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const questionIds = new Set<string>();
  for (const s of spec.surveys)
    for (const q of s.questions ?? []) {
      if (q['Item.Type'] !== 'Question') continue;
      questionIds.add(q['Question.ID']);
      lookup.set(q['Question.ID'].toLowerCase(), q['Question.ID']);
      if (!lookup.has(q['Item.ID'].toLowerCase())) lookup.set(q['Item.ID'].toLowerCase(), q['Question.ID']);
      if (q['Question.Text'] && !byText.has(norm(q['Question.Text']))) byText.set(norm(q['Question.Text']), q['Question.ID']);
    }
  // By ID first; then, for variables whose ID isn't in the study, by matching question text.
  const resolve = (q: string) => lookup.get(q.toLowerCase()) ?? (questionText?.has(q) ? byText.get(norm(questionText.get(q)!)) : undefined) ?? byText.get(norm(q)) ?? q;
  const qcol = (data['Question.ID'] as string[]).map((q) => resolve(String(q)));
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
    questions: vars.map((name) => {
      let q = inferQuestion(name, values.get(name) ?? []);
      // Value labels make it a choice question, with the labels as its options.
      const vl = result.valueLabels.get(name);
      if (vl?.length) {
        const labelled = new Map(vl.map((x) => [x.value, x.label]));
        const seen = [...new Set(values.get(name) ?? [])].filter((x) => !labelled.has(x));
        const all = [...vl.map((x) => x.value), ...seen];
        const numeric = all.every((x) => x.trim() !== '' && Number.isFinite(Number(x)));
        if (numeric) all.sort((a, b) => Number(a) - Number(b));
        q = {
          ...q,
          'Question.Type.Display.Name': 'Multiple Choice',
          'Data.Type': numeric ? (all.every((x) => Number.isInteger(Number(x))) ? 'integer' : 'numeric') : 'character',
          responseKey: all.map((v) => ({ value: v, definition: labelled.get(v) ?? v })),
          'Question.Description': "Response options from the file's value labels.",
        };
      }
      const text = result.questionText.get(name);
      return text ? { ...q, 'Question.Text': text } : q;
    }),
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
