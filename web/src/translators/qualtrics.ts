// Qualtrics -> study spec.
// Accepts the .qsf file from Qualtrics' "Export Survey" (no API key, no network),
// and also the JSON returned by the v3 API's GET /surveys/{id}.
// Both are normalized into one internal shape first, then converted.
import { buildBlockMap, stripHtml, type Survey } from '../core';
import { isObject, parseJson, tryParseJson, TranslationError, type Translator } from './types';

type Obj = Record<string, unknown>;

interface QChoice {
  id: string;
  value: string;
  label: string;
}
interface QQuestion {
  qid: string;
  exportTag: string;
  text: string;
  type: string;
  selector: string;
  choices: QChoice[];
  answers: QChoice[];
  displayLogic: unknown;
}
interface QBlock {
  id: string;
  description: string;
  questionIds: string[];
}
interface QSurvey {
  name: string;
  blocks: QBlock[];
  questions: Map<string, QQuestion>;
}

const isQsf = (d: unknown) => isObject(d) && Array.isArray(d.SurveyElements);
const apiResult = (d: unknown): Obj | null => {
  const r = isObject(d) && isObject(d.result) ? d.result : d;
  return isObject(r) && isObject(r.questions) && isObject(r.blocks) ? r : null;
};

export const qualtricsTranslator: Translator = {
  id: 'qualtrics',
  label: 'Qualtrics survey (.qsf)',
  howToGet: 'In Qualtrics: Survey → Tools → Import/Export → Export Survey. Upload the .qsf file.',
  accept: '.qsf,.json,application/json',
  detect: ({ fileName, text }) => {
    if (/\.qsf$/i.test(fileName)) return true;
    const d = tryParseJson(text);
    return isQsf(d) || apiResult(d) != null;
  },
  translate: (input) => {
    const d = parseJson(input);
    const notes: string[] = [];
    const survey = isQsf(d) ? fromQsf(d as Obj) : apiResult(d) ? fromApi(apiResult(d)!) : null;
    if (!survey) throw new TranslationError('This does not look like a Qualtrics .qsf export.');
    return { spec: toSpec(survey, notes), notes };
  },
};

function fromQsf(qsf: Obj): QSurvey {
  const els = qsf.SurveyElements as Obj[];
  const entry = isObject(qsf.SurveyEntry) ? qsf.SurveyEntry : {};
  const questions = new Map<string, QQuestion>();
  for (const el of els) {
    if (el.Element !== 'SQ' || !isObject(el.Payload)) continue;
    const p = el.Payload;
    const qid = String(p.QuestionID ?? el.PrimaryAttribute);
    const choices = orderedChoices(p.Choices, p.ChoiceOrder, p.RecodeValues);
    questions.set(qid, {
      qid,
      exportTag: String(p.DataExportTag || qid),
      text: stripHtml(String(p.QuestionText ?? '')),
      type: String(p.QuestionType ?? ''),
      selector: String(p.Selector ?? ''),
      choices,
      answers: orderedChoices(p.Answers, p.AnswerOrder, p.RecodeValues),
      displayLogic: p.DisplayLogic,
    });
  }

  const blEl = els.find((e) => e.Element === 'BL');
  const rawBlocks = blEl ? (Array.isArray(blEl.Payload) ? blEl.Payload : Object.values((blEl.Payload as Obj) ?? {})) : [];
  const blocks: QBlock[] = (rawBlocks as Obj[])
    .filter((b) => isObject(b) && b.Type !== 'Trash')
    .map((b) => ({
      id: String(b.ID),
      description: String(b.Description || b.ID),
      questionIds: ((b.BlockElements as Obj[]) ?? []).filter((e) => e.Type === 'Question').map((e) => String(e.QuestionID)),
    }));

  // Survey flow decides block order; fall back to the block list order.
  const flEl = els.find((e) => e.Element === 'FL');
  const order: string[] = [];
  const walk = (node: unknown) => {
    if (!isObject(node)) return;
    if ((node.Type === 'Block' || node.Type === 'Standard') && node.ID) order.push(String(node.ID));
    for (const child of (node.Flow as unknown[]) ?? []) walk(child);
  };
  if (flEl) walk(flEl.Payload);
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + blocks.findIndex((b) => b.id === id));
  blocks.sort((a, b) => rank(a.id) - rank(b.id));

  return { name: String(entry.SurveyName || 'Qualtrics survey'), blocks, questions };
}

function fromApi(r: Obj): QSurvey {
  const questions = new Map<string, QQuestion>();
  for (const [qid, q0] of Object.entries(r.questions as Obj)) {
    const q = q0 as Obj;
    const qt = isObject(q.questionType) ? q.questionType : {};
    const choices = Object.entries((q.choices as Obj) ?? {}).map(([id, c]) => ({
      id,
      value: String((c as Obj).recode ?? id),
      label: stripHtml(String((c as Obj).choiceText ?? '')),
    }));
    questions.set(qid, {
      qid,
      exportTag: String(q.questionName || qid),
      text: stripHtml(String(q.questionText ?? '')),
      type: String(qt.type ?? ''),
      selector: String(qt.selector ?? ''),
      choices,
      answers: [],
      displayLogic: q.displayLogic ?? q.DisplayLogic,
    });
  }
  const blocks = Object.entries(r.blocks as Obj).map(([id, b0]) => {
    const b = b0 as Obj;
    return {
      id,
      description: String(b.description || id),
      questionIds: ((b.elements as Obj[]) ?? []).filter((e) => e.type === 'Question').map((e) => String(e.questionId)),
    };
  });
  return { name: String(r.name || 'Qualtrics survey'), blocks, questions };
}

function orderedChoices(choices: unknown, order: unknown, recodes: unknown): QChoice[] {
  if (!isObject(choices)) return [];
  const ids = Array.isArray(order) && order.length ? order.map(String) : Object.keys(choices);
  const rec = isObject(recodes) ? recodes : {};
  return ids
    .filter((id) => isObject(choices[id]))
    .map((id) => ({ id, value: String(rec[id] ?? id), label: stripHtml(String((choices[id] as Obj).Display ?? '')) }));
}

function mapType(q: QQuestion): { type: string; dataType: string | null } | null {
  switch (q.type) {
    case 'MC':
      return /^(MA|MSB|MACOL)/.test(q.selector) ? { type: 'Multiple Select', dataType: 'integer' } : { type: 'Multiple Choice', dataType: 'integer' };
    case 'TE':
      return { type: 'Free Response', dataType: 'character' };
    case 'Slider':
      return q.choices.length > 1 ? { type: 'Multiple Slider', dataType: 'numeric' } : { type: 'Slider', dataType: 'numeric' };
    case 'Matrix':
      return { type: 'Multiple Choice', dataType: 'integer' };
    case 'DB':
      return { type: 'Informational Fullscreen', dataType: null };
    case 'CS':
      return { type: 'Multiple Slider', dataType: 'numeric' };
    default:
      return null;
  }
}

interface Condition {
  masterQid: string;
  choiceId: string | null;
  operator: string;
}

/** Pull every Expression condition out of a Qualtrics DisplayLogic tree. */
function conditions(logic: unknown): Condition[] {
  const out: Condition[] = [];
  const walk = (node: unknown) => {
    if (!isObject(node)) return;
    if (node.Type === 'Expression' && (node.LogicType === 'Question' || node.QuestionID)) {
      const loc = String(node.ChoiceLocator ?? node.LeftOperand ?? '');
      const m = /q:\/\/(QID\d+)\/[^/]+\/(\w+)/.exec(loc);
      out.push({ masterQid: String(node.QuestionID ?? m?.[1] ?? ''), choiceId: m?.[2] ?? null, operator: String(node.Operator ?? '') });
      return;
    }
    for (const [k, v] of Object.entries(node)) if (/^\d+$/.test(k)) walk(v);
  };
  walk(logic);
  return out.filter((c) => c.masterQid);
}

const OPERATOR: Record<string, string> = {
  Selected: '1', EqualTo: '1', NotSelected: '6', NotEqualTo: '6',
  LessThanOrEqual: '2', GreaterThanOrEqual: '3', LessThan: '4', GreaterThan: '5',
};

function toSpec(s: QSurvey, notes: string[]): Obj {
  const items: Obj[] = [];
  const skipped: string[] = [];
  const included = new Set<string>();
  const mappings = new Map<string, Obj[]>();

  for (const b of s.blocks) {
    items.push({
      'Item.ID': b.id,
      'Question.ID': b.id,
      'Question.Long.Name': b.description,
      'Question.Type.Display.Name': 'Block',
      'Item.Type': 'Block',
      Parent: null,
    });
    for (const qid of b.questionIds) {
      const q = s.questions.get(qid);
      if (!q) continue;
      const mapped = mapType(q);
      if (!mapped) {
        skipped.push(`${q.exportTag} (${q.type})`);
        continue;
      }
      if (q.type === 'Matrix') notes.push(`${q.exportTag}: matrix question stored as one Multiple Choice item; its rows are listed in the description.`);
      const responseKey =
        q.type === 'Matrix'
          ? (q.answers.length ? q.answers : q.choices).map((c) => ({ value: c.value, definition: c.label }))
          : mapped.type === 'Multiple Choice' || mapped.type === 'Multiple Select' || mapped.type === 'Multiple Slider'
            ? q.choices.map((c) => ({ value: c.value, definition: c.label }))
            : [];
      const item: Obj = {
        'Item.ID': q.qid,
        'Question.ID': q.exportTag,
        'Question.Text': q.text,
        'Question.Type.Display.Name': mapped.type,
        'Item.Type': 'Question',
        Parent: b.id,
        'Data.Type': mapped.dataType,
        responseKey,
      };
      if (q.type === 'Matrix' && q.answers.length) item['Question.Description'] = `Rows: ${q.choices.map((c) => c.label).join('; ')}`;

      const conds = conditions(q.displayLogic);
      if (conds.length) {
        const first = conds[0]!;
        const sameMaster = conds.every((c) => c.masterQid === first.masterQid);
        const master = s.questions.get(first.masterQid);
        const choiceFor = (id: string | null) => master?.choices.find((c) => c.id === id);
        item['Conditional.Info'] = {
          'Conditional.Master.Item.ID': first.masterQid,
          'Conditional.Type': OPERATOR[first.operator] ?? '1',
          ...(choiceFor(first.choiceId) ? { 'Conditional.Threshold': choiceFor(first.choiceId)!.value } : {}),
        };
        if (/Selected|EqualTo/.test(first.operator) && !/Not/.test(first.operator)) {
          const list = mappings.get(first.masterQid) ?? [];
          for (const c of sameMaster ? conds : [first]) {
            const ch = choiceFor(c.choiceId);
            list.push({ 'Conditional.Child.Item.ID': q.qid, Definition: ch?.label ?? '' });
          }
          mappings.set(first.masterQid, list);
        }
        if (!sameMaster) notes.push(`${q.exportTag}: display logic uses several questions; only the condition on ${master?.exportTag ?? first.masterQid} was kept.`);
      }
      included.add(q.qid);
      items.push(item);
    }
  }

  for (const item of items) {
    const m = mappings.get(String(item['Item.ID']));
    if (m) item['Conditional.Info'] = { ...((item['Conditional.Info'] as Obj) ?? {}), 'Conditional.Child.Mappings': m };
  }
  // Drop conditions pointing at questions that weren't converted.
  for (const item of items) {
    const ci = item['Conditional.Info'] as Obj | undefined;
    if (ci?.['Conditional.Master.Item.ID'] && !included.has(String(ci['Conditional.Master.Item.ID']))) {
      delete ci['Conditional.Master.Item.ID'];
      delete ci['Conditional.Type'];
      delete ci['Conditional.Threshold'];
      if (!Object.keys(ci).length) delete item['Conditional.Info'];
    }
  }

  if (skipped.length) notes.push(`Skipped ${skipped.length} item(s) with no equivalent question type: ${skipped.join(', ')}.`);
  notes.push('Qualtrics exports contain no schedule, so the study has no schedules yet.');
  notes.push('Study details (authors, funding, abstract) aren\'t in Qualtrics exports; add them in the spec.');

  const surveys = [{ 'Survey.Name': s.name, 'Survey.LongName': s.name, questions: items }];
  return {
    'Study.Metadata': { 'Study.Name': s.name },
    schedules: [],
    surveys,
    blockMap: buildBlockMap(surveys as unknown as Survey[]),
  };
}
