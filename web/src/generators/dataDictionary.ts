// Spec -> data dictionary, in the prior tool's column layout so existing
// workflows keep working. One addition: Shown.When (skip logic), which was
// on the prior tool's to-do list. Blocks stay as rows to show structure;
// End Block markers are dropped since they carry no information.
import {
  blockPath,
  isBlock,
  isEndBlock,
  itemLabel,
  responseOptions,
  responseRange,
  shownWhen,
  blockNotes,
  stripHtml,
  surveyModels,
  toCsv,
  type StudySpec,
} from '../core';

export interface DictionaryRow {
  'Survey.LongName': string;
  'Question.ID': string;
  'Question.Text': string;
  'Question.Type.Display.Name': string;
  'Result.Type': string;
  'Missingness.Codes': string;
  'Response.Range': string;
  'Response.Text': string;
  'Shown.When': string;
  /** Not columns: used by the viewer for keys, grouping and display. */
  _itemId: string;
  _isBlock: boolean;
  _surveyName: string;
  _blockPath: string;
  _options: Array<{ value: string; label: string }>;
}

export const DICTIONARY_COLUMNS = [
  'Survey.LongName',
  'Question.ID',
  'Question.Text',
  'Question.Type.Display.Name',
  'Result.Type',
  'Missingness.Codes',
  'Response.Range',
  'Response.Text',
  'Shown.When',
] as const;
export type DictionaryColumn = (typeof DICTIONARY_COLUMNS)[number];

export function generateDataDictionary(spec: StudySpec): DictionaryRow[] {
  const surveyLabel = (n: string) => spec.surveys.find((s) => s['Survey.Name'] === n)?.['Survey.LongName'] || n;
  return surveyModels(spec).flatMap((model) =>
    (model.survey.questions ?? [])
      .filter((q) => !isEndBlock(q))
      .map((q) => {
        const block = isBlock(q);
        return {
          'Survey.LongName': model.label,
          'Question.ID': q['Question.ID'],
          'Question.Text': block ? '' : stripHtml(q['Question.Text'] ?? ''),
          'Question.Type.Display.Name': q['Question.Type.Display.Name'],
          'Result.Type': block ? '' : (q['Data.Type'] ?? ''),
          'Missingness.Codes': '',
          'Response.Range': block ? '' : (responseRange(q) ?? ''),
          'Response.Text': block ? '' : responseOptions(q).map((o) => o.label).join(', '),
          'Shown.When': [shownWhen(model, q['Item.ID']), ...blockNotes(model, q['Item.ID'], surveyLabel)].filter(Boolean).join('; '),
          _itemId: q['Item.ID'],
          _isBlock: block,
          _surveyName: model.name,
          _blockPath: blockPath(model, q).join(' › '),
          _options: block ? [] : responseOptions(q),
        };
      }),
  );
}

/** CSV with R-style NA for empty cells, matching the prior tool's DataDictionary.csv. */
export function dataDictionaryCsv(rows: DictionaryRow[]): string {
  return toCsv(
    [...DICTIONARY_COLUMNS],
    rows.map((r) => DICTIONARY_COLUMNS.map((c) => (r[c] === '' ? 'NA' : r[c]))),
  );
}

export { itemLabel };
