// Skip logic in a platform-neutral form, for the exporters. Each item gets a list of "gates" (all must
// hold); a gate is a set of alternatives (any may hold). An alternative compares one parent question's
// answer: one of these response codes, or a numeric comparison.
import { COMPARATORS, buildSurveyModel, isBlock, type Question, type Survey, type SurveyModel } from '../core';

export type Op = '=' | '<=' | '>=' | '<' | '>' | '!=';
export type Alt = { kind: 'in'; parent: Question; values: string[] } | { kind: 'cmp'; parent: Question; op: Op; value: string };

/** Alternatives (OR) for one gate. */
export type Gate = Alt[];

export interface SurveyLogic {
  model: SurveyModel;
  /** Conditions written on the item itself: shown when any alternative holds. */
  own(itemId: string): Gate;
  /**
   * Everything that must hold for the item to be shown, flattened for platforms without nested
   * blocks: its own gate plus the gates of enclosing blocks, unless the item's own condition already
   * implies them (its parent question sits inside that block).
   */
  flat(itemId: string): Gate[];
}

const codeFor = (parent: Question, labelOrValue: string): string =>
  (parent.responseKey ?? []).find((r) => r.definition === labelOrValue)?.value ?? labelOrValue;

export const isMulti = (q: Question) => q['Question.Type.Display.Name'] === 'Multiple Select';
export const isNumericType = (q: Question) => /^(integer|numeric|number|double|float)$/i.test(q['Data.Type'] ?? '') || q['Question.Type.Display.Name'] === 'Slider';

export function surveyLogic(survey: Survey): SurveyLogic {
  const model = buildSurveyModel(survey);
  const own = (itemId: string): Gate => {
    const item = model.byId.get(itemId);
    const ci = item?.['Conditional.Info'];
    const alts: Gate = [];
    for (const b of model.branchesTo.get(itemId) ?? []) {
      const parent = model.byId.get(b.parentId);
      if (!parent) continue;
      const op = ci?.['Conditional.Master.Item.ID'] === b.parentId ? COMPARATORS[ci['Conditional.Type'] ?? ''] : undefined;
      const threshold = ci?.['Conditional.Threshold'];
      if (op && op !== '=' && threshold != null && threshold !== '') {
        alts.push({ kind: 'cmp', parent, op: op as Op, value: String(threshold) });
      } else if (b.definitions.length) {
        alts.push({ kind: 'in', parent, values: [...new Set(b.definitions.map((d) => codeFor(parent, d)))] });
      } else if (threshold != null && threshold !== '') {
        alts.push({ kind: 'in', parent, values: [String(threshold)] });
      }
    }
    return alts;
  };

  const inside = (qId: string, blockId: string): boolean => {
    for (let q = model.byId.get(qId); q?.Parent; q = model.byId.get(q.Parent)) if (q.Parent === blockId) return true;
    return false;
  };

  const flat = (itemId: string): Gate[] => {
    const gates: Gate[] = [];
    const mine = own(itemId);
    if (mine.length) gates.push(mine);
    const openers = mine.map((a) => a.parent['Item.ID']);
    for (let q = model.byId.get(itemId); q?.Parent; ) {
      const block = model.byId.get(q.Parent);
      if (!block || !isBlock(block)) break;
      const g = own(block['Item.ID']);
      if (g.length && !openers.some((o) => inside(o, block['Item.ID']))) gates.push(g);
      q = block;
    }
    return gates;
  };

  return { model, own, flat };
}

/** Plain-language version, for notes. */
export function describeAlt(a: Alt): string {
  const id = a.parent['Question.ID'];
  if (a.kind === 'cmp') return `${id} ${a.op} ${a.value}`;
  return `${id} ${isMulti(a.parent) ? 'includes' : 'is'} ${a.values.join(' or ')}`;
}
