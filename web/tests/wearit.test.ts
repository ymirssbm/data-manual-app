import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSurveyModel, shownWhen, validateSpec, type StudySpec } from '../src/core';
import { wearitPagesToSpec } from '../src/connectors/wearit/convert';
import { generateCodebookHtml, generateDataDictionary, generateFlowchart, icc1 } from '../src/generators';
import { detectTranslator } from '../src/translators';

const TITLE_PAGE = { nameOfStudy: true, authors: true, studyMetadata: true, funding: true };

const raw = readFileSync(resolve(__dirname, 'fixtures/wearit/sample-getData.json'), 'utf8');

function convert(): { spec: StudySpec; notes: string[] } {
  const { spec, notes } = wearitPagesToSpec(JSON.parse(raw), { studyId: '365' });
  const r = validateSpec(spec);
  expect(r.issues.filter((i) => i.severity === 'error'), JSON.stringify(r.issues.slice(0, 5))).toEqual([]);
  return { spec: r.spec!, notes };
}

describe('Wear-IT getData conversion', () => {
  it('is auto-detected from a saved response', () => {
    expect(detectTranslator({ fileName: 'pull.json', text: raw })?.id).toBe('wearit');
  });

  it('builds surveys, nested blocks, types and response keys', () => {
    const { spec } = convert();
    expect(spec.surveys.map((s) => s['Survey.Name'])).toEqual(['Daily Diary ID 365']);
    const qs = spec.surveys[0]!.questions!;
    const byId = (id: string) => qs.find((q) => q['Item.ID'] === id)!;
    expect(byId('Item 5745')['Item.Type']).toBe('Block');
    expect(byId('Item 5737').Parent).toBe('Item 5745');
    expect(byId('Item 5734')['Question.Type.Display.Name']).toBe('Multiple Select');
    expect(byId('Item 5734')['Data.Type']).toBe('integer');
    expect(byId('Item 5734').responseKey![0]).toEqual({ value: '1', definition: 'Watched TV / looked at social media' });
    expect(byId('Item 5739')['Question.Type.Display.Name']).toBe('Multiple Slider');
    expect(byId('Item 5739')['Question.Description']).toContain('Calm; Stressed; Hopeful');
    expect(byId('Item 5799')['Question.Type.Display.Name']).toBe('End Block');
  });

  it('resolves bare-number conditional IDs to items', () => {
    const { spec } = convert();
    const parent = spec.surveys[0]!.questions!.find((q) => q['Item.ID'] === 'Item 5736')!;
    expect(parent['Conditional.Info']).toMatchObject({
      'Conditional.Child.Mappings': [{ 'Conditional.Child.Item.ID': 'Item 5745', Definition: 'Recovery Community Center (RCC)' }],
      'Conditional.Fail.Item.ID': 'Item 5739',
    });
    const model = buildSurveyModel(spec.surveys[0]!);
    expect(shownWhen(model, 'Item 5737')).toBe('Question 5978 is "Recovery Community Center (RCC)"');
  });

  it('collects responses from every page into long-format data', () => {
    const { spec, notes } = convert();
    const d = spec.data!;
    expect(new Set(d['Participant.ID']).size).toBe(4);
    expect(d['Question.ID']!.length).toBe(d['User.Response']!.length);
    expect(d['Question.ID']!.length).toBeGreaterThan(150);
    expect(d['Question.ID']).toContain('Question 5976');
    expect(notes.some((n) => n.includes('2 page(s)'))).toBe(true);
    expect(notes.some((n) => n.includes('Skipped 1 session'))).toBe(true);
  });

  it('feeds every generator', () => {
    const { spec } = convert();
    const flow = generateFlowchart(spec.surveys[0]!);
    expect(flow).toContain('-->|"Recovery Community<br/>Center (RCC)"|');
    expect(flow).toContain('-->|"Otherwise"|');
    expect(generateDataDictionary(spec).some((r) => r['Question.ID'] === 'Question 5976')).toBe(true);
    const html = generateCodebookHtml(spec, TITLE_PAGE);
    expect(html).toContain('N = ');
    expect(html).toContain('Devices Used:');
    expect(html).toContain('America/New_York');
    // Questions after a block return to survey level in the TOC.
    const toc = html.slice(html.indexOf('id="cb-toc-body"'), html.indexOf('</nav>', html.indexOf('id="cb-toc-body"')));
    const blockList = toc.slice(toc.indexOf('Block: Item 5745'));
    expect(blockList.indexOf('Right now, how are you feeling?')).toBeGreaterThan(blockList.indexOf('</ul>'));
  });
});

describe('icc1', () => {
  it('is 1 when all variance is between groups and 0 when within', () => {
    expect(icc1([[1, 1, 1], [0, 0, 0], [1, 1, 1]])).toBe(1);
    expect(icc1([[1, 0], [1, 0], [1, 0]])).toBe(0);
    expect(icc1([[1]])).toBeNull();
  });
});

describe('toIsoDateTime', () => {
  it('adds the DST-correct offset for the record timezone', async () => {
    const { toIsoDateTime } = await import('../src/connectors/wearit/convert');
    expect(toIsoDateTime('2022-06-02 20:15:00', 'America/New_York')).toBe('2022-06-02T20:15:00-04:00');
    expect(toIsoDateTime('2022-01-02T20:15:00', 'America/New_York')).toBe('2022-01-02T20:15:00-05:00');
    expect(toIsoDateTime('2022-01-02T20:15:00', null)).toBe('2022-01-02T20:15:00Z');
    expect(toIsoDateTime('2022-01-02T20:15:00+0100', 'America/New_York')).toBe('2022-01-02T20:15:00+01:00');
    expect(toIsoDateTime('not a date', 'UTC')).toBeNull();
  });
});
