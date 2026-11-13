// Editing from anywhere: blocks from picked questions, triggered surveys, schedule windows, and the
// change list shown for AI edits.
import { describe, expect, it } from 'vitest';
import { buildSurveyModel, validateSpec, type StudySpec } from '../src/core';
import { groupIntoBlock, updateItem } from '../src/editor/edit';
import { addSurveyEvent, addTrigger, deleteEvent, removeTrigger, setTriggerRule, surveyEvents, triggerOf, triggersFrom, updateEvent } from '../src/editor/schedule';
import { diffSpecs } from '../src/editor/diff';
import { withSurveyReplaced } from '../src/exporters';
import branching from '../../examples/branching-ema-study.json';

const study = () => validateSpec(structuredClone(branching)).spec as StudySpec;
const survey = (spec: StudySpec, name: string) => spec.surveys.find((s) => s['Survey.Name'] === name)!;

describe('making blocks from picked questions', () => {
  it('wraps the picked questions in a new block where the first one was', () => {
    const s = survey(study(), 'morning');
    const r = groupIntoBlock(s, ['mo_woke', 'mo_sleep_hours'], 'Sleep basics');
    expect(r.blockId).toBeTruthy();
    const qs = r.survey.questions!;
    const block = qs.find((q) => q['Item.ID'] === r.blockId)!;
    expect(block['Question.Long.Name']).toBe('Sleep basics');
    // In the survey's order, at the first picked question's place.
    expect(qs[0]!['Item.ID']).toBe(r.blockId);
    expect(qs.filter((q) => q.Parent === r.blockId).map((q) => q['Item.ID'])).toEqual(['mo_sleep_hours', 'mo_woke']);
    // Still a valid study with the same skip logic.
    const spec = withSurveyReplaced(study(), 0, r.survey);
    expect(validateSpec(spec).valid).toBe(true);
    expect(buildSurveyModel(r.survey).branches.length).toBe(buildSurveyModel(s).branches.length);
  });

  it('does nothing without picks', () => {
    expect(groupIntoBlock(survey(study(), 'morning'), [], 'x').blockId).toBeNull();
  });
});

describe('surveys triggered by an answer', () => {
  it('adds one triggered window per delivery of the source survey, and can change or remove them', () => {
    let spec = study();
    const before = triggersFrom(spec, 'mo_energy').length;
    spec = addTrigger(spec, {
      sourceSurvey: 'morning',
      rule: { source: 'mo_energy', op: '<=', value: '20' },
      targetSurvey: 'random',
      targetLabel: 'Momentary Check',
      when: 'same',
      from: '11:00',
      to: '11:30',
    });
    const added = triggersFrom(spec, 'mo_energy');
    const morningWindows = surveyEvents(spec, 'morning').length;
    expect(added.length - before).toBe(morningWindows);
    expect(triggerOf(added[0]!)).toEqual({ source: 'mo_energy', op: '<=', value: '20' });
    expect(added[0]!.start).toMatch(/T11:00:00/);
    expect(validateSpec(spec).valid).toBe(true);

    spec = setTriggerRule(spec, 'mo_energy', 'random', { source: 'mo_energy', op: '<', value: '10' });
    expect(triggerOf(triggersFrom(spec, 'mo_energy')[0]!)?.value).toBe('10');
    spec = removeTrigger(spec, 'mo_energy', 'random');
    expect(triggersFrom(spec, 'mo_energy').length).toBe(before);
  });

  it('finds the example study’s craving follow-up from the evening craving question', () => {
    expect(triggersFrom(study(), 'ev_craving').length).toBeGreaterThan(0);
  });
});

describe('schedule windows', () => {
  it('adds, changes and removes a delivery window', () => {
    let spec = study();
    const n = surveyEvents(spec, 'weekly').length;
    spec = addSurveyEvent(spec, 'weekly', 'Weekly Review');
    const added = surveyEvents(spec, 'weekly');
    expect(added.length).toBe(n + 1);
    const e = added.at(-1)!;
    spec = updateEvent(spec, e.id, { title: 'Extra review' }, { 'Timing.Type': 'Random' });
    const changed = surveyEvents(spec, 'weekly').at(-1)!;
    expect(changed.title).toBe('Extra review');
    expect((changed.extensions as Record<string, unknown>)['Timing.Type']).toBe('Random');
    expect(validateSpec(spec).valid).toBe(true);
    spec = deleteEvent(spec, e.id);
    expect(surveyEvents(spec, 'weekly').length).toBe(n);
  });
});

describe('change list for AI edits', () => {
  it('lists changed wording, added questions and schedule changes', () => {
    const a = study();
    const m = survey(a, 'morning');
    let b = withSurveyReplaced(a, 0, updateItem(m, 'mo_energy', { 'Question.Text': 'How energetic do you feel?' }));
    b = addSurveyEvent(b, 'weekly', 'Weekly Review');
    const changes = diffSpecs(a, b);
    const text = changes.find((c) => c.kind === 'changed' && c.label.startsWith('mo_energy'))!;
    expect(text.fields).toContainEqual({ field: 'Text', before: 'How much energy do you have this morning?', after: 'How energetic do you feel?' });
    expect(changes.some((c) => c.kind === 'added' && c.area === 'schedule')).toBe(true);
    expect(diffSpecs(a, a)).toEqual([]);
  });
});

describe('finding questions', () => {
  it('ranks by ID first, then wording, then type', async () => {
    const { allQuestions, searchQuestions } = await import('../src/editor/search');
    const all = allQuestions(study());
    const mo = searchQuestions(all, 'mo_', 5);
    expect(mo.length).toBe(5);
    expect(mo.every((h) => h.questionId.startsWith('mo_'))).toBe(true);
    expect(searchQuestions(all, 'mo_energy', 1)[0]!.questionId).toBe('mo_energy');
    expect(searchQuestions(all, 'craving', 3).every((h) => /craving/i.test(`${h.questionId} ${h.text}`))).toBe(true);
    const multi = searchQuestions(all, 'multiple select', 20);
    expect(multi.length).toBeGreaterThan(0);
    expect(multi.every((h) => h.type === 'Multiple Select')).toBe(true);
    expect(searchQuestions(all, 'zzzz nothing')).toEqual([]);
  });
});

describe('selecting several items', () => {
  it('clicks, Ctrl-clicks and Shift-clicks like a file list', async () => {
    const { clickSelect } = await import('../src/components/pages/SurveyEditor');
    const order = ['a', 'b', 'c', 'd', 'e'];
    const none = { ctrlKey: false, metaKey: false, shiftKey: false };
    expect(clickSelect(order, ['a'], 'a', 'c', none)).toEqual(['c']);
    expect(clickSelect(order, ['a'], 'a', 'c', { ...none, ctrlKey: true })).toEqual(['a', 'c']);
    expect(clickSelect(order, ['a', 'c'], 'c', 'a', { ...none, metaKey: true })).toEqual(['c']);
    expect(clickSelect(order, ['b'], 'b', 'd', { ...none, shiftKey: true })).toEqual(['b', 'c', 'd']);
    expect(clickSelect(order, ['e'], 'd', 'b', { ...none, shiftKey: true })).toEqual(['b', 'c', 'd']);
  });
});

describe('deleting questions, with or without their data', () => {
  it('removes the question, and its responses only when asked', async () => {
    const { deleteItems, responseCount } = await import('../src/editor/data');
    const spec = study();
    const rows = responseCount(spec, ['mo_energy']);
    expect(rows).toBeGreaterThan(0);
    const keep = deleteItems(spec, 'morning', ['mo_energy'], false);
    expect(survey(keep, 'morning').questions!.some((q) => q['Question.ID'] === 'mo_energy')).toBe(false);
    expect(responseCount(keep, ['mo_energy'])).toBe(rows);
    const gone = deleteItems(spec, 'morning', ['mo_energy'], true);
    expect(responseCount(gone, ['mo_energy'])).toBe(0);
    expect(gone.data!['Question.ID'].length).toBe(spec.data!['Question.ID'].length - rows);
    // Every data column stays the same length.
    const lengths = new Set(Object.values(gone.data!).map((c) => (Array.isArray(c) ? c.length : -1)));
    expect(lengths.size).toBe(1);
  });
});

describe('linking and dropping on the flowchart', () => {
  it('links an answer to a later question, and refuses an earlier one', async () => {
    const { linkItems } = await import('../src/editor/link');
    const { getSkipRule } = await import('../src/editor/edit');
    const spec = study();
    const ids = survey(spec, 'morning').questions!.map((q) => q['Item.ID']);
    const energy = survey(spec, 'morning').questions!.find((q) => q['Question.ID'] === 'mo_energy')!['Item.ID'];
    const hours = survey(spec, 'morning').questions!.find((q) => q['Question.ID'] === 'mo_sleep_hours')!['Item.ID'];
    expect('error' in linkItems(spec, 'morning', energy, hours)).toBe(true);
    const r = linkItems(spec, 'morning', hours, energy);
    if ('error' in r) throw new Error(r.error);
    expect(getSkipRule(survey(r.spec, 'morning'), energy)?.parentId).toBe(hours);
    expect(validateSpec(r.spec).valid).toBe(true);
    expect(ids.length).toBe(survey(r.spec, 'morning').questions!.length);
  });

  it('sends a survey from an answer, and drops new and copied items in place', async () => {
    const { dropItem, linkSurvey } = await import('../src/editor/link');
    const spec = study();
    const energy = survey(spec, 'morning').questions!.find((q) => q['Question.ID'] === 'mo_energy')!['Item.ID'];
    const sent = linkSurvey(spec, 'morning', energy, 'weekly');
    if ('error' in sent) throw new Error(sent.error);
    expect(triggersFrom(sent.spec, 'mo_energy').length).toBeGreaterThan(0);
    expect(validateSpec(sent.spec).valid).toBe(true);

    const first = survey(spec, 'morning').questions![0]!['Item.ID'];
    const added = dropItem(spec, 'morning', { kind: 'question' }, { kind: 'question', itemId: first });
    if ('error' in added) throw new Error(added.error);
    expect(survey(added.spec, 'morning').questions![1]!['Item.ID']).toBe(added.select);

    const evening = survey(spec, 'evening').questions!.find((q) => q['Question.Type.Display.Name'] !== 'Block')!;
    const copied = dropItem(spec, 'morning', { kind: 'copy', surveyName: 'evening', itemId: evening['Item.ID'] }, null);
    if ('error' in copied) throw new Error(copied.error);
    expect(survey(copied.spec, 'morning').questions!.at(-1)!['Question.Text']).toBe(evening['Question.Text']);
    expect(validateSpec(copied.spec).valid).toBe(true);

    expect('error' in dropItem(spec, 'morning', { kind: 'survey', surveyName: 'weekly' }, null)).toBe(true);
    const fresh = dropItem(spec, 'morning', { kind: 'new-survey' }, null);
    if ('error' in fresh) throw new Error(fresh.error);
    expect(fresh.spec.surveys.length).toBe(spec.surveys.length + 1);
    expect(validateSpec(fresh.spec).valid).toBe(true);
  });
});

describe('schedules by study day', () => {
  it('describes repeats by study day, not by the example dates', async () => {
    const { buildStudySchedule } = await import('../src/generators');
    const texts = buildStudySchedule(study()).events.map((e) => e.recurrenceText);
    expect(texts.some((t) => /study days 1–7/.test(t))).toBe(true);
    expect(texts.every((t) => !/20\d\d/.test(t))).toBe(true);
  });
});
