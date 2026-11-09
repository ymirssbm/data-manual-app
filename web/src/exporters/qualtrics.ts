// Study spec → Qualtrics survey file (.qsf): Survey → Tools → Import/Export → Import Survey.
// Each spec block becomes a Qualtrics block (top-level questions share one block per run); skip
// logic becomes question display logic (Qualtrics has no display logic on blocks, so a block's
// condition is copied onto each of its questions).
import { isBlock, isEndBlock, stripHtml, type Question, type StudySpec, type Survey } from '../core';
import { isMulti, surveyLogic, type Alt, type Gate } from './logic';
import type { ExportResult } from './redcap';

type Obj = Record<string, unknown>;

const OPS: Record<string, string> = { '=': 'EqualTo', '!=': 'NotEqualTo', '<': 'LessThan', '<=': 'LessThanOrEqual', '>': 'GreaterThan', '>=': 'GreaterThanOrEqual' };

export function exportQualtrics(spec: StudySpec, surveyName?: string): ExportResult {
  const notes: string[] = [];
  const surveys = surveyName ? spec.surveys.filter((s) => s['Survey.Name'] === surveyName) : spec.surveys;
  if (!surveys.length) throw new Error(`No survey named ${surveyName}.`);
  if (surveys.length > 1) notes.push(`All ${surveys.length} surveys are in one Qualtrics survey, one block per section. Qualtrics surveys are usually one per form: export a single survey to keep them separate.`);

  const sid = 'SV_dataManualExport';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const qids = new Map<string, string>(); // Item.ID → QID
  let qCount = 0;
  const sq: Obj[] = [];
  const blocks: Array<{ id: string; description: string; qids: string[] }> = [];
  const tagUsed = new Set<string>();

  const choiceId = (q: Question, value: string) => {
    const k = (q.responseKey ?? []).findIndex((r) => String(r.value) === value);
    return k >= 0 ? String(k + 1) : null;
  };

  const expression = (a: Alt, conj: string | null): Obj[] => {
    const qid = qids.get(a.parent['Item.ID']);
    if (!qid) return [];
    const base = { LogicType: 'Question', QuestionID: qid, QuestionIsInLoop: 'no', QuestionIDFromLocator: qid, Type: 'Expression' };
    if (a.kind === 'in') {
      return a.values
        .map((v, i) => {
          const c = choiceId(a.parent, v);
          if (!c) return null;
          const loc = `q://${qid}/SelectableChoice/${c}`;
          return { ...base, ChoiceLocator: loc, LeftOperand: loc, Operator: 'Selected', Description: `If ${a.parent['Question.ID']} ${isMulti(a.parent) ? 'includes' : 'is'} ${v}`, ...(i > 0 || conj ? { Conjuction: i > 0 ? 'Or' : conj } : {}) };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
    }
    const isSlider = a.parent['Question.Type.Display.Name'] === 'Slider';
    const loc = isSlider ? `q://${qid}/ChoiceNumericEntryValue/1` : `q://${qid}/ChoiceTextEntryValue`;
    return [{ ...base, ChoiceLocator: loc, LeftOperand: loc, Operator: OPS[a.op], RightOperand: a.value, Description: `If ${a.parent['Question.ID']} ${a.op} ${a.value}`, ...(conj ? { Conjuction: conj } : {}) }];
  };

  /** All gates must hold (AND); within a gate any alternative (OR). One expression set per gate. */
  const displayLogic = (gates: Gate[]): Obj | null => {
    const sets: Obj = {};
    let n = 0;
    gates.forEach((g) => {
      const exprs: Obj[] = [];
      g.forEach((a, i) => exprs.push(...expression(a, i > 0 ? 'Or' : null)));
      if (!exprs.length) return;
      if (n > 0) exprs[0] = { ...exprs[0], Conjuction: 'And' };
      sets[String(n)] = { ...Object.fromEntries(exprs.map((e, i) => [String(i), e])), Type: n === 0 ? 'If' : 'And' };
      n++;
    });
    return n ? { ...sets, Type: 'BooleanExpression', inPage: false } : null;
  };

  const question = (q: Question): Obj | null => {
    const type = q['Question.Type.Display.Name'];
    const text = q['Question.Text'] || q['Question.ID'];
    const tagBase = q['Question.ID'].replace(/[^\w.]/g, '_') || `Q${qCount}`;
    let tag = tagBase;
    for (let k = 2; tagUsed.has(tag); k++) tag = `${tagBase}_${k}`;
    tagUsed.add(tag);
    const common = { QuestionText: text, DataExportTag: tag, QuestionDescription: stripHtml(text).slice(0, 100), Configuration: { QuestionDescriptionOption: 'UseText' }, Validation: { Settings: { ForceResponse: 'OFF', Type: 'None' } }, Language: [], DataVisibility: { Private: false, Hidden: false } };
    const opts = q.responseKey ?? [];
    const choices = Object.fromEntries(opts.map((r, i) => [String(i + 1), { Display: r.definition }]));
    const recodes = Object.fromEntries(opts.map((r, i) => [String(i + 1), String(r.value)]));
    const order = opts.map((_, i) => String(i + 1));
    switch (type) {
      case 'Multiple Choice':
        return { ...common, QuestionType: 'MC', Selector: 'SAVR', SubSelector: 'TX', Choices: choices, ChoiceOrder: order, RecodeValues: recodes };
      case 'Multiple Select':
        return { ...common, QuestionType: 'MC', Selector: 'MAVR', SubSelector: 'TX', Choices: choices, ChoiceOrder: order, RecodeValues: recodes };
      case 'Slider': {
        const nums = opts.map((r) => Number(r.value)).filter(Number.isFinite);
        const lo = nums.length ? Math.min(...nums) : 0;
        const hi = nums.length ? Math.max(...nums) : 100;
        const labels = Object.fromEntries(opts.map((r, i) => [String(i + 1), { Display: r.definition }]));
        return {
          ...common,
          QuestionType: 'Slider',
          Selector: 'HSLIDER',
          Choices: { '1': { Display: '' } },
          ChoiceOrder: ['1'],
          Labels: labels,
          Configuration: { QuestionDescriptionOption: 'UseText', CSSliderMin: lo, CSSliderMax: hi, GridLines: 4, SnapToGrid: false, NumDecimals: '0', ShowValue: true, MobileFirst: true },
        };
      }
      case 'Informational Fullscreen':
        return { ...common, QuestionType: 'DB', Selector: 'TB' };
      case 'Free Response':
      case 'Time Picker':
      default: {
        if (!['Free Response', 'Time Picker'].includes(type)) notes.push(`${q['Question.ID']} (${type}) has no direct Qualtrics equivalent; exported as a text entry question.`);
        const numeric = /^(integer|numeric|number)$/i.test(q['Data.Type'] ?? '');
        return { ...common, QuestionType: 'TE', Selector: 'SL', ...(numeric ? { Validation: { Settings: { ForceResponse: 'OFF', Type: 'ContentType', ContentType: 'ValidNumber' } } } : {}) };
      }
    }
  };

  for (const survey of surveys) {
    const logic = surveyLogic(survey);
    const label = survey['Survey.LongName'] || survey['Survey.Name'];
    // First pass: QIDs (display logic may point backwards only, but assign all first to be safe).
    for (const q of survey.questions ?? []) if (!isBlock(q) && !isEndBlock(q)) qids.set(q['Item.ID'], `QID${++qCount}`);
    let current: { id: string; description: string; qids: string[] } | null = null;
    let currentKey = '';
    const blockOf = (q: Question) => {
      const p = q.Parent ? logic.model.byId.get(q.Parent) : undefined;
      return p && isBlock(p) ? p : null;
    };
    for (const q of survey.questions ?? []) {
      if (isBlock(q) || isEndBlock(q)) continue;
      const b = blockOf(q);
      const key = b ? b['Item.ID'] : '(top)';
      if (!current || key !== currentKey) {
        current = { id: `BL_${blocks.length + 1}`, description: b ? `${label}: ${b['Question.Long.Name'] || b['Question.ID']}` : label, qids: [] };
        blocks.push(current);
        currentKey = key;
      }
      const qid = qids.get(q['Item.ID'])!;
      const payload = question(q);
      if (!payload) continue;
      const dl = displayLogic(logic.flat(q['Item.ID']));
      sq.push({ SurveyID: sid, Element: 'SQ', PrimaryAttribute: qid, SecondaryAttribute: stripHtml(String(payload.QuestionText)).slice(0, 100), TertiaryAttribute: null, Payload: { ...payload, QuestionID: qid, ...(dl ? { DisplayLogic: dl } : {}) } });
      current.qids.push(qid);
    }
  }

  const blPayload = Object.fromEntries(
    blocks.map((b, i) => [String(i + 1), { Type: i === 0 ? 'Default' : 'Standard', Description: b.description, ID: b.id, BlockElements: b.qids.map((q) => ({ Type: 'Question', QuestionID: q })) }]),
  );
  const flow = blocks.map((b, i) => ({ Type: i === 0 ? 'Block' : 'Standard', ID: b.id, FlowID: `FL_${i + 2}`, Autofill: [] }));
  const qsf = {
    SurveyEntry: {
      SurveyID: sid,
      SurveyName: surveys.length === 1 ? surveys[0]!['Survey.LongName'] || surveys[0]!['Survey.Name'] : spec['Study.Metadata']['Study.Name'],
      SurveyDescription: null,
      SurveyOwnerID: 'UR_dataManual',
      SurveyBrandID: '',
      DivisionID: null,
      SurveyLanguage: 'EN',
      SurveyActiveResponseSet: 'RS_dataManual',
      SurveyStatus: 'Inactive',
      SurveyStartDate: '0000-00-00 00:00:00',
      SurveyExpirationDate: '0000-00-00 00:00:00',
      SurveyCreationDate: now,
      CreatorID: 'UR_dataManual',
      LastModified: now,
      LastAccessed: '0000-00-00 00:00:00',
      LastActivated: '0000-00-00 00:00:00',
      Deleted: null,
    },
    SurveyElements: [
      { SurveyID: sid, Element: 'BL', PrimaryAttribute: 'Survey Blocks', SecondaryAttribute: null, TertiaryAttribute: null, Payload: blPayload },
      { SurveyID: sid, Element: 'FL', PrimaryAttribute: 'Survey Flow', SecondaryAttribute: null, TertiaryAttribute: null, Payload: { Type: 'Root', FlowID: 'FL_1', Flow: flow, Properties: { Count: blocks.length + 1 } } },
      {
        SurveyID: sid,
        Element: 'SO',
        PrimaryAttribute: 'Survey Options',
        SecondaryAttribute: null,
        TertiaryAttribute: null,
        Payload: { BackButton: 'false', SaveAndContinue: 'true', SurveyProtection: 'PublicSurvey', BallotBoxStuffingPrevention: 'false', NoIndex: 'Yes', SecureResponseFiles: 'true', SurveyExpiration: null, SurveyTermination: 'DefaultMessage', Header: '', Footer: '', ProgressBarDisplay: 'None', PartialData: '+1 week', ValidationMessage: null, PreviousButton: ' ← ', NextButton: ' → ', SurveyTitle: 'Qualtrics Survey | Qualtrics Experience Management', SkinLibrary: 'Default', SkinType: 'MQ', Skin: 'Default', NewScoring: 1 },
      },
      { SurveyID: sid, Element: 'QC', PrimaryAttribute: 'Survey Question Count', SecondaryAttribute: String(sq.length), TertiaryAttribute: null, Payload: null },
      ...sq,
    ],
  };
  notes.push('Import in Qualtrics: create a project → "From a file" (or Survey → Tools → Import/Export → Import Survey). Check display logic in the survey flow after import.');
  const name = (surveys.length === 1 ? surveys[0]!['Survey.Name'] : spec['Study.Metadata']['Study.Name']).replace(/[^\w-]+/g, '_');
  return { fileName: `${name}.qsf`, text: JSON.stringify(qsf, null, 2), mime: 'application/json', notes };
}

export type { Survey };
