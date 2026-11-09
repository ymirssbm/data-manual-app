// REDCap data dictionary CSV -> study spec.
// Each REDCap instrument (form) becomes a survey; each section header starts a block.
// Simple branching logic ([field] = 'x' or ...) becomes skip logic; anything more
// complex is kept verbatim in the item description so nothing is silently lost.
import { buildBlockMap, parseCsvObjects, stripHtml, type Survey } from '../core';
import { TranslationError, type Translator } from './types';

type Obj = Record<string, unknown>;

// Header names differ between the UI download and the API export; normalize to API names.
const HEADER_ALIASES: Record<string, string> = {
  'variable / field name': 'field_name',
  'form name': 'form_name',
  'section header': 'section_header',
  'field type': 'field_type',
  'field label': 'field_label',
  'choices, calculations, or slider labels': 'select_choices_or_calculations',
  'field note': 'field_note',
  'text validation type or show slider number': 'text_validation_type_or_show_slider_number',
  'text validation min': 'text_validation_min',
  'text validation max': 'text_validation_max',
  'identifier?': 'identifier',
  'branching logic (show field only if...)': 'branching_logic',
  'required field?': 'required_field',
  'field annotation': 'field_annotation',
  'matrix group name': 'matrix_group_name',
};
const norm = (h: string) => HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim().toLowerCase();

export const redcapTranslator: Translator = {
  id: 'redcap',
  label: 'REDCap data dictionary (.csv)',
  howToGet: 'In REDCap: Project Setup → Data Dictionary → Download the current Data Dictionary.',
  accept: '.csv,text/csv',
  detect: ({ text }) => {
    const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
    return first.includes('variable / field name') || (first.includes('field_name') && first.includes('form_name'));
  },
  translate: ({ text, fileName }) => {
    const raw = parseCsvObjects(text);
    if (!raw.length) throw new TranslationError('The CSV has no rows.');
    const rows = raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), v.trim()])));
    if (!('field_name' in rows[0]!) || !('field_type' in rows[0]!)) {
      throw new TranslationError('Missing the "Variable / Field Name" or "Field Type" column; is this a REDCap data dictionary?');
    }
    const notes: string[] = [];
    const skipped: string[] = [];
    const complexLogic: string[] = [];

    // field_name -> { survey, item } for resolving branching logic.
    const byField = new Map<string, { survey: string; item: Obj; choices: Array<{ value: string; label: string }> }>();
    const surveys = new Map<string, Obj[]>();
    const blockCount = new Map<string, number>();
    const currentBlock = new Map<string, string | null>();

    for (const r of rows) {
      const form = r.form_name || 'form';
      const items = surveys.get(form) ?? [];
      surveys.set(form, items);

      if (r.section_header) {
        const n = (blockCount.get(form) ?? 0) + 1;
        blockCount.set(form, n);
        const id = `${form}__section_${n}`;
        items.push({
          'Item.ID': id,
          'Question.ID': id,
          'Question.Long.Name': stripHtml(r.section_header),
          'Question.Type.Display.Name': 'Block',
          'Item.Type': 'Block',
          Parent: null,
        });
        currentBlock.set(form, id);
      }

      const mapped = mapField(r);
      if (!mapped) {
        skipped.push(`${r.field_name} (${r.field_type})`);
        continue;
      }
      const item: Obj = {
        'Item.ID': r.field_name,
        'Question.ID': r.field_name,
        'Question.Text': stripHtml(r.field_label ?? ''),
        'Question.Type.Display.Name': mapped.type,
        'Item.Type': 'Question',
        Parent: currentBlock.get(form) ?? null,
        'Data.Type': mapped.dataType,
        responseKey: mapped.choices.map((c) => ({ value: c.value, definition: c.label })),
      };
      const desc = [r.field_note && stripHtml(r.field_note), r.identifier?.toLowerCase() === 'y' ? 'Identifier (PHI).' : '']
        .filter(Boolean)
        .join(' ');
      if (desc) item['Question.Description'] = desc;
      items.push(item);
      byField.set(r.field_name!, { survey: form, item, choices: mapped.choices });
    }

    // Branching logic, resolved after every field is known.
    for (const r of rows) {
      const logic = r.branching_logic;
      const target = byField.get(r.field_name ?? '');
      if (!logic || !target) continue;
      const parsed = parseBranching(logic);
      const master = parsed && byField.get(parsed.field);
      if (!parsed || !master || master.survey !== target.survey) {
        complexLogic.push(r.field_name!);
        const d = target.item['Question.Description'];
        target.item['Question.Description'] = `${d ? `${d} ` : ''}Branching logic: ${logic}`;
        continue;
      }
      const label = (v: string) => master.choices.find((c) => c.value === v)?.label ?? v;
      target.item['Conditional.Info'] = {
        'Conditional.Master.Item.ID': parsed.field,
        'Conditional.Type': parsed.op,
        'Conditional.Threshold': parsed.values[0],
      };
      if (parsed.op === '1') {
        const ci = ((master.item['Conditional.Info'] as Obj) ??= {});
        const list = (ci['Conditional.Child.Mappings'] as Obj[]) ?? [];
        for (const v of parsed.values) list.push({ 'Conditional.Child.Item.ID': r.field_name, Definition: label(v) });
        ci['Conditional.Child.Mappings'] = list;
      }
    }

    if (skipped.length) notes.push(`Skipped ${skipped.length} field(s) with no equivalent question type: ${skipped.join(', ')}.`);
    if (complexLogic.length) {
      notes.push(`${complexLogic.length} field(s) have branching logic too complex to convert; it's kept in their descriptions: ${complexLogic.join(', ')}.`);
    }
    notes.push('A REDCap data dictionary has no schedule or study details; add them in the spec.');

    const studyName = fileName.replace(/_DataDictionary.*$/i, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ') || 'REDCap project';
    const surveyList = [...surveys.entries()].map(([form, questions]) => ({
      'Survey.Name': form,
      'Survey.LongName': form.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      questions,
    }));
    return {
      spec: {
        'Study.Metadata': { 'Study.Name': studyName },
        schedules: [],
        surveys: surveyList,
        blockMap: buildBlockMap(surveyList as unknown as Survey[]),
      },
      notes,
    };
  },
};

function parseChoices(s: string | undefined): Array<{ value: string; label: string }> {
  if (!s) return [];
  return s
    .split('|')
    .map((part) => {
      const i = part.indexOf(',');
      return i < 0 ? null : { value: part.slice(0, i).trim(), label: stripHtml(part.slice(i + 1)) };
    })
    .filter((c): c is { value: string; label: string } => !!c && c.value !== '');
}

function mapField(r: Record<string, string>): { type: string; dataType: string | null; choices: Array<{ value: string; label: string }> } | null {
  const validation = (r.text_validation_type_or_show_slider_number ?? '').toLowerCase();
  switch ((r.field_type ?? '').toLowerCase()) {
    case 'text':
      if (/^integer$/.test(validation)) return { type: 'Free Response', dataType: 'integer', choices: [] };
      if (/^number/.test(validation)) return { type: 'Free Response', dataType: 'numeric', choices: [] };
      if (/^time/.test(validation)) return { type: 'Time Picker', dataType: 'character', choices: [] };
      return { type: 'Free Response', dataType: 'character', choices: [] };
    case 'notes':
      return { type: 'Free Response', dataType: 'character', choices: [] };
    case 'radio':
    case 'dropdown':
      return { type: 'Multiple Choice', dataType: 'integer', choices: parseChoices(r.select_choices_or_calculations) };
    case 'checkbox':
      return { type: 'Multiple Select', dataType: 'integer', choices: parseChoices(r.select_choices_or_calculations) };
    case 'yesno':
      return { type: 'Multiple Choice', dataType: 'integer', choices: [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }] };
    case 'truefalse':
      return { type: 'Multiple Choice', dataType: 'integer', choices: [{ value: '1', label: 'True' }, { value: '0', label: 'False' }] };
    case 'slider': {
      const labels = (r.select_choices_or_calculations ?? '').split('|').map((x) => stripHtml(x)).filter(Boolean);
      const min = Number(r.text_validation_min || 0);
      const max = Number(r.text_validation_max || 100);
      const pts = labels.length === 3 ? [min, (min + max) / 2, max] : labels.length === 2 ? [min, max] : [];
      return { type: 'Slider', dataType: 'numeric', choices: pts.map((v, i) => ({ value: String(v), label: labels[i]! })) };
    }
    case 'descriptive':
      return { type: 'Informational Fullscreen', dataType: null, choices: [] };
    default:
      return null; // calc, file, sql, signature: no equivalent display type yet
  }
}

const OPS: Record<string, string> = { '=': '1', '<=': '2', '>=': '3', '<': '4', '>': '5', '<>': '6', '!=': '6' };

/** Parses `[f] = '1'`, `[f(2)] = '1'` (checkbox), and OR-chains of those on one field. */
export function parseBranching(logic: string): { field: string; op: string; values: string[] } | null {
  const parts = logic.split(/\s+or\s+/i);
  let field: string | null = null;
  let op: string | null = null;
  const values: string[] = [];
  for (const p of parts) {
    const m = /^\s*\(?\s*\[([a-z0-9_]+)(?:\((\w+)\))?\]\s*(<=|>=|<>|!=|=|<|>)\s*['"]?([^'")]*)['"]?\s*\)?\s*$/i.exec(p);
    if (!m) return null;
    const [, f, checkboxCode, o, v] = m;
    if (field && f !== field) return null;
    field = f!;
    if (checkboxCode) {
      if (v !== '1' || o !== '=') return null;
      op = op ?? '1';
      values.push(checkboxCode);
    } else {
      if (op && OPS[o!] !== op) return null;
      op = OPS[o!]!;
      values.push(v!.trim());
    }
  }
  return field && op ? { field, op, values } : null;
}
