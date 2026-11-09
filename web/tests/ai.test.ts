import { describe, expect, it, vi } from 'vitest';
import { validateSpec, type StudySpec } from '../src/core';
import example from '../../examples/minimal-study.json';
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
  it('is valid and every survey produces a flowchart with decisions', () => {
    const r = validateSpec(structuredClone(branching));
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    for (const s of r.spec!.surveys) {
      const m = generateFlowchart(s);
      expect(m, s['Survey.Name']).toMatch(/_d\{/);
    }
  });
});
