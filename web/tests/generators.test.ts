import { describe, expect, it } from 'vitest';
import { parseCsv, validateSpec, type StudySpec } from '../src/core';
import {
  buildStudySchedule,
  dataDictionaryCsv,
  describeItem,
  expandDates,
  codebookItemKey,
  generateCodebookHtml,
  generateDataDictionary,
  generateFlowchart,
  indexResponses,
} from '../src/generators';
import example from './fixtures/minimal-study.json';

const TITLE_PAGE = { nameOfStudy: true, authors: true, studyMetadata: true, funding: true };

const spec = (): StudySpec => {
  const r = validateSpec(structuredClone(example));
  if (!r.spec) throw new Error('example invalid');
  return r.spec;
};

describe('data dictionary', () => {
  it('uses the prior column layout, keeps blocks as rows, adds Shown.When', () => {
    const rows = generateDataDictionary(spec());
    expect(rows.map((r) => r['Question.ID'])).toEqual(['block_mood', 'stress', 'social', 'who']);
    expect(rows[0]!._isBlock).toBe(true);
    const social = rows.find((r) => r['Question.ID'] === 'social')!;
    expect(social['Response.Text']).toBe('Yes, No');
    expect(social['Response.Range']).toBe('0 - 1');
    expect(social['Result.Type']).toBe('integer');
    expect(rows.find((r) => r['Question.ID'] === 'who')!['Shown.When']).toBe('social is "Yes"');
  });

  it('writes CSV with the prior headers and NA for empty cells', () => {
    const rows = generateDataDictionary(spec());
    const parsed = parseCsv(dataDictionaryCsv(rows));
    expect(parsed[0]).toEqual(['Survey.LongName', 'Question.ID', 'Question.Text', 'Question.Type.Display.Name', 'Result.Type', 'Missingness.Codes', 'Response.Range', 'Response.Text', 'Shown.When']);
    expect(parsed).toHaveLength(rows.length + 1);
    expect(parsed[1]![2]).toBe('NA');
  });
});

describe('flowchart', () => {
  it('draws a decision for the branching question and rejoins the main path', () => {
    const m = generateFlowchart(spec().surveys[0]!);
    expect(m.startsWith('flowchart TD')).toBe(true);
    expect(m).toContain('subgraph');
    // n0 = block, n1 = stress, n2 = social, n3 = who
    expect(m).toContain('n1 --> n2');
    expect(m).toContain('n2 --> n2_d');
    expect(m).toContain('n2_d -->|"Yes"| n3');
    expect(m).toContain('n2_d -->|"Otherwise"| finish');
    expect(m).not.toContain('Slider<br/>'); // question text only by default
    expect(m).toContain('n3 --> finish');
  });
});

describe('schedule', () => {
  it('expands daily recurrence and keeps wall-clock times', () => {
    const s = buildStudySchedule(spec());
    expect(s.events).toHaveLength(1);
    const ev = s.events[0]!;
    expect(ev.occurrences).toHaveLength(14);
    expect(ev.occurrences[0]).toMatchObject({ date: '2026-01-05', startMin: 19 * 60, endMin: 21 * 60 });
    expect(ev.windowText).toBe('7:00 PM – 9:00 PM');
    expect(s.firstDate).toBe('2026-01-05');
    expect(s.lastDate).toBe('2026-01-18');
  });

  it('handles weekly byDay, until and monthly rules', () => {
    // 2026-01-05 is a Monday.
    expect(expandDates('2026-01-05', { frequency: 'WEEKLY', byDay: ['MO', 'TH'], count: 4 }).dates).toEqual([
      '2026-01-05', '2026-01-08', '2026-01-12', '2026-01-15',
    ]);
    expect(expandDates('2026-01-05', { frequency: 'DAILY', interval: 2, until: '2026-01-11' }).dates).toEqual([
      '2026-01-05', '2026-01-07', '2026-01-09', '2026-01-11',
    ]);
    expect(expandDates('2026-01-31', { frequency: 'MONTHLY', byMonthDay: [-1], count: 3 }).dates).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31',
    ]);
  });
});

describe('descriptives', () => {
  it('computes frequencies and missingness from the data block', () => {
    const s = spec();
    const idx = indexResponses(s);
    const social = s.surveys[0]!.questions!.find((q) => q['Question.ID'] === 'social')!;
    const d = describeItem(social, idx.get('social'))!;
    expect(d.delivered).toBe(84);
    expect(d.answered + d.missing).toBe(84);
    expect(d.frequencies!.map((f) => f.label)).toEqual(['Yes', 'No']);
    expect(d.missingness!.icc).not.toBeNull();
    expect(d.missingness!.icc!).toBeGreaterThanOrEqual(0);
    expect(d.missingness!.icc!).toBeLessThanOrEqual(1);
    const stress = s.surveys[0]!.questions!.find((q) => q['Question.ID'] === 'stress')!;
    expect(describeItem(stress, idx.get('stress'))!.numeric!.n).toBeGreaterThan(50);
  });
});

describe('codebook', () => {
  it('can switch off single parts of the missingness, histogram and participation pages', () => {
    const full = generateCodebookHtml(spec());
    expect(full).toContain('Answered / Delivered');
    expect(full).toContain('Missingness ICC');
    const trimmed = generateCodebookHtml(spec(), { missParticipants: false, missIcc: false, missNote: false, partTimeline: false });
    expect(trimmed).toContain('Answered / Delivered');
    expect(trimmed).not.toContain('<span class="cb-stat-l">Participants</span>');
    expect(trimmed).not.toContain('Missingness ICC</span>');
    expect(trimmed).not.toContain('ICC(1) of answered');
    expect(full).toContain('cb-chart-h">Surveys by day');
    expect(trimmed).not.toContain('cb-chart-h">Surveys by day');
    expect(trimmed).toContain('cb-chart-h">Enrollment over time');
    // No parts left means no tab at all.
    const none = generateCodebookHtml(spec(), { missAnswered: false, missMissing: false, missParticipants: false, missIcc: false, missPerPerson: false });
    expect(none).not.toContain('Missingness Descriptives');
  });

  it('tags each part with the option that controls it, for the preview highlight', () => {
    const html = generateCodebookHtml(spec());
    expect(html).toContain('data-cb-opt="missParticipants"');
    expect(html).toMatch(/class="cb-tab[^"]*" data-tab="[^"]+-missingness"[^>]*data-cb-opt="missingness /);
    expect(html).toContain('data-cb-opt="type-multiple-choice item:');
  });

  it('can leave out the table of contents and chosen variables', () => {
    const sp = spec();
    expect(generateCodebookHtml(sp)).toContain('id="TOC"');
    expect(generateCodebookHtml(sp, { toc: false })).not.toContain('id="TOC"');
    const survey = sp.surveys[0]!;
    const items = (survey.questions ?? []).filter((q) => q['Item.Type'] === 'Question');
    const first = items[0]!;
    const key = codebookItemKey(survey['Survey.Name'], first['Item.ID']);
    const html = generateCodebookHtml(sp, {}, { excludeItems: [key] });
    expect(html).not.toContain(`item:${encodeURIComponent(key)}"`);
    expect(html).toContain(`item:${encodeURIComponent(codebookItemKey(survey['Survey.Name'], items[1]!['Item.ID']))}"`);
    // Leaving out every variable of a survey leaves out the survey.
    const none = generateCodebookHtml(sp, {}, { excludeItems: items.map((q) => codebookItemKey(survey['Survey.Name'], q['Item.ID'])) });
    expect(none).not.toContain('class="cb-survey-name"');
  });

  it('keeps the prior codebook structure', () => {
    const html = generateCodebookHtml(spec(), TITLE_PAGE, { generatedAt: new Date('2026-01-01') });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    for (const s of ['Title Page', 'Name of study', 'Abstract Page', 'Executive Summary', 'Study Schedule', 'Variable List', 'Codebook Generated 2026-01-01',
      'header-shading', '[item_stress]', 'cb-q-head', 'cb-q-meta', 'Frequency Table', 'Barplot', 'Missingness Descriptives',
      'Answered / Delivered', 'Shown only if', 'cb-numstats', 'cb-block-head', 'Data Collection Period:', 'id="backToTopBtn"']) {
      expect(html, s).toContain(s);
    }
  });

  it('defaults to the classic look and applies colour themes', () => {
    expect(generateCodebookHtml(spec())).toContain('--cb-bg:#003d7a');
    const custom = generateCodebookHtml(spec(), {}, { theme: { accent: '#ff0066', fontSize: 18, expandVisuals: true } });
    expect(custom).toContain('--cb-accent:#ff0066');
    expect(custom).toContain('--cb-size:18px');
    expect(custom).not.toMatch(/class="cb-visuals" hidden/);
    const bad = generateCodebookHtml(spec(), {}, { theme: { accent: 'red;}</style><script>' } });
    expect(bad).not.toContain('</style><script>');
  });

  it('has a sections menu, a collapsible TOC and collapsible sections', () => {
    const html = generateCodebookHtml(spec(), TITLE_PAGE);
    expect(html).toContain('class="cb-menu-btn"');
    expect(html).toContain('class="cb-toc-toggle"');
    expect(html).toContain('class="cb-twisty"');
    expect(html).toContain('class="cb-sec-toggle"');
    expect(html).toContain('a[href^="#"]');
  });

  it('respects options and metadata overrides', () => {
    const html = generateCodebookHtml(spec(), { studySchedule: false, abstract: false, dataTypes: ['Slider', 'Block'] }, {}, { title: 'Custom title' });
    expect(html).not.toContain('Study Schedule</h1>');
    expect(html).not.toContain('Abstract Page');
    expect(html).toContain('<h1 class="title">Custom title</h1>');
    expect(html).toContain('[item_stress]');
    expect(html).not.toContain('[item_social]');
  });

  it('nests the table of contents', () => {
    const html = generateCodebookHtml(spec(), TITLE_PAGE);
    const toc = html.slice(html.indexOf('id="cb-toc-body"'), html.indexOf('</nav>', html.indexOf('id="cb-toc-body"')));
    expect((toc.match(/<ul[ >]/g) ?? []).length).toBe((toc.match(/<\/ul>/g) ?? []).length);
    expect((toc.match(/<li[ >]/g) ?? []).length).toBe((toc.match(/<\/li>/g) ?? []).length);
    expect(toc.indexOf('Title Page')).toBeLessThan(toc.indexOf('Name of study'));
  });
});

describe('codebook defaults', () => {
  it('leaves out the title page and never prints authors under the title', () => {
    const html = generateCodebookHtml(spec());
    expect(html).not.toContain('Title Page');
    expect(html).not.toContain('class="author"');
  });
});
