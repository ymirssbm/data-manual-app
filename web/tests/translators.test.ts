import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSpec, type StudySpec } from '../src/core';
import { detectTranslator, legacyTranslator, qualtricsTranslator, redcapTranslator } from '../src/translators';
import { parseBranching } from '../src/translators/redcap';

const ex = (p: string) => ({ fileName: p.split('/').pop()!, text: readFileSync(resolve(__dirname, '../../examples', p), 'utf8') });

function translateValid(p: string) {
  const input = ex(p);
  const t = detectTranslator(input);
  expect(t, `no translator detected for ${p}`).not.toBeNull();
  const { spec, notes } = t!.translate(input);
  const result = validateSpec(spec);
  expect(result.issues.filter((i) => i.severity === 'error'), JSON.stringify(result.issues.slice(0, 5), null, 1)).toEqual([]);
  return { translator: t!, spec: result.spec as StudySpec, notes };
}

describe('auto-detection', () => {
  it('picks the right translator for each example', () => {
    expect(detectTranslator(ex('minimal-study.json'))?.id).toBe('native');
    expect(detectTranslator(ex('older-format/ai-generated-ema-study.json'))?.id).toBe('legacy');
    expect(detectTranslator(ex('qualtrics/wellbeing-survey.qsf'))?.id).toBe('qualtrics');
    expect(detectTranslator(ex('redcap/SleepStudy_DataDictionary.csv'))?.id).toBe('redcap');
  });
});

describe('older spec format', () => {
  it('converts the AI-generated EMA study', () => {
    const { translator, spec } = translateValid('older-format/ai-generated-ema-study.json');
    expect(translator).toBe(legacyTranslator);
    expect(spec['Study.Metadata']['Study.Name']).toBeTruthy();
    expect(spec.surveys.map((s) => s['Survey.Name'])).toEqual(['Baseline Demographics', 'Morning EMA', 'Evening EMA']);
    expect(spec.schedules).toHaveLength(2);
    expect(JSON.stringify(spec)).not.toContain('Question.LongName');
  });

  it('converts the older Qualtrics-derived spec', () => {
    const { spec } = translateValid('older-format/qualtrics-course-survey.json');
    expect(spec.surveys[0]!.questions!.length).toBeGreaterThan(5);
  });
});

describe('Qualtrics .qsf', () => {
  it('converts blocks, types, recodes and display logic', () => {
    const { translator, spec, notes } = translateValid('qualtrics/wellbeing-survey.qsf');
    expect(translator).toBe(qualtricsTranslator);
    const qs = spec.surveys[0]!.questions!;
    const byQid = (id: string) => qs.find((q) => q['Question.ID'] === id)!;
    expect(spec['Study.Metadata']['Study.Name']).toBe('Student Wellbeing Survey');
    expect(qs.filter((q) => q['Item.Type'] === 'Block').map((q) => q['Item.ID'])).toEqual(['BL_about', 'BL_wellbeing']);
    expect(byQid('intro')['Question.Type.Display.Name']).toBe('Informational Fullscreen');
    expect(byQid('supports')['Question.Type.Display.Name']).toBe('Multiple Select');
    expect(byQid('job').responseKey).toEqual([
      { value: '1', definition: 'Yes' },
      { value: '0', definition: 'No' },
    ]);
    expect(byQid('job_hours')['Conditional.Info']).toMatchObject({ 'Conditional.Master.Item.ID': 'QID3', 'Conditional.Threshold': '1' });
    expect(byQid('job')['Conditional.Info']?.['Conditional.Child.Mappings']).toEqual([
      { 'Conditional.Child.Item.ID': 'QID4', Definition: 'Yes' },
    ]);
    expect(notes.some((n) => n.includes('no schedule'))).toBe(true);
  });
});

describe('REDCap data dictionary', () => {
  it('converts forms, sections, field types and branching logic', () => {
    const { translator, spec, notes } = translateValid('redcap/SleepStudy_DataDictionary.csv');
    expect(translator).toBe(redcapTranslator);
    expect(spec.surveys.map((s) => s['Survey.Name'])).toEqual(['enrollment', 'sleep_diary']);
    const diary = spec.surveys[1]!.questions!;
    const f = (id: string) => diary.find((q) => q['Item.ID'] === id)!;
    expect(f('wake_reasons')['Question.Type.Display.Name']).toBe('Multiple Select');
    expect(f('wake_reasons')['Conditional.Info']?.['Conditional.Master.Item.ID']).toBe('woke_up');
    expect(f('woke_up')['Conditional.Info']?.['Conditional.Child.Mappings']).toEqual([
      { 'Conditional.Child.Item.ID': 'wake_reasons', Definition: 'Yes' },
    ]);
    expect(f('wake_other')['Conditional.Info']?.['Conditional.Master.Item.ID']).toBe('wake_reasons');
    expect(f('late_caffeine')['Question.Description']).toContain('Branching logic:');
    expect(f('sleep_quality').responseKey).toEqual([
      { value: '0', definition: 'Very poorly' },
      { value: '100', definition: 'Very well' },
    ]);
    expect(notes.some((n) => n.includes('sleep_score (calc)'))).toBe(true);
  });

  it('parses simple branching logic and rejects complex logic', () => {
    expect(parseBranching("[a] = '1'")).toEqual({ field: 'a', op: '1', values: ['1'] });
    expect(parseBranching("[a] = '1' or [a] = '2'")).toEqual({ field: 'a', op: '1', values: ['1', '2'] });
    expect(parseBranching("[cb(3)] = '1'")).toEqual({ field: 'cb', op: '1', values: ['3'] });
    expect(parseBranching("[a] > 5")).toEqual({ field: 'a', op: '5', values: ['5'] });
    expect(parseBranching("[a] = '1' and [b] = '2'")).toBeNull();
    expect(parseBranching("[a] = '1' or [b] = '2'")).toBeNull();
  });
});
