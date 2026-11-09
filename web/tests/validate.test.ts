import { describe, expect, it } from 'vitest';
import { parseSpec, validateSpec, checkCrossReferences, type StudySpec } from '../src/core';
import example from './fixtures/minimal-study.json';

const clone = (): StudySpec => structuredClone(example) as StudySpec;

describe('validateSpec', () => {
  it('accepts the minimal example', () => {
    const result = validateSpec(clone());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.spec?.['Study.Metadata']['Study.Name']).toBe('Example Daily Mood Study');
  });

  it('reports schema errors for a missing required field', () => {
    const bad = clone() as Partial<StudySpec>;
    delete bad.surveys;
    const result = validateSpec(bad);
    expect(result.valid).toBe(false);
    expect(result.spec).toBeNull();
    expect(result.issues.some((i) => i.source === 'schema')).toBe(true);
  });

  it('turns invalid JSON into an issue instead of throwing', () => {
    const result = parseSpec('{ not json');
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/Not valid JSON/);
  });
});

describe('checkCrossReferences', () => {
  it('flags a Parent that does not exist', () => {
    const spec = clone();
    spec.surveys[0]!.questions![1]!.Parent = 'block_missing';
    const issues = checkCrossReferences(spec);
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: 'error', path: '/surveys/0/questions/1/Parent' }),
    );
  });

  it('flags a conditional child that does not exist', () => {
    const spec = clone();
    spec.surveys[0]!.questions![2]!['Conditional.Info']!['Conditional.Child.Mappings']![0]!['Conditional.Child.Item.ID'] = 'nope';
    const issues = checkCrossReferences(spec);
    expect(issues.map((i) => i.path)).toContain(
      '/surveys/0/questions/2/Conditional.Info/Conditional.Child.Mappings/0/Conditional.Child.Item.ID',
    );
  });

  it('flags a schedule event pointing at an unknown survey', () => {
    const spec = clone();
    spec.schedules[0]!.events[0]!.extensions!['Survey.Name'] = 'morning';
    const issues = checkCrossReferences(spec);
    expect(issues.map((i) => i.path)).toContain('/schedules/0/events/0/extensions/Survey.Name');
  });

  it('flags duplicate Item.IDs within a survey', () => {
    const spec = clone();
    spec.surveys[0]!.questions![2]!['Item.ID'] = 'item_stress';
    const issues = checkCrossReferences(spec);
    expect(issues.some((i) => i.message.includes('Duplicate Item.ID'))).toBe(true);
  });

  it('flags blockMap entries that do not match a survey item', () => {
    const spec = clone();
    spec.blockMap[1]!['Item.ID'] = 'ghost';
    const issues = checkCrossReferences(spec);
    expect(issues.map((i) => i.path)).toContain('/blockMap/1/Item.ID');
  });
});
