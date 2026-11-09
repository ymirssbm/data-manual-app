// Study spec → REDCap data dictionary CSV (Project Setup → Data Dictionary → Upload).
// One instrument per survey; blocks become section headers; skip logic becomes branching logic.
import { isBlock, isEndBlock, stripHtml, toCsv, type Question, type StudySpec } from '../core';
import { isMulti, isNumericType, surveyLogic, type Alt, type Gate } from './logic';

export const REDCAP_COLUMNS = [
  'Variable / Field Name',
  'Form Name',
  'Section Header',
  'Field Type',
  'Field Label',
  'Choices, Calculations, OR Slider Labels',
  'Field Note',
  'Text Validation Type OR Show Slider Number',
  'Text Validation Min',
  'Text Validation Max',
  'Identifier?',
  'Branching Logic (Show field only if...)',
  'Required Field?',
  'Custom Alignment',
  'Question Number (surveys only)',
  'Matrix Group Name',
  'Matrix Ranking?',
  'Field Annotation',
] as const;

/** REDCap names: lowercase letters, digits and underscores, starting with a letter. */
export function redcapName(raw: string, used: Set<string>, max = 100): string {
  let base = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!/^[a-z]/.test(base)) base = `v_${base}`;
  base = base.slice(0, max) || 'v';
  let name = base;
  for (let k = 2; used.has(name); k++) name = `${base.slice(0, max - String(k).length - 1)}_${k}`;
  used.add(name);
  return name;
}

export interface ExportResult {
  fileName: string;
  text: string;
  mime: string;
  notes: string[];
}

export function exportRedcapDictionary(spec: StudySpec): ExportResult {
  const notes: string[] = [];
  const usedVars = new Set<string>(['record_id']);
  const usedForms = new Set<string>();
  const rows: string[][] = [];
  const varOf = new Map<string, string>(); // Item.ID → field name

  const choices = (q: Question) => (q.responseKey ?? []).map((r) => `${r.value}, ${r.definition.replace(/[|]/g, '/')}`).join(' | ');
  const quote = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? v : `'${v.replace(/'/g, "\\'")}'`);
  const alt = (a: Alt): string | null => {
    const name = varOf.get(a.parent['Item.ID']);
    if (!name) return null;
    if (a.kind === 'cmp') return `[${name}] ${a.op === '!=' ? '<>' : a.op} ${quote(a.value)}`;
    if (isMulti(a.parent)) return a.values.map((v) => `[${name}(${v})] = '1'`).join(' or ');
    return a.values.map((v) => `[${name}] = ${quote(v)}`).join(' or ');
  };
  const logicText = (gates: Gate[]): string => {
    const parts = gates.map((g) => g.map(alt).filter((x): x is string => !!x)).filter((g) => g.length);
    return parts.map((g) => (g.length > 1 || parts.length > 1 ? `(${g.join(' or ')})` : g[0]!)).join(' and ');
  };

  spec.surveys.forEach((survey, si) => {
    const form = redcapName(survey['Survey.Name'] || `survey_${si + 1}`, usedForms);
    const logic = surveyLogic(survey);
    if (si === 0) rows.push(['record_id', form, '', 'text', 'Record ID', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    let pendingHeader = '';
    for (const q of survey.questions ?? []) {
      if (isEndBlock(q)) continue;
      if (isBlock(q)) {
        pendingHeader = q['Question.Long.Name'] || q['Question.ID'] || '';
        continue;
      }
      const name = redcapName(q['Question.ID'] || q['Item.ID'], usedVars);
      varOf.set(q['Item.ID'], name);
      const label = stripHtml(q['Question.Text'] ?? '') || q['Question.ID'];
      const type = q['Question.Type.Display.Name'];
      let fieldType = 'text';
      let ch = '';
      let validation = '';
      let min = '';
      let max = '';
      switch (type) {
        case 'Multiple Choice':
          fieldType = 'radio';
          ch = choices(q);
          break;
        case 'Multiple Select':
          fieldType = 'checkbox';
          ch = choices(q);
          break;
        case 'Slider': {
          fieldType = 'slider';
          const keys = (q.responseKey ?? []).map((r) => r.definition);
          ch = keys.length >= 2 ? `${keys[0]} | | ${keys[keys.length - 1]}` : keys.join(' | ');
          const nums = (q.responseKey ?? []).map((r) => Number(r.value)).filter(Number.isFinite);
          if (nums.length && (Math.min(...nums) !== 0 || Math.max(...nums) !== 100)) {
            min = String(Math.min(...nums));
            max = String(Math.max(...nums));
          }
          validation = 'number';
          break;
        }
        case 'Time Picker':
          validation = 'time';
          break;
        case 'Informational Fullscreen':
          fieldType = 'descriptive';
          break;
        case 'Multiple Slider':
        case 'Time Scale Slider':
          notes.push(`${q['Question.ID']} (${type}) has no REDCap equivalent; exported as a text field.`);
          break;
        default:
          if (isNumericType(q)) validation = /^integer$/i.test(q['Data.Type'] ?? '') ? 'integer' : 'number';
          else if (label.length > 0 && /describe|explain|tell us|comments?/i.test(label)) fieldType = 'notes';
      }
      const branching = logicText(logic.flat(q['Item.ID']));
      rows.push([name, form, pendingHeader, fieldType, label, ch, q['Question.Description'] ?? '', validation, min, max, '', branching, '', '', '', '', '', '']);
      pendingHeader = '';
    }
  });

  const renamed = spec.surveys.flatMap((s) => (s.questions ?? []).filter((q) => !isBlock(q) && !isEndBlock(q) && varOf.get(q['Item.ID']) !== q['Question.ID']).map((q) => `${q['Question.ID']} → ${varOf.get(q['Item.ID'])}`));
  if (renamed.length) notes.push(`REDCap variable names must be lowercase letters, digits and underscores; renamed: ${renamed.slice(0, 12).join(', ')}${renamed.length > 12 ? `, and ${renamed.length - 12} more` : ''}.`);
  notes.push('Upload in REDCap: Project Setup → Data Dictionary → Upload. Schedules are not part of a data dictionary; set up survey invitations in REDCap.');
  const text = toCsv([...REDCAP_COLUMNS], rows);
  return { fileName: `${redcapName(spec['Study.Metadata']['Study.Name'] || 'study', new Set(), 60)}_DataDictionary.csv`, text, mime: 'text/csv', notes };
}
