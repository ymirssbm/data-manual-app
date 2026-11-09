// Spec → other platforms' formats, and response data → CSV. The mirror image of translators/:
// every exporter reads only the spec and returns one file.
import { toCsv, type StudySpec } from '../core';
import { exportQualtrics } from './qualtrics';
import { exportRedcapDictionary, type ExportResult } from './redcap';
import { exportSurveyJs } from './surveyjs';

export type ExportFormat = 'spec' | 'redcap' | 'qualtrics' | 'surveyjs' | 'data-long' | 'data-wide';

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; group: 'Study design' | 'Response data'; perSurvey?: boolean; needsData?: boolean; help: string }> = [
  { id: 'spec', label: 'Study spec (JSON)', group: 'Study design', help: 'The full study in this app\'s format, with response data. Reopen it here, or share it.' },
  { id: 'redcap', label: 'REDCap data dictionary (CSV)', group: 'Study design', help: 'In REDCap: Project Setup → Data Dictionary → Upload. One instrument per survey; skip logic becomes branching logic.' },
  { id: 'qualtrics', label: 'Qualtrics survey (.qsf)', group: 'Study design', perSurvey: true, help: 'In Qualtrics: Create project → Survey → From a file. Skip logic becomes display logic.' },
  { id: 'surveyjs', label: 'SurveyJS (JSON)', group: 'Study design', perSurvey: true, help: 'For SurveyJS forms and SurveyJS Creator. Blocks become panels; skip logic becomes visibleIf.' },
  { id: 'data-long', label: 'Responses, long format (CSV)', group: 'Response data', needsData: true, help: 'One row per response: participant, session, time, survey, question, value.' },
  { id: 'data-wide', label: 'Responses, wide format (CSV)', group: 'Response data', needsData: true, help: 'One row per completed survey, one column per question.' },
];

const fileBase = (spec: StudySpec) => (spec['Study.Metadata']['Study.Name'] || 'study').replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '');

export function exportStudy(spec: StudySpec, format: ExportFormat, opts: { survey?: string } = {}): ExportResult {
  switch (format) {
    case 'spec':
      return { fileName: `${fileBase(spec)}.json`, text: `${JSON.stringify(spec, null, 2)}\n`, mime: 'application/json', notes: [] };
    case 'redcap':
      return exportRedcapDictionary(spec);
    case 'qualtrics':
      return exportQualtrics(spec, opts.survey);
    case 'surveyjs':
      return exportSurveyJs(spec, opts.survey);
    case 'data-long':
    case 'data-wide':
      return exportData(spec, format === 'data-wide');
  }
}

function exportData(spec: StudySpec, wide: boolean): ExportResult {
  const d = spec.data;
  const qids = d?.['Question.ID'] ?? [];
  if (!qids.length) throw new Error('This study has no response data.');
  const surveyOf = new Map<string, string>();
  for (const s of spec.surveys) for (const q of s.questions ?? []) surveyOf.set(q['Question.ID'], s['Survey.Name']);
  const pid = d!['Participant.ID'] ?? [];
  const sess = d!['Session.ID'] ?? [];
  const time = d!['Survey.Date.Completed'] ?? [];
  const val = d!['User.Response'] ?? [];
  const base = fileBase(spec);
  if (!wide) {
    const rows = qids.map((q, i) => [pid[i] ?? '', sess[i] ?? '', time[i] ?? '', surveyOf.get(q) ?? '', q, val[i] ?? '']);
    return { fileName: `${base}_responses_long.csv`, text: toCsv(['participant', 'session', 'completed', 'survey', 'question', 'value'], rows), mime: 'text/csv', notes: [] };
  }
  // Wide: one row per participant + session + survey, columns in spec order.
  const order = spec.surveys.flatMap((s) => (s.questions ?? []).filter((q) => q['Item.Type'] === 'Question').map((q) => q['Question.ID']));
  const present = order.filter((q) => qids.includes(q));
  const rows = new Map<string, { pid: string; sess: string; time: string; survey: string; values: Map<string, string> }>();
  qids.forEach((q, i) => {
    const key = `${pid[i]}\u0000${sess[i]}\u0000${surveyOf.get(q) ?? ''}`;
    const r = rows.get(key) ?? { pid: String(pid[i] ?? ''), sess: String(sess[i] ?? ''), time: String(time[i] ?? ''), survey: surveyOf.get(q) ?? '', values: new Map() };
    r.values.set(q, String(val[i] ?? ''));
    rows.set(key, r);
  });
  const out = [...rows.values()].map((r) => [r.pid, r.sess, r.time, r.survey, ...present.map((q) => r.values.get(q) ?? '')]);
  return { fileName: `${base}_responses_wide.csv`, text: toCsv(['participant', 'session', 'completed', 'survey', ...present], out), mime: 'text/csv', notes: ['Empty cells: the question was not shown in that survey, or was skipped.'] };
}

export type { ExportResult };
export { exportQualtrics, exportRedcapDictionary, exportSurveyJs };
export { surveyJsPageToSurvey, surveyToSurveyJsPage, withSurveyReplaced } from './surveyjs';
