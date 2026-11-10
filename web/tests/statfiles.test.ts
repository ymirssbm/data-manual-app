// Reads SPSS, SAS and Stata files written by R's haven (tests/fixtures/statfiles/make.R).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStatFile } from '../src/core/statfiles';
import { rle } from '../src/core/statfiles/sas7bdat';
import { ibmToDouble } from '../src/core/statfiles/xpt';
import { datasetToData, guessMapping, inferSpecFromData, statFileToTable } from '../src/core';

const dir = resolve(__dirname, 'fixtures/statfiles');
const read = (name: string) => {
  const b = readFileSync(resolve(dir, name));
  return readStatFile(name, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

const FILES = ['study.sav', 'study-plain.sav', 'study.zsav', 'study.rds', 'study-v2.rds', 'study-plain.rds', 'study-v5.xpt', 'study-v8.xpt', 'study.sas7bdat', 'study-14.dta', 'study-13.dta', 'study-12.dta'];
const WITH_VALUE_LABELS = new Set(['study.sav', 'study-plain.sav', 'study.zsav', 'study.rds', 'study-v2.rds', 'study-plain.rds', 'study-14.dta', 'study-13.dta', 'study-12.dta']);

describe('statistical package files', () => {
  for (const name of FILES) {
    it(`reads ${name}`, async () => {
      const f = await read(name);
      expect(f.columns.map((c) => c.toLowerCase())).toEqual(['id', 'mood', 'stress', 'when', 'day', 'note']);
      expect(f.rows).toHaveLength(5);
      const col = (c: string) => f.rows.map((r) => r[f.columns.findIndex((x) => x.toLowerCase() === c)]);
      expect(col('id')).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
      expect(col('mood')).toEqual(['1', '5', '', '3', '2']);
      expect(col('stress')).toEqual(['12.5', '80', '47.25', '', '0.1']);
      expect(col('when')[0]).toBe('2026-02-02T09:15:00');
      expect(col('when')[1]).toBe('2026-02-02T20:05:30');
      expect(col('day')).toEqual(['2026-02-02', '2026-02-02', '2026-02-03', '2026-02-03', '2026-02-04']);
      expect(col('note')).toEqual(['fine', 'café later', '', 'long day at work', 'ok']);
      const label = (c: string) => f.labels[f.columns.find((x) => x.toLowerCase() === c)!];
      expect(label('mood')).toBe('How is your mood right now?');
      expect(label('stress')).toBe('How stressed are you?');
      if (WITH_VALUE_LABELS.has(name)) {
        const vl = f.valueLabels[f.columns.find((x) => x.toLowerCase() === 'mood')!];
        expect(vl).toEqual([
          { value: '1', label: 'Low' },
          { value: '3', label: 'Neutral' },
          { value: '5', label: 'High' },
        ]);
      }
    });
  }

  it('carries labels through to a study: question text and response options', async () => {
    const f = await read('study.sav');
    const table = statFileToTable(f);
    const m = guessMapping(table);
    expect(m.participant).toBe('id');
    expect(m.time).toBe('when');
    expect(m.headerRows).toEqual(['id']);
    const r = datasetToData(table, m);
    expect(r.questionText.get('mood')).toBe('How is your mood right now?');
    const spec = inferSpecFromData(r, 'test');
    const mood = spec.surveys[0]!.questions!.find((q) => q['Question.ID'] === 'mood')!;
    expect(mood['Question.Text']).toBe('How is your mood right now?');
    expect(mood['Question.Type.Display.Name']).toBe('Multiple Choice');
    expect(mood.responseKey).toEqual(
      expect.arrayContaining([
        { value: '1', definition: 'Low' },
        { value: '5', definition: 'High' },
        { value: '2', definition: '2' },
      ]),
    );
  });

  it('reads an .RData file: the largest data frame, factors as labelled codes', async () => {
    const f = await read('study.RData');
    expect(f.columns).toEqual(['id', 'mood', 'ok']);
    expect(f.rows).toEqual([
      ['P1', '3', 'TRUE'],
      ['P2', '1', 'FALSE'],
      ['P3', '', ''],
    ]);
    expect(f.valueLabels.mood).toEqual([
      { value: '1', label: 'Low' },
      { value: '2', label: 'Neutral' },
      { value: '3', label: 'High' },
    ]);
    expect(f.notes.join(' ')).toMatch(/2 data frames/);
  });

  it('can use variable labels as question IDs, or ignore them', async () => {
    const table = statFileToTable(await read('study.sav'));
    const m = guessMapping(table);
    const asIds = datasetToData(table, { ...m, labelsAs: 'id' });
    expect(asIds.variables).toContain('How is your mood right now?');
    expect(asIds.questionText.size).toBe(0);
    expect(asIds.valueLabels.get('How is your mood right now?')?.length).toBe(3);
    const ignored = datasetToData(table, { ...m, labelsAs: 'ignore' });
    expect(ignored.variables).toContain('mood');
    expect(ignored.questionText.size).toBe(0);
  });

  it('decodes IBM floating point and SAS run-length compression', () => {
    expect(ibmToDouble(Uint8Array.from([0x41, 0x10, 0, 0, 0, 0, 0, 0]))).toBe(1);
    expect(ibmToDouble(Uint8Array.from([0xc2, 0x76, 0xa0, 0, 0, 0, 0, 0]))).toBe(-118.625);
    expect(ibmToDouble(Uint8Array.from([0x2e, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    // Copy 3 literal bytes, then 5 blanks.
    expect(Array.from(rle(Uint8Array.from([0x82, 65, 66, 67, 0xe3]), 8))).toEqual([65, 66, 67, 32, 32, 32, 32, 32]);
  });
});
