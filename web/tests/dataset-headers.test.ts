import { describe, expect, it } from 'vitest';
import { attachData, datasetToData, guessMapping, inferSpecFromData, parseDataset, type StudySpec } from '../src/core';

describe('dataset header rows: question IDs and text', () => {
  it('reads a Qualtrics-style CSV: IDs, then text, then an ImportId row', () => {
    const csv = [
      'ResponseId,EndDate,Q1,Q2',
      'Response ID,End Date,How happy are you right now?,How stressed do you feel today?',
      '"{""ImportId"":""_recordId""}","{""ImportId"":""endDate""}","{""ImportId"":""QID1""}","{""ImportId"":""QID2""}"',
      'R_1,2026-02-02 09:00,4,2',
      'R_2,2026-02-02 10:00,5,1',
    ].join('\n');
    const table = parseDataset(csv);
    const m = guessMapping(table);
    expect(m.layout).toBe('wide');
    expect(m.participant).toBe('ResponseId');
    expect(m.time).toBe('EndDate');
    expect(m.headerRows).toEqual(['id', 'text', 'ignore']);
    const r = datasetToData(table, m);
    expect(r.variables).toEqual(['Q1', 'Q2']);
    expect(guessMapping(parseDataset('StartDate,EndDate,Status,ResponseId,Q1\nx,2026-02-02,0,R_1,4')).variables).toEqual(['Q1']);
    expect(r.questionText.get('Q1')).toBe('How happy are you right now?');
    // Only the two data rows are read: 2 participants x 2 variables.
    expect(r.data['User.Response']).toEqual(['4', '2', '5', '1']);
    expect(r.notes[0]).toMatch(/^Read 2 rows/);
  });

  it('reads question text in the column names and IDs in the first row', () => {
    const csv = ['pid,How happy are you right now?,How stressed do you feel today?', 'pid,happy,stress', 'P1,4,2', 'P2,5,1'].join('\n');
    const table = parseDataset(csv);
    const m = guessMapping(table);
    expect(m.headerRows).toEqual(['text', 'id']);
    const r = datasetToData(table, m);
    expect(r.variables).toEqual(['happy', 'stress']);
    expect(r.questionText.get('stress')).toBe('How stressed do you feel today?');
    const spec = inferSpecFromData(r, 'test');
    expect(spec.surveys[0]!.questions![0]!['Question.Text']).toBe('How happy are you right now?');
  });

  it('keeps plain ID column names as one header row', () => {
    const table = parseDataset(['pid,happy,stress', 'P1,4,2'].join('\n'));
    expect(guessMapping(table).headerRows).toEqual(['id']);
  });

  it('reads a question text column in a long file', () => {
    const csv = ['pid,time,item,text,value', 'P1,2026-02-02 09:00,happy,How happy are you?,4', 'P1,2026-02-02 09:00,stress,How stressed are you?,2'].join('\n');
    const table = parseDataset(csv);
    const m = guessMapping(table);
    expect(m.layout).toBe('long');
    expect(m.questionText).toBe('text');
    const r = datasetToData(table, m);
    expect(r.questionText.get('happy')).toBe('How happy are you?');
  });

  it('attaches by question text when the IDs differ from the study', () => {
    const spec = {
      'Study.Metadata': { 'Study.Name': 's' },
      schedules: [],
      surveys: [
        {
          'Survey.Name': 'daily',
          questions: [{ 'Item.ID': 'mood', 'Question.ID': 'daily_mood', 'Item.Type': 'Question', Parent: null, 'Question.Text': '<p>How happy are you right now?</p>', 'Question.Type.Display.Name': 'Slider' }],
        },
      ],
    } as unknown as StudySpec;
    const table = parseDataset(['pid,Q1', 'pid,How happy are you right now?', 'P1,4'].join('\n'));
    const m = { ...guessMapping(table), headerRows: ['id', 'text'] as const };
    const r = datasetToData(table, { ...m, headerRows: [...m.headerRows] });
    const { report } = attachData(spec, r.data, r.questionText);
    expect(report.matched).toEqual(['daily_mood']);
  });
});
