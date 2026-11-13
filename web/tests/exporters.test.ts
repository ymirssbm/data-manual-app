import { describe, expect, it } from 'vitest';
import { buildSurveyModel, isBlock, validateSpec, type StudySpec } from '../src/core';
import { exportStudy, surveyJsPageToSurvey, surveyToSurveyJsPage } from '../src/exporters';
import { qualtricsTranslator, redcapTranslator } from '../src/translators';
import { codebookOptions } from '../src/mcp/tools';
import branching from '../../examples/branching-ema-study.json';

const spec = () => validateSpec(structuredClone(branching)).spec as StudySpec;
const questionCount = (s: StudySpec['surveys'][number]) => (s.questions ?? []).filter((q) => !isBlock(q) && q['Question.Type.Display.Name'] !== 'End Block').length;

describe('exporters round-trip through the importers', () => {
  it('REDCap data dictionary: every question, one instrument per survey, branching logic kept', () => {
    const out = exportStudy(spec(), 'redcap');
    expect(out.text.split('\r\n')[0]).toContain('Branching Logic (Show field only if...)');
    expect(out.text).toContain("[ev_used] = '1'".replace("'1'", '1'));
    expect(out.text).toContain("[ev_substances(1)] = '1'");
    const back = validateSpec(redcapTranslator.translate({ fileName: out.fileName, text: out.text }).spec);
    expect(back.spec, JSON.stringify(back.issues.slice(0, 3))).toBeTruthy();
    const total = (s: StudySpec) => s.surveys.reduce((n, x) => n + questionCount(x), 0);
    expect(total(back.spec!)).toBe(total(spec()) + 1); // + record_id
    const ev = back.spec!.surveys.find((s) => s['Survey.Name'] === 'evening')!;
    const m = buildSurveyModel(ev);
    expect(m.branchesTo.get('ev_alc_drinks')?.[0]?.parentId).toBe('ev_substances');
  });

  it('Qualtrics .qsf: questions, blocks and display logic', () => {
    const out = exportStudy(spec(), 'qualtrics', { survey: 'evening' });
    const qsf = JSON.parse(out.text);
    expect(qsf.SurveyElements.filter((e: { Element: string }) => e.Element === 'SQ')).toHaveLength(19);
    const back = validateSpec(qualtricsTranslator.translate({ fileName: out.fileName, text: out.text }).spec);
    expect(back.spec, JSON.stringify(back.issues.slice(0, 3))).toBeTruthy();
    const ev = back.spec!.surveys[0]!;
    expect(questionCount(ev)).toBe(19);
    const m = buildSurveyModel(ev);
    const parentOf = (exportTag: string) => {
      const q = ev.questions!.find((x) => x['Question.ID'] === exportTag)!;
      return ev.questions!.find((x) => x['Item.ID'] === m.branchesTo.get(q['Item.ID'])?.[0]?.parentId)?.['Question.ID'];
    };
    expect(parentOf('ev_alc_drinks')).toBe('ev_substances');
    expect(parentOf('ev_edible_mg')).toBe('ev_can_method');
  });

  it('SurveyJS: panels for blocks, visibleIf for skip logic, and back again', () => {
    const s = spec();
    const evening = s.surveys.find((x) => x['Survey.Name'] === 'evening')!;
    const page = surveyToSurveyJsPage(evening) as { elements: Array<Record<string, unknown>> };
    const flat = JSON.stringify(page);
    expect(flat).toContain('"type":"panel"');
    expect(flat).toContain('{ev_substances} contains 1');
    expect(flat).toContain('{ev_used} = 1');
    const back = surveyJsPageToSurvey(page, evening);
    const strip = (x: typeof evening) => (x.questions ?? []).filter((q) => q['Question.Type.Display.Name'] !== 'End Block').map((q) => [q['Item.ID'], q['Item.Type'], q.Parent ?? null, q['Question.Type.Display.Name']]);
    expect(strip(back)).toEqual(strip(evening));
    expect(back.questions!.find((q) => q['Item.ID'] === 'ev_alc_drinks')!['Conditional.Info']).toEqual(evening.questions!.find((q) => q['Item.ID'] === 'ev_alc_drinks')!['Conditional.Info']);
  });

  it('response data as long and wide CSV', () => {
    const s = spec();
    const long = exportStudy(s, 'data-long').text.trim().split('\r\n');
    expect(long).toHaveLength(s.data!['Question.ID']!.length + 1);
    const wide = exportStudy(s, 'data-wide').text.trim().split('\r\n');
    expect(wide[0]).toMatch(/^participant,session,completed,survey,mo_sleep_hours/);
    expect(wide.length).toBeGreaterThan(200 * 40);
  });
});

describe('MCP codebook options', () => {
  it('maps include/exclude section names onto generator options', () => {
    const o = codebookOptions(['Title Page'], ['Variable Pages', 'Slider']);
    expect(o.nameOfStudy && o.authors).toBe(true);
    expect(o.histograms || o.skipLogic).toBe(false);
    expect(o.dataTypes).not.toContain('Slider');
    expect(codebookOptions([], ['Title Page']).nameOfStudy).toBe(false);
  });
});
