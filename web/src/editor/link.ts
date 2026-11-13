// Wiring a survey by drawing and dropping, as on the flowchart: link an answer to a later question
// or block (skip logic) or to another survey (a triggered survey), and drop new or copied items in.
// Pure: each takes the study and returns the changed study, or why it can't be done.
import { isBlock, type Question, type StudySpec, type Survey } from '../core';
import { withSurveyReplaced } from '../exporters';
import { addItem, copyQuestion, getSkipRule, possibleParents, setSkipRule, type SkipRule } from './edit';
import { addSurveyEvent, addTrigger, surveyEvents, type TriggerRule } from './schedule';

export const isChoice = (q: Question | undefined) => q?.['Question.Type.Display.Name'] === 'Multiple Choice' || q?.['Question.Type.Display.Name'] === 'Multiple Select';

/** A starting condition on `parent` (its first option, or "at least 1"); edited afterwards. */
export const firstRule = (parent: Question, parentId: string): SkipRule =>
  isChoice(parent) ? { parentId, kind: 'in', values: parent.responseKey?.length ? [String(parent.responseKey[0]!.value)] : [] } : { parentId, kind: 'cmp', op: '>=', value: '1' };

/** The same starting condition for sending a survey. */
export const firstTriggerRule = (source: Question): TriggerRule =>
  isChoice(source) ? { source: source['Question.ID'], op: '=', value: String(source.responseKey?.[0]?.value ?? '1') } : { source: source['Question.ID'], op: '>=', value: '1' };

type Result = { spec: StudySpec; label: string; select?: string } | { error: string };

const find = (spec: StudySpec, surveyName: string) => {
  const si = spec.surveys.findIndex((s) => s['Survey.Name'] === surveyName);
  return { si, survey: spec.surveys[si] as Survey | undefined };
};
const name = (q: Question) => (isBlock(q) ? q['Question.Long.Name'] || q['Question.ID'] : q['Question.ID']);
const answerable = (q: Question) => !isBlock(q) && q['Question.Type.Display.Name'] !== 'Informational Fullscreen';

/** Show `toId` only when `fromId`'s answer matches (a starting condition, edited afterwards). */
export function linkItems(spec: StudySpec, surveyName: string, fromId: string, toId: string): Result {
  const { si, survey } = find(spec, surveyName);
  const from = survey?.questions?.find((q) => q['Item.ID'] === fromId);
  const to = survey?.questions?.find((q) => q['Item.ID'] === toId);
  if (!survey || !from || !to || fromId === toId) return { error: 'Draw from one question to a different question or block.' };
  if (!answerable(from)) return { error: `${name(from)} has no answer to branch on. Start the line from a question.` };
  if (!possibleParents(survey, toId).some((q) => q['Item.ID'] === fromId)) return { error: `${name(from)} can only lead to questions or blocks that come after it.` };
  // An item has one show-condition: say which one this replaces (undo brings it back).
  const old = getSkipRule(survey, toId);
  const oldParent = old && old.parentId !== fromId ? survey.questions!.find((q) => q['Item.ID'] === old.parentId) : undefined;
  const label = `Linked ${name(from)} → ${name(to)}${oldParent ? ` (replacing “only if ${name(oldParent)}”)` : ''}`;
  return { spec: withSurveyReplaced(spec, si, setSkipRule(survey, toId, firstRule(from, fromId))), label, select: toId };
}

/** Send `targetSurvey` when `fromId`'s answer matches: the next day, 10–10:30 AM, after each delivery. */
export function linkSurvey(spec: StudySpec, surveyName: string, fromId: string, targetSurvey: string): Result {
  const { survey } = find(spec, surveyName);
  const from = survey?.questions?.find((q) => q['Item.ID'] === fromId);
  const target = spec.surveys.find((s) => s['Survey.Name'] === targetSurvey);
  if (!survey || !from || !target) return { error: 'Draw from a question to a survey.' };
  if (targetSurvey === surveyName) return { error: 'A survey can’t send itself. Link to a question in it instead.' };
  if (!answerable(from)) return { error: `${name(from)} has no answer to send a survey on. Start from a question.` };
  if (!surveyEvents(spec, surveyName).length) return { error: `${survey['Survey.LongName'] || surveyName} isn’t on the schedule yet, so there’s no delivery to follow. Add a window on the Study Schedule first.` };
  const targetLabel = target['Survey.LongName'] || targetSurvey;
  const next = addTrigger(spec, { sourceSurvey: surveyName, rule: firstTriggerRule(from), targetSurvey, targetLabel, when: 'next', from: '10:00', to: '10:30' });
  return { spec: next, label: `${name(from)} now sends ${targetLabel}`, select: fromId };
}

/** What can be dropped onto the chart. */
export type DropItem = { kind: 'question' } | { kind: 'block' } | { kind: 'copy'; surveyName: string; itemId: string } | { kind: 'survey'; surveyName: string } | { kind: 'new-survey' };
/** Where it was dropped. */
export type DropTarget = { kind: 'question' | 'block'; itemId: string } | null;

/**
 * Drop onto the chart. Questions, blocks and copies go after the question they're dropped on, at
 * the end of the block they're dropped on, or at the end of the survey. A survey dropped on a
 * question is sent by that question's answer; a new survey is added (and, on a question, linked).
 */
export function dropItem(spec: StudySpec, surveyName: string, item: DropItem, target: DropTarget): Result {
  const { si, survey } = find(spec, surveyName);
  if (!survey) return { error: 'That survey is no longer in the study.' };
  const at = target?.kind === 'block' ? { intoBlock: target.itemId } : target ? { afterId: target.itemId } : {};
  if (item.kind === 'question' || item.kind === 'block') {
    const r = addItem(survey, item.kind, at);
    return { spec: withSurveyReplaced(spec, si, r.survey), label: item.kind === 'block' ? 'Added a block' : 'Added a question', select: r.itemId };
  }
  if (item.kind === 'copy') {
    const src = spec.surveys.find((s) => s['Survey.Name'] === item.surveyName)?.questions?.find((q) => q['Item.ID'] === item.itemId);
    if (!src) return { error: 'That question is no longer in the study.' };
    const r = copyQuestion(survey, src, at);
    return { spec: withSurveyReplaced(spec, si, r.survey), label: `Copied ${src['Question.ID']} into ${survey['Survey.LongName'] || surveyName}`, select: r.itemId };
  }
  if (item.kind === 'survey') {
    if (target?.kind !== 'question') return { error: 'Drop a survey onto the question whose answer should send it.' };
    return linkSurvey(spec, surveyName, target.itemId, item.surveyName);
  }
  // A new survey: on the schedule daily for a week, or, dropped on a question, sent by its answer.
  const used = new Set(spec.surveys.map((s) => s['Survey.Name']));
  let id = 'new_survey';
  for (let k = 2; used.has(id); k++) id = `new_survey_${k}`;
  const withSurvey: StudySpec = { ...spec, surveys: [...spec.surveys, { 'Survey.Name': id, 'Survey.LongName': 'New survey', questions: [] }] };
  if (target?.kind === 'question') {
    const r = linkSurvey(withSurvey, surveyName, target.itemId, id);
    return 'error' in r ? r : { ...r, label: `Added a new survey, sent by ${name(survey.questions!.find((q) => q['Item.ID'] === target.itemId)!)}` };
  }
  return { spec: addSurveyEvent(withSurvey, id, 'New survey'), label: 'Added a new survey (daily for a week)' };
}
