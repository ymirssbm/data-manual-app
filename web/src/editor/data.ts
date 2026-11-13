// Deleting questions from the study, and optionally their responses from the data.
import { isBlock, isEndBlock, type StudySpec } from '../core';
import { withSurveyReplaced } from '../exporters';
import { deleteItem, descendants } from './edit';

/** The Question.IDs that deleting these items removes (a block takes its questions with it). */
export function questionIdsOf(spec: StudySpec, surveyName: string, itemIds: string[]): string[] {
  const s = spec.surveys.find((x) => x['Survey.Name'] === surveyName);
  if (!s) return [];
  const gone = new Set(itemIds.flatMap((id) => [id, ...descendants(s, id)]));
  return (s.questions ?? []).filter((q) => gone.has(q['Item.ID']) && !isBlock(q) && !isEndBlock(q)).map((q) => q['Question.ID']);
}

/** How many response rows the data holds for these questions. */
export function responseCount(spec: StudySpec, questionIds: string[]): number {
  const ids = new Set(questionIds);
  return (spec.data?.['Question.ID'] ?? []).reduce((n, q) => n + (ids.has(String(q)) ? 1 : 0), 0);
}

/** The study without these questions' response rows. */
export function deleteResponses(spec: StudySpec, questionIds: string[]): StudySpec {
  const d = spec.data;
  if (!d?.['Question.ID']) return spec;
  const ids = new Set(questionIds);
  const keep = d['Question.ID'].map((q) => !ids.has(String(q)));
  if (keep.every(Boolean)) return spec;
  const data = Object.fromEntries(Object.entries(d).map(([k, col]) => [k, Array.isArray(col) ? col.filter((_, i) => keep[i]) : col])) as typeof d;
  return { ...spec, data };
}

/** Delete items (and what's inside blocks) from a survey; with `alsoData`, their responses too. */
export function deleteItems(spec: StudySpec, surveyName: string, itemIds: string[], alsoData: boolean): StudySpec {
  const si = spec.surveys.findIndex((x) => x['Survey.Name'] === surveyName);
  if (si < 0) return spec;
  const qids = questionIdsOf(spec, surveyName, itemIds);
  let survey = spec.surveys[si]!;
  for (const id of itemIds) survey = deleteItem(survey, id);
  const next = withSurveyReplaced(spec, si, survey);
  return alsoData ? deleteResponses(next, qids) : next;
}
