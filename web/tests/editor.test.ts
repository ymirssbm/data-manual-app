import { describe, expect, it } from 'vitest';
import { buildSurveyModel, validateSpec, type StudySpec } from '../src/core';
import { addItem, deleteItem, getSkipRule, moveItem, setBlock, setSkipRule } from '../src/editor/edit';
import { withSurveyReplaced } from '../src/exporters';
import branching from '../../examples/branching-ema-study.json';

const evening = () => (validateSpec(structuredClone(branching)).spec as StudySpec).surveys.find((s) => s['Survey.Name'] === 'evening')!;
const ids = (s: ReturnType<typeof evening>) => (s.questions ?? []).map((q) => q['Item.ID']);

describe('survey editor operations', () => {
  it('reads skip rules: options and thresholds', () => {
    expect(getSkipRule(evening(), 'ev_alc_drinks')).toEqual({ parentId: 'ev_substances', kind: 'in', values: ['1'] });
    expect(getSkipRule(evening(), 'ev_mood')).toBeNull();
  });

  it('sets, changes and clears a skip rule', () => {
    let s = setSkipRule(evening(), 'ev_craving', { parentId: 'ev_mood', kind: 'cmp', op: '<=', value: '30' });
    expect(getSkipRule(s, 'ev_craving')).toEqual({ parentId: 'ev_mood', kind: 'cmp', op: '<=', value: '30' });
    s = setSkipRule(s, 'ev_alc_drinks', { parentId: 'ev_substances', kind: 'in', values: ['1', '2'] });
    expect(getSkipRule(s, 'ev_alc_drinks')).toEqual({ parentId: 'ev_substances', kind: 'in', values: ['1', '2'] });
    s = setSkipRule(s, 'ev_alc_drinks', null);
    expect(getSkipRule(s, 'ev_alc_drinks')).toBeNull();
    expect(buildSurveyModel(s).branchesTo.get('ev_alc_drinks')).toBeUndefined();
  });

  it('adds, moves, re-blocks and deletes items, keeping block members after their block', () => {
    let s = evening();
    const added = addItem(s, 'question', { afterId: 'ev_stress' });
    s = added.survey;
    expect(ids(s).indexOf(added.itemId)).toBe(ids(s).indexOf('ev_stress') + 1);
    expect(s.questions!.find((q) => q['Item.ID'] === added.itemId)!.Parent).toBe('ev_b_mood');
    s = moveItem(s, 'ev_b_mood', 1); // the whole Mood block moves below ev_used
    expect(ids(s).slice(0, 2)).toEqual(['ev_used', 'ev_b_mood']);
    s = setBlock(s, 'ev_craving', 'ev_b_mood');
    expect(ids(s).indexOf('ev_craving')).toBeLessThan(ids(s).indexOf('ev_b_use'));
    s = deleteItem(s, 'ev_b_use');
    expect(ids(s)).not.toContain('ev_substances');
    const used = s.questions!.find((q) => q['Item.ID'] === 'ev_used')!;
    expect(used['Conditional.Info']?.['Conditional.Child.Mappings'] ?? []).toEqual([]);
    const spec = validateSpec(structuredClone(branching)).spec as StudySpec;
    const r = validateSpec(withSurveyReplaced(spec, 1, s));
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
