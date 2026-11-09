import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachData, datasetToData, guessMapping, inferSpecFromData, parseCsvObjects, parseDataset, toIsoDateTime, validateSpec, type StudySpec } from '../src/core';
import { describeItem, generateCodebookHtml, indexResponses } from '../src/generators';
import { qualtricsResponsesToData, qualtricsToSpec } from '../src/translators/qualtrics';
import { redcapDictionaryToSpec, redcapRecordsToData } from '../src/translators/redcap';

const ex = (p: string) => readFileSync(resolve(__dirname, 'fixtures', p), 'utf8');
const errors = (spec: unknown) => validateSpec(spec).issues.filter((i) => i.severity === 'error');

describe('timestamps', () => {
  it('reads ISO, US-style and epoch times', () => {
    expect(toIsoDateTime('2/3/2026 9:14 PM', 'America/New_York')).toBe('2026-02-03T21:14:00-05:00');
    expect(toIsoDateTime('2026-07-01 08:00:00', 'America/New_York')).toBe('2026-07-01T08:00:00-04:00');
    expect(toIsoDateTime('12/31/25 12:05 AM')).toBe('2025-12-31T00:05:00Z');
    expect(toIsoDateTime('1767225600')).toBe('2026-01-01T00:00:00Z');
    expect(toIsoDateTime('soon')).toBeNull();
  });
});

describe('bring your own dataset', () => {
  const table = parseDataset(ex('datasets/ema_long_example.csv'));

  it('guesses a long layout and the right columns', () => {
    const m = guessMapping(table);
    expect(m).toMatchObject({ layout: 'long', participant: 'pid', time: 'prompt_time', survey: 'survey', question: 'item', response: 'value' });
  });

  it('turns rows into spec data with missing codes, and infers a valid study', () => {
    const m = { ...guessMapping(table), timeZone: 'America/New_York', missingCodes: ['-99'] };
    const result = datasetToData(table, m);
    expect(result.variables.sort()).toEqual(['drinks', 'happy', 'sleep_hours', 'stress', 'with_others']);
    expect((result.data['User.Response'] as string[]).includes('-99')).toBe(false);
    expect((result.data['Survey.Date.Completed'] as string[])[0]).toMatch(/^2026-02-02T\d\d:\d\d:00-05:00$/);
    const spec = inferSpecFromData(result, 'EMA upload');
    expect(errors(spec)).toEqual([]);
    expect(spec.surveys.map((s) => s['Survey.Name']).sort()).toEqual(['evening', 'morning']);
    const happy = spec.surveys.flatMap((s) => s.questions!).find((q) => q['Question.ID'] === 'happy')!;
    expect(happy['Question.Type.Display.Name']).toBe('Multiple Choice');
    expect(spec.surveys.flatMap((s) => s.questions!).find((q) => q['Question.ID'] === 'stress')!['Question.Type.Display.Name']).toBe('Slider');
  });

  it('reads a wide layout', () => {
    const wide = parseDataset('id,when,mood,steps\nA,2026-01-01 09:00,4,1200\nA,2026-01-02 09:00,,900\nB,2026-01-01 10:00,2,4000\n');
    const m = guessMapping(wide);
    expect(m.layout).toBe('wide');
    const r = datasetToData(wide, m);
    expect(r.data['Question.ID']).toEqual(['mood', 'steps', 'mood', 'steps', 'mood', 'steps']);
    expect(r.data['User.Response']).toEqual(['4', '1200', '', '900', '2', '4000']);
  });

  it('attaches data to a loaded study and reports mismatches', () => {
    const spec = validateSpec(JSON.parse(ex('minimal-study.json'))).spec!;
    const table2 = parseDataset('participant,completed,stress,social,mystery\nP1,2026-01-05 19:30,40,1,7\n');
    const { spec: out, report } = attachData(spec, datasetToData(table2, guessMapping(table2)).data);
    expect(report.matched.sort()).toEqual(['social', 'stress']);
    expect(report.unmatchedInData).toEqual(['mystery']);
    expect(report.questionsWithoutData).toEqual(['who']);
    expect(errors(out)).toEqual([]);
  });
});

describe('REDCap records', () => {
  it('converts raw records into data for the dictionary-built study', () => {
    const { spec } = redcapDictionaryToSpec(parseCsvObjects(ex('redcap/SleepStudy_DataDictionary.csv')), 'Sleep Study');
    const s = spec as unknown as StudySpec;
    const { data, notes } = redcapRecordsToData(parseCsvObjects(ex('redcap/SleepStudy_records.csv')), s, { timeZone: 'America/New_York' });
    s.data = data as unknown as StudySpec['data'];
    expect(errors(s)).toEqual([]);
    const q = data['Question.ID'] as string[];
    const v = data['User.Response'] as string[];
    expect(q).toContain('sleep_quality');
    expect(q).toContain('age');
    const reasons = v.filter((_, i) => q[i] === 'wake_reasons' && v[i] !== '');
    expect(reasons.every((x) => /^\d(,\d)*$/.test(x))).toBe(true);
    expect(notes[0]).toMatch(/15 participant/);
  });
});

describe('Qualtrics responses', () => {
  it('converts the response export using export tags and display logic', () => {
    const { spec, survey } = qualtricsToSpec(JSON.parse(ex('qualtrics/wellbeing-survey.qsf')));
    const s = spec as unknown as StudySpec;
    const qids = new Set(s.surveys[0]!.questions!.filter((x) => x['Item.Type'] === 'Question').map((x) => x['Item.ID']));
    const { data } = qualtricsResponsesToData(JSON.parse(ex('qualtrics/wellbeing-responses.json')), survey, qids);
    s.data = data as unknown as StudySpec['data'];
    expect(errors(s)).toEqual([]);
    const q = data['Question.ID'] as string[];
    expect(new Set(q)).toEqual(new Set(['year', 'job', 'job_hours', 'stress_week', 'supports', 'supports_other']));
    const jobs = (data['User.Response'] as string[]).filter((_, i) => q[i] === 'job');
    const hours = q.filter((x) => x === 'job_hours').length;
    expect(hours).toBe(jobs.filter((x) => x === '1').length); // only shown to "Yes"
  });
});

describe('every example has data and the new descriptives', () => {
  it('missingness tiles, response-rate plots and outlier screen render', () => {
    const spec = validateSpec(JSON.parse(ex('ai-generated-ema-study.json'))).spec!;
    expect(spec.data?.['Question.ID']?.length).toBeGreaterThan(500);
    const html = generateCodebookHtml(spec);
    for (const s of ['cb-stats', 'Response rate by participant', 'Outlier screen', 'cb-dot-out']) expect(html, s).toContain(s);
    for (const s of ['Response rate over the study', '<th>z</th>', '<th>Participant</th><th>Value</th>']) expect(html, s).not.toContain(s);
    const off = generateCodebookHtml(spec, { missingnessPlots: false, outlierPlots: false });
    expect(off).not.toContain('Response rate by participant');
    expect(off).not.toContain('Outlier screen');
  });

  it('flags implausible values', () => {
    const spec = validateSpec(JSON.parse(ex('ai-generated-ema-study.json'))).spec!;
    const idx = indexResponses(spec);
    const age = spec.surveys.flatMap((s) => s.questions!).find((q) => q['Question.ID'] === 'age')!;
    const d = describeItem(age, idx.get('age'), 12)!;
    expect(d.outliers!.flagged.every((f) => f.value > d.outliers!.upper || f.value < d.outliers!.lower)).toBe(true);
  });
});

describe('participation plots', () => {
  it('finds rolling enrollment and three measurement bursts in the example', async () => {
    const { enrollment, surveyTimeline, generateCodebookHtml } = await import('../src/generators');
    const { validateSpec } = await import('../src/core');
    const ex = (await import('../../examples/branching-ema-study.json')).default;
    const spec = validateSpec(structuredClone(ex)).spec!;
    const e = enrollment(spec);
    expect(e).toHaveLength(200);
    expect(e[0]!.date < e[199]!.date).toBe(true);
    const tl = surveyTimeline(spec)!;
    expect(tl.bursts).toBe(3);
    expect(tl.maxDay).toBeGreaterThanOrEqual(56);
    const html = generateCodebookHtml(spec);
    for (const s of ['Enrollment over time', 'Surveys by day since first survey', '>Burst<', 'Executive Summary']) expect(html, s).toContain(s);
    expect(generateCodebookHtml(spec, { participationPlots: false })).not.toContain('Enrollment over time');
  });
});
