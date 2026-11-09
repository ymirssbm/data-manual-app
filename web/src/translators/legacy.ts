// Older flat spec layout (before Study.Metadata existed): Study.Name/authors/
// funding/abstract at the top level, Question.LongName, and conditional
// children stored as a "; "-joined Conditional.Child.Item.ID string.
import { buildBlockMap, type Survey } from '../core';
import { isObject, parseJson, tryParseJson, TranslationError, type Translator } from './types';

const META_KEYS = ['Study.Name', 'authors', 'funding', 'abstract'] as const;
const KEEP_TOP = new Set(['AI.Information', 'schedules', 'surveys', 'data', 'itemMap', 'screenshotsURL', 'blockMap', ...META_KEYS]);

type Obj = Record<string, unknown>;

export const legacyTranslator: Translator = {
  id: 'legacy',
  label: 'Older study spec (JSON)',
  howToGet: 'A study spec JSON from an earlier version of the format (Study.Name at the top level).',
  accept: '.json,application/json',
  detect: ({ text }) => {
    const d = tryParseJson(text);
    return isObject(d) && !isObject(d['Study.Metadata']) && Array.isArray(d.surveys);
  },
  translate: (input) => {
    const src = parseJson(input);
    if (!isObject(src)) throw new TranslationError('Expected a JSON object.');
    const notes: string[] = [];
    const meta: Obj = {};
    for (const k of META_KEYS) if (typeof src[k] === 'string' && src[k] !== '') meta[k] = src[k];
    if (!meta['Study.Name']) {
      meta['Study.Name'] = input.fileName.replace(/\.[^.]+$/, '');
      notes.push(`No Study.Name found; used the file name "${meta['Study.Name']}".`);
    }

    const dropped = Object.keys(src).filter((k) => !KEEP_TOP.has(k));
    if (dropped.length) notes.push(`Ignored unrecognized top-level fields: ${dropped.join(', ')}.`);

    const blockMap = Array.isArray(src.blockMap) ? (src.blockMap as Obj[]) : [];
    const surveys = (src.surveys as Obj[]).map((s) => convertSurvey(restoreBlocks(s, blockMap, notes), notes));
    const spec: Obj = {
      'Study.Metadata': meta,
      schedules: Array.isArray(src.schedules) ? src.schedules : [],
      surveys,
      blockMap: buildBlockMap(surveys as unknown as Survey[]),
    };
    if (isObject(src['AI.Information'])) spec['AI.Information'] = src['AI.Information'];
    if (typeof src.screenshotsURL === 'string') spec.screenshotsURL = src.screenshotsURL;
    if (isObject(src.itemMap)) spec.itemMap = src.itemMap;

    if (isObject(src.data)) {
      const hasRows = Object.values(src.data).some((v) => Array.isArray(v) && v.length > 0);
      if (hasRows) spec.data = src.data;
      else notes.push('The data block was empty, so it was left out.');
    }
    notes.push('blockMap was rebuilt from each item\'s Parent, so the two always agree.');
    return { spec, notes };
  },
};

/**
 * Some older files list blocks only in blockMap, not as items in the survey,
 * so questions point at a Parent that doesn't exist. Recreate those blocks,
 * each placed just before its first member.
 */
function restoreBlocks(s: Obj, blockMap: Obj[], notes: string[]): Obj {
  const questions = Array.isArray(s.questions) ? [...(s.questions as Obj[])] : [];
  const ids = new Set(questions.map((q) => String(q['Item.ID'])));
  const missing = [...new Set(questions.map((q) => q.Parent).filter((p): p is string => typeof p === 'string' && p !== '' && !ids.has(p)))];
  if (!missing.length) return s;
  const restored: string[] = [];
  for (const id of missing) {
    const entry = blockMap.find((b) => b['Item.ID'] === id && (b['Survey.Name'] == null || b['Survey.Name'] === s['Survey.Name']));
    if (!entry && !blockMap.length) continue;
    const at = questions.findIndex((q) => q.Parent === id);
    questions.splice(at, 0, {
      'Item.ID': id,
      'Question.ID': id.replace(/^Item\s+/, ''),
      'Question.Type.Display.Name': 'Block',
      'Item.Type': 'Block',
      Parent: (entry?.Parent as string | null | undefined) ?? null,
    });
    restored.push(id);
  }
  if (restored.length) notes.push(`Restored ${restored.length} block(s) in "${s['Survey.Name']}" that were only listed in blockMap: ${restored.join(', ')}.`);
  return { ...s, questions };
}

function convertSurvey(s: Obj, notes: string[]): Obj {
  const questions = Array.isArray(s.questions) ? (s.questions as Obj[]) : [];
  const ids = new Set(questions.map((q) => String(q['Item.ID'])));
  // Older files sometimes reference "5745" where the item is "Item 5745".
  const resolve = (id: unknown): string | null => {
    if (id == null || id === '') return null;
    const v = String(id).trim();
    if (ids.has(v)) return v;
    if (ids.has(`Item ${v}`)) return `Item ${v}`;
    return v;
  };

  let renamed = 0;
  const out = questions.map((q0) => {
    const q: Obj = { ...q0 };
    if ('Question.LongName' in q) {
      if (!('Question.Long.Name' in q)) q['Question.Long.Name'] = q['Question.LongName'];
      delete q['Question.LongName'];
      renamed++;
    }
    if (q.Parent !== undefined) q.Parent = resolve(q.Parent);
    else q.Parent = null;

    if (q['Item.Type'] === 'Block') {
      delete q['Question.Text'];
      delete q['Data.Type'];
      delete q.responseKey;
    } else {
      q['Question.Text'] ??= '';
      if (!('Data.Type' in q)) q['Data.Type'] = null;
      q.responseKey ??= [];
    }

    if (isObject(q['Conditional.Info'])) {
      const ci: Obj = { ...q['Conditional.Info'] };
      const childRaw = ci['Conditional.Child.Item.ID'];
      if (childRaw != null && !Array.isArray(ci['Conditional.Child.Mappings'])) {
        const children = (Array.isArray(childRaw) ? childRaw : String(childRaw).split(';')).map(resolve).filter(Boolean) as string[];
        const defGroups = typeof q0.Definitions === 'string' ? q0.Definitions.split(';').map((g) => g.trim()) : [];
        ci['Conditional.Child.Mappings'] = children.flatMap((child, i) => {
          const defs = (defGroups[i] ?? '').split('|').map((d) => d.trim()).filter(Boolean);
          return (defs.length ? defs : ['']).map((d) => ({ 'Conditional.Child.Item.ID': child, Definition: d }));
        });
      }
      delete ci['Conditional.Child.Item.ID'];
      for (const k of ['Conditional.Master.Item.ID', 'Conditional.Fail.Item.ID'] as const) {
        if (k in ci) ci[k] = resolve(ci[k]);
      }
      for (const [k, v] of Object.entries(ci)) {
        if (v == null || (Array.isArray(v) && v.length === 0)) delete ci[k];
      }
      if (ci['Multi.Conditional'] === false && Object.keys(ci).length === 1) delete ci['Multi.Conditional'];
      if (Object.keys(ci).length) q['Conditional.Info'] = ci;
      else delete q['Conditional.Info'];
    }
    delete q.Definitions;
    return q;
  });
  if (renamed) notes.push(`Renamed Question.LongName to Question.Long.Name on ${renamed} item(s) in "${s['Survey.Name']}".`);
  return { ...s, questions: out };
}
