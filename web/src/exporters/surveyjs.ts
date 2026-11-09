// Study spec <-> SurveyJS JSON. Export: one page per survey (or one survey), blocks become panels,
// skip logic becomes visibleIf. Import (used by the survey editor): reads the same shape back,
// keeping Item.IDs and spec-only fields stored in each element's "dm" property.
import { buildBlockMap, isBlock, isEndBlock, type Question, type StudySpec, type Survey } from '../core';
import { isMulti, surveyLogic, type Alt } from './logic';
import type { ExportResult } from './redcap';

type Obj = Record<string, unknown>;

const num = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? v : `'${v.replace(/'/g, "\\'")}'`);

function altExpr(a: Alt): string {
  const name = a.parent['Question.ID'];
  if (a.kind === 'cmp') return `{${name}} ${a.op === '=' ? '=' : a.op} ${num(a.value)}`;
  if (isMulti(a.parent)) return a.values.length === 1 ? `{${name}} contains ${num(a.values[0]!)}` : `{${name}} anyof [${a.values.map(num).join(', ')}]`;
  return a.values.length === 1 ? `{${name}} = ${num(a.values[0]!)}` : `{${name}} anyof [${a.values.map(num).join(', ')}]`;
}

const choiceValue = (v: string): string | number => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

/** One survey as a SurveyJS page: blocks become panels (nested), own skip logic becomes visibleIf. */
export function surveyToSurveyJsPage(survey: Survey): Obj {
  const logic = surveyLogic(survey);
  const visible = (id: string) => {
    const g = logic.own(id);
    return g.length ? g.map(altExpr).map((e) => (g.length > 1 ? `(${e})` : e)).join(' or ') : undefined;
  };
  const element = (q: Question): Obj => {
    const base: Obj = {
      name: q['Question.ID'],
      title: q['Question.Text'] || q['Question.ID'],
      ...(q['Question.Description'] ? { description: q['Question.Description'] } : {}),
      ...(visible(q['Item.ID']) ? { visibleIf: visible(q['Item.ID']) } : {}),
      dm: { itemId: q['Item.ID'], type: q['Question.Type.Display.Name'], dataType: q['Data.Type'] ?? null },
    };
    const choices = (q.responseKey ?? []).map((r) => ({ value: choiceValue(String(r.value)), text: r.definition }));
    switch (q['Question.Type.Display.Name']) {
      case 'Multiple Choice':
        return { type: 'radiogroup', ...base, choices };
      case 'Multiple Select':
        return { type: 'checkbox', ...base, choices };
      case 'Slider': {
        const nums = (q.responseKey ?? []).map((r) => Number(r.value)).filter(Number.isFinite);
        return { type: 'text', inputType: 'range', ...base, min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 100, step: 1, dm: { ...(base.dm as Obj), labels: q.responseKey ?? [] } };
      }
      case 'Time Picker':
        return { type: 'text', inputType: 'time', ...base };
      case 'Informational Fullscreen':
        return { type: 'html', name: base.name, html: `<p>${String(base.title)}</p>`, ...(base.visibleIf ? { visibleIf: base.visibleIf } : {}), dm: base.dm };
      default:
        return /^(integer|numeric|number)$/i.test(q['Data.Type'] ?? '') ? { type: 'text', inputType: 'number', ...base } : { type: 'comment', ...base, rows: 2 };
    }
  };
  const model = logic.model;
  const childrenOf = (parent: string | null) =>
    (survey.questions ?? []).filter((q) => !isEndBlock(q) && (parent ? q.Parent === parent : !q.Parent || !(model.byId.get(q.Parent) && isBlock(model.byId.get(q.Parent)!))));
  const build = (q: Question): Obj =>
    isBlock(q)
      ? {
          type: 'panel',
          name: q['Question.ID'] || q['Item.ID'],
          title: q['Question.Long.Name'] || q['Question.ID'],
          ...(visible(q['Item.ID']) ? { visibleIf: visible(q['Item.ID']) } : {}),
          elements: childrenOf(q['Item.ID']).map(build),
          dm: { itemId: q['Item.ID'], type: 'Block' },
        }
      : element(q);
  return { name: survey['Survey.Name'], title: survey['Survey.LongName'] || survey['Survey.Name'], elements: childrenOf(null).map(build) };
}

export function exportSurveyJs(spec: StudySpec, surveyName?: string): ExportResult {
  const surveys = surveyName ? spec.surveys.filter((s) => s['Survey.Name'] === surveyName) : spec.surveys;
  if (!surveys.length) throw new Error(`No survey named ${surveyName}.`);
  const json = { title: surveys.length === 1 ? surveys[0]!['Survey.LongName'] || surveys[0]!['Survey.Name'] : spec['Study.Metadata']['Study.Name'], pages: surveys.map(surveyToSurveyJsPage), showQuestionNumbers: 'off' };
  const name = (surveys.length === 1 ? surveys[0]!['Survey.Name'] : spec['Study.Metadata']['Study.Name']).replace(/[^\w-]+/g, '_');
  return { fileName: `${name}.surveyjs.json`, text: JSON.stringify(json, null, 2), mime: 'application/json', notes: ['Load it in any SurveyJS form or in SurveyJS Creator. Spec-only details ride along in each element\'s "dm" property.'] };
}

// ---------------------------------------------------------------- SurveyJS page -> survey (editor)

const TYPE_FROM_SJS: Record<string, string> = { radiogroup: 'Multiple Choice', dropdown: 'Multiple Choice', checkbox: 'Multiple Select', tagbox: 'Multiple Select', comment: 'Free Response', html: 'Informational Fullscreen', boolean: 'Multiple Choice', rating: 'Multiple Choice' };

/**
 * Rebuild a survey's questions from a SurveyJS page, keeping Item.IDs and skip logic of items that
 * still exist (skip logic is edited in the spec, not parsed back from visibleIf).
 */
export function surveyJsPageToSurvey(page: Obj, previous: Survey): Survey {
  const prevById = new Map((previous.questions ?? []).map((q) => [q['Item.ID'], q]));
  const prevByName = new Map((previous.questions ?? []).map((q) => [q['Question.ID'], q]));
  const used = new Set<string>();
  const questions: Question[] = [];
  const newId = (name: string) => {
    let id = name.replace(/[^\w.-]+/g, '_') || 'item';
    for (let k = 2; used.has(id) || prevById.has(id); k++) id = `${name}_${k}`;
    return id;
  };
  const walk = (els: Obj[], parent: string | null) => {
    for (const el of els) {
      const dm = (el.dm ?? {}) as Obj;
      const name = String(el.name ?? '');
      const prev: Question | undefined = (dm.itemId ? prevById.get(String(dm.itemId)) : undefined) ?? prevByName.get(name);
      const itemId = prev && !used.has(prev['Item.ID']) ? prev['Item.ID'] : newId(name);
      used.add(itemId);
      if (el.type === 'panel') {
        questions.push({ ...(prev ?? {}), 'Item.ID': itemId, 'Item.Type': 'Block', 'Question.ID': name || itemId, 'Question.Long.Name': String(el.title ?? name), 'Question.Type.Display.Name': 'Block', Parent: parent } as Question);
        walk((el.elements as Obj[]) ?? [], itemId);
        continue;
      }
      let type = TYPE_FROM_SJS[String(el.type)] ?? 'Free Response';
      if (el.type === 'text') type = el.inputType === 'range' ? 'Slider' : el.inputType === 'time' ? 'Time Picker' : 'Free Response';
      if (dm.type && typeof dm.type === 'string' && dm.type !== 'Block') {
        const keep = String(dm.type);
        // Keep the spec's own type when the SurveyJS element is compatible with it.
        if ((keep === 'Multiple Slider' || keep === 'Time Scale Slider') && el.type === 'text') type = keep;
      }
      let responseKey: Question['responseKey'] = prev?.responseKey ?? [];
      if (Array.isArray(el.choices)) {
        responseKey = (el.choices as unknown[]).map((c, i) => (typeof c === 'object' && c ? { value: String((c as Obj).value ?? i + 1), definition: String((c as Obj).text ?? (c as Obj).value) } : { value: String(c), definition: String(c) }));
      } else if (el.type === 'boolean') {
        responseKey = [{ value: '1', definition: String(el.labelTrue ?? 'Yes') }, { value: '0', definition: String(el.labelFalse ?? 'No') }];
      } else if (type === 'Slider') {
        const labels = Array.isArray(dm.labels) ? (dm.labels as Question['responseKey']) : [];
        responseKey = labels?.length ? labels : [{ value: String(el.min ?? 0), definition: String(el.min ?? 0) }, { value: String(el.max ?? 100), definition: String(el.max ?? 100) }];
      } else if (type !== 'Multiple Choice' && type !== 'Multiple Select') {
        responseKey = [];
      }
      const dataType =
        type === 'Multiple Choice' || type === 'Multiple Select' ? 'integer' : type === 'Slider' ? 'numeric' : el.inputType === 'number' ? (prev?.['Data.Type'] === 'integer' ? 'integer' : 'numeric') : type === 'Informational Fullscreen' ? null : (prev?.['Data.Type'] ?? 'character');
      const title = String(el.type === 'html' ? String(el.html ?? '').replace(/<[^>]+>/g, '') : (el.title ?? name));
      questions.push({
        ...(prev ?? {}),
        'Item.ID': itemId,
        'Item.Type': 'Question',
        'Question.ID': name || itemId,
        'Question.Text': title,
        'Question.Type.Display.Name': type,
        'Data.Type': dataType,
        Parent: parent,
        responseKey,
        ...(el.description ? { 'Question.Description': String(el.description) } : {}),
      } as Question);
    }
  };
  walk((page.elements as Obj[]) ?? [], null);
  return { ...previous, 'Survey.LongName': String(page.title ?? previous['Survey.LongName'] ?? ''), questions };
}

export function withSurveyReplaced(spec: StudySpec, index: number, survey: Survey): StudySpec {
  const surveys = spec.surveys.map((s, i) => (i === index ? survey : s));
  return { ...spec, surveys, blockMap: buildBlockMap(surveys) };
}
