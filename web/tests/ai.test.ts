import { describe, expect, it, vi } from 'vitest';
import { validateSpec, type StudySpec } from '../src/core';
import example from './fixtures/minimal-study.json';
import branching from '../../examples/branching-ema-study.json';
import { generateFlowchart } from '../src/generators';

vi.mock('../src/ai/providers', async (orig) => {
  const real = await orig<typeof import('../src/ai/providers')>();
  return { ...real, callModel: vi.fn() };
});
const { callModel } = await import('../src/ai/providers');
const { extractSpecJson, replyProse, runStudyAi, specForPrompt } = await import('../src/ai/studyAi');

const config = { provider: 'anthropic' as const, apiKey: 'k', model: 'claude-opus-5-5', effort: 'medium' as const, baseUrl: '', useRelay: true };
const spec = () => validateSpec(structuredClone(example)).spec as StudySpec;

describe('AI response handling', () => {
  it('extracts the spec from a fenced block and strips it from the prose', () => {
    const reply = 'Added a question.\n```json\n{"a": 1}\n```';
    expect(extractSpecJson(reply)).toEqual({ a: 1 });
    expect(replyProse(reply)).toBe('Added a question.');
    expect(extractSpecJson('no json here')).toBeNull();
  });

  it('never sends response data to the model', () => {
    expect(specForPrompt(spec())).not.toContain('User.Response');
  });

  it('validates, repairs once, keeps the data, and records AI provenance', async () => {
    const good = spec();
    const { data: _d, blockMap: _b, ...noData } = good as StudySpec & Record<string, unknown>;
    void _d;
    void _b;
    const broken = structuredClone(noData) as Record<string, unknown>;
    (broken.surveys as Array<{ questions: Array<Record<string, unknown>> }>)[0]!.questions[1]!.Parent = 'nope';
    vi.mocked(callModel)
      .mockResolvedValueOnce('Here you go.\n```json\n' + JSON.stringify(broken) + '\n```')
      .mockResolvedValueOnce('Fixed.\n```json\n' + JSON.stringify(noData) + '\n```');
    const out = await runStudyAi({ config, history: [], prompt: 'add a question', base: good });
    expect(out.repairs).toBe(1);
    expect(out.result?.valid).toBe(true);
    expect(out.result?.spec?.data?.['Question.ID']?.length).toBe(good.data!['Question.ID']!.length);
    expect(out.result?.spec?.['AI.Information']?.['AI.Modification.Prompts']).toEqual(['add a question']);
    const repairTurn = vi.mocked(callModel).mock.calls[1]![2].at(-1)!.content;
    expect(repairTurn).toContain('failed validation');
  });
});

describe('branching example', () => {
  it('is valid and every survey with skip logic produces a flowchart with decisions', () => {
    const r = validateSpec(structuredClone(branching));
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const branchingSurveys = r.spec!.surveys.filter((s) => (s.questions ?? []).some((q) => q['Conditional.Info']));
    expect(branchingSurveys.map((s) => s['Survey.Name'])).toEqual(['morning', 'evening', 'weekly']);
    for (const s of branchingSurveys) {
      const m = generateFlowchart(s);
      expect(m, s['Survey.Name']).toMatch(/_d\{/);
    }
  });
});

describe('folding flowchart blocks', () => {
  it('draws a folded block as one node and reroutes its edges', async () => {
    const { flowchartBlocks } = await import('../src/generators');
    const evening = validateSpec(structuredClone(branching)).spec!.surveys.find((s) => s['Survey.Name'] === 'evening')!;
    const use = flowchartBlocks(evening).find((b) => b.itemId === 'ev_b_use')!;
    expect(use.questions).toBe(10);
    const open = generateFlowchart(evening);
    const folded = generateFlowchart(evening, { collapsed: ['ev_b_use'] });
    expect(open).toContain(`subgraph ${use.clusterId}`);
    expect(folded).not.toContain(`subgraph ${use.clusterId}`);
    expect(folded).toContain(`${use.collapsedId}[["▸ Substance use details<br/>10 questions"]]`);
    expect(folded).toContain(`-->|"Yes"| ${use.collapsedId}`);
    expect(folded).toMatch(new RegExp(`${use.collapsedId} --> n[0-9]+`));
    expect(folded).not.toMatch(new RegExp(`${use.collapsedId} --> ${use.collapsedId}`));
    expect(folded).toContain('How strong were your cravings');
  });
});

describe('linear multi-select branching and text outline', () => {
  const evening = () => validateSpec(structuredClone(branching)).spec!.surveys.find((s) => s['Survey.Name'] === 'evening')!;

  it('chains multi-select options as yes/no checks that flow downward', async () => {
    const m = generateFlowchart(evening());
    // ev_substances is n5: four checks, each "No" leading to the next, the last to what follows the options.
    for (const k of [0, 1, 2, 3]) expect(m).toContain(`n5_d${k}{`);
    expect(m).toContain('n5 --> n5_d0');
    expect(m).toContain('n5_d0 -->|"No"| n5_d1');
    expect(m).toContain('n5_d0 -->|"Yes"| n6'); // Alcohol -> drinks
    // After the drinks follow-up, flow resumes at the next check (Cannabis?), not past it.
    expect(m).toContain('n6 --> n5_d1');
    // The edible follow-up (nested under cannabis method) resumes at the tobacco check.
    expect(m).toContain('n8 --> n5_d2');
    expect(m).toContain('n19 --> n17_d1'); // ev_sponsor_help resumes at the coping chain's next check
    expect(m).toContain('n7_d -->|"Otherwise"| n5_d2');
    // Diamonds are declared inside the block that holds their question.
    const block = m.slice(m.indexOf('subgraph n4_g'), m.indexOf('end', m.indexOf('subgraph n4_g')));
    expect(block).toContain('n5_d0{');
  });

  it('writes an indented text outline', async () => {
    const { flowchartText } = await import('../src/generators');
    const t = flowchartText(evening());
    expect(t).toContain('  ev_used: Did you use any alcohol or drugs today? [Multiple Choice]');
    expect(t).toContain('    IF ev_used is "Yes":');
    expect(t).toContain('      Block: Substance use details');
    expect(t).toContain('          IF ev_substances includes "Alcohol":');
    expect(t).toMatch(/\n {12}ev_alc_drinks: How many standard drinks/);
    expect(t).toMatch(/\n {14}IF ev_can_method is "Edible":\n {16}ev_edible_mg/);
  });
});
