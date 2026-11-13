import { describe, expect, it } from 'vitest';
import { parseCsv, validateSpec, type StudySpec } from '../src/core';
import {
  buildStudySchedule,
  dataDictionaryCsv,
  describeItem,
  enrollment,
  surveyTimeline,
  expandDates,
  codebookItemKey,
  flowchartQuestionNodes,
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
  it('maps each question to the node it is drawn as, for click-to-inspect', () => {
    const survey = spec().surveys[0]!;
    const nodes = flowchartQuestionNodes(survey);
    const code = generateFlowchart(survey);
    expect(nodes.length).toBe((survey.questions ?? []).filter((q) => q['Item.Type'] === 'Question').length);
    const lines = code.split('\n').map((l) => l.trim());
    for (const n of nodes) expect(lines.some((l) => l.startsWith(`${n.nodeId}[`))).toBe(true);
  });

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
  it('gives each participant a first-to-last span with compliance, and counts each burst from its own day 1', () => {
    // P1: answers on Jan 1, misses Jan 2, answers Jan 3, then a second burst from Jan 20 (answered twice).
    // P2: answers both of its prompts.
    const rows: Array<[string, string, string]> = [
      ['P1', '2026-01-01', '3'], ['P1', '2026-01-02', ''], ['P1', '2026-01-03', '4'],
      ['P1', '2026-01-20', '2'], ['P1', '2026-01-21', '5'],
      ['P2', '2026-01-05', '1'], ['P2', '2026-01-06', '2'],
    ];
    const s = { ...spec(), data: {
      'Participant.ID': rows.map((r) => r[0]),
      'Session.ID': rows.map((_, i) => `s${i}`),
      'Survey.Date.Completed': rows.map((r) => `${r[1]}T09:00:00Z`),
      'Question.ID': rows.map(() => 'mood'),
      'User.Response': rows.map((r) => r[2]),
    } } as unknown as StudySpec;
    const e = enrollment(s);
    expect(e.map((p) => [p.participant, p.date, p.last])).toEqual([['P1', '2026-01-01', '2026-01-21'], ['P2', '2026-01-05', '2026-01-06']]);
    expect(e[0]!.compliance).toBeCloseTo(4 / 5);
    expect(e[1]!.compliance).toBe(1);
    const tl = surveyTimeline(s)!;
    expect(tl.bursts).toBe(2);
    // Burst 1: P1 on its days 0 and 2, P2 on days 0 and 1. Burst 2: P1 on days 0 and 1.
    expect(tl.perBurstDay[0]).toEqual([2, 1, 1]);
    expect(tl.perBurstDay[1]).toEqual([1, 1]);
    const html = generateCodebookHtml(s);
    expect(html).toContain('class="cb-span"');
    expect(html).toContain('Surveys by day of each burst');
    expect(html).toContain('class="cb-burst-key"');
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
    for (const s of ['Title Page', 'cb-study-name', '>Abstract<', 'Executive Summary', 'Study Schedule', 'Variable List', 'Codebook Generated 2026-01-01',
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
    expect(toc.indexOf('Title Page')).toBeLessThan(toc.indexOf('Study Metadata'));
  });
});

describe('codebook extras', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  it('adds the logo, the researcher’s sections where asked, and attached documents', () => {
    const html = generateCodebookHtml(spec(), {}, {
      logo: PNG,
      customSections: [
        { id: 'a', title: 'Study setup', text: 'Phones were\nhanded out.', after: 'titlePage', media: [{ kind: 'image', src: PNG, name: 'setup.png', caption: 'The kit' }] },
        { id: 'b', title: 'Training video', text: '', after: 'variableList', media: [{ kind: 'video', src: 'https://youtu.be/abcdefgh123', name: 'v', caption: 'Training' }] },
        // After another of the researcher's sections, and after a section that isn't shown (no funding text).
        { id: 'c', title: 'Kit checklist', text: 'Charger, case.', after: 'section:a', media: [] },
        { id: 'd', title: 'Budget notes', text: 'Notes.', after: 'funding', media: [] },
      ],
      attachments: [{ name: 'protocol.txt', mediaType: 'text/plain', size: 2048, href: 'data:text/plain;base64,aGk=', text: 'Protocol text here' }],
    });
    expect(html).toContain('class="cb-logo"');
    const order = ['>Title Page<', '>Study setup<', '>Kit checklist<', '>Abstract<', '>Executive Summary<', '>Budget notes<', '>Variable List<', '>Training video<', '>Attached Documents<'].map((h) => html.indexOf(h));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('Phones were<br>handed out.');
    expect(html).toContain('youtube-nocookie.com/embed/abcdefgh123');
    expect(html).toContain('download="protocol.txt"');
    expect(html).toContain('Protocol text here');
    // Only data: and https sources are used.
    const bad = generateCodebookHtml(spec(), {}, { logo: 'javascript:alert(1)', customSections: [{ id: 'x', title: 'X', text: '', after: 'variableList', media: [{ kind: 'image', src: 'javascript:x', name: '', caption: '' }] }] });
    expect(bad).not.toContain('javascript:');
  });

  it('shows only uploaded screenshots, and marks made-up ones as a demonstration', () => {
    const sp = spec();
    const q = sp.surveys[0]!.questions!.find((x) => x['Item.Type'] === 'Question')!;
    const key = codebookItemKey(sp.surveys[0]!['Survey.Name'], q['Item.ID']);
    const html = generateCodebookHtml(sp, {}, { screenshots: { [key]: PNG } });
    expect(html).toContain(`src="${PNG}"`);
    expect(html.match(/class="cb-screenshot"/g)?.length).toBe(1);
    expect(html).not.toContain('made-up screenshot');
    expect(generateCodebookHtml(sp)).not.toContain('class="cb-screenshot"');
    const demo = generateCodebookHtml(sp, {}, { screenshots: { [key]: PNG }, demoScreenshots: [key] });
    expect(demo).toContain('This is a made-up screenshot, shown as a demonstration.');
  });
});

describe('codebook defaults', () => {
  it('starts with the study name and authors, without a "Name of study" heading', () => {
    const html = generateCodebookHtml(spec());
    expect(html).toContain('Title Page');
    expect(html).toContain('class="cb-study-name"');
    expect(html).not.toContain('Name of study');
    expect(html).not.toContain('class="author"');
  });

  it('gives funding and contact their own sections, and links the summary to each survey', () => {
    const sp = spec();
    const html = generateCodebookHtml(sp, { funding: true, contact: true }, {}, { funding: 'NIH R01', contact: 'Jane Smith\njane@uni.edu' });
    expect(html).toMatch(/<h1 id="[^"]+">Funding/);
    expect(html).toContain('jane@uni.edu');
    expect(html).toMatch(/<h1 id="[^"]+">Contact/);
    expect(html).toContain('Jane Smith<br>jane@uni.edu');
    const first = sp.surveys[0]!['Survey.Name'];
    const anchor = html.match(new RegExp(`<a href="#(survey-[^"]+)">`))?.[1];
    expect(anchor).toBeTruthy();
    expect(html).toContain(`<section class="cb-survey" id="${anchor}">`);
    expect(first).toBeTruthy();
    expect(html).toMatch(/<h1 id="[^"]+">Study Adherence/);
  });
});
