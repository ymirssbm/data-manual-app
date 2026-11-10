import { describe, expect, it } from 'vitest';
import { parseSpec, validateSpec, checkCrossReferences, type StudySpec } from '../src/core';
import { isRfc3339, toIsoDateTime } from '../src/core/time';
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

  it('still loads a study whose response timestamps are not date-times, with a warning', () => {
    const s = clone() as unknown as { data: Record<string, unknown[]> };
    const n = s.data['Survey.Date.Completed']!.length;
    const times = s.data['Survey.Date.Completed']!.map(() => '2026-02-02 08:11:00');
    times[0] = 'sometime tuesday';
    s.data['Survey.Date.Completed'] = times;
    const result = validateSpec(s);
    expect(result.spec).not.toBeNull();
    expect(result.valid).toBe(true);
    const warn = result.issues.find((i) => i.path === '/data/Survey.Date.Completed')!;
    expect(warn.severity).toBe('warning');
    expect(warn.message).toMatch(/couldn’t be read/);
    const fixed = (result.spec as unknown as { data: Record<string, unknown[]> }).data['Survey.Date.Completed']!;
    expect(fixed[0]).toBe('sometime tuesday');
    if (n > 1) expect(fixed[1]).toBe('2026-02-02T08:11:00Z');
  });
});

describe('toIsoDateTime', () => {
  it('adds missing seconds and the offset colon', () => {
    expect(toIsoDateTime('2026-02-02T08:11-05:00')).toBe('2026-02-02T08:11:00-05:00');
    expect(toIsoDateTime('2026-02-02 08:11:30-0500')).toBe('2026-02-02T08:11:30-05:00');
    expect(isRfc3339(toIsoDateTime('6/2/2022 8:15 PM'))).toBe(true);
    expect(toIsoDateTime('not a date')).toBeNull();
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
