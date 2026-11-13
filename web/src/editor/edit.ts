// Survey editing operations for the Survey Editor. Pure: each takes a survey and returns a new one.
// Questions are kept as a tree (block -> members) in spec order; every operation rebuilds the flat
// questions array from that tree, so block members always follow their block.
import { isBlock, isEndBlock, type Question, type Survey } from '../core';
import { surveyLogic, type Op } from '../exporters/logic';

export type SkipRule = { parentId: string; kind: 'in'; values: string[] } | { parentId: string; kind: 'cmp'; op: Op; value: string };

const OP_CODE: Record<Op, '1' | '2' | '3' | '4' | '5' | '6'> = { '=': '1', '<=': '2', '>=': '3', '<': '4', '>': '5', '!=': '6' };

interface Node {
  q: Question;
  kids: Node[];
}

function tree(survey: Survey): Node[] {
  const qs = survey.questions ?? [];
  const byId = new Map(qs.map((q) => [q['Item.ID'], q]));
  const nodes = new Map<string, Node>();
  const roots: Node[] = [];
  for (const q of qs) nodes.set(q['Item.ID'], { q, kids: [] });
  for (const q of qs) {
    const parent = q.Parent ? byId.get(q.Parent) : undefined;
    const n = nodes.get(q['Item.ID'])!;
    if (parent && isBlock(parent) && parent !== q) nodes.get(parent['Item.ID'])!.kids.push(n);
    else roots.push(n);
  }
  return roots;
}

function flatten(nodes: Node[]): Question[] {
  const out: Question[] = [];
  const walk = (list: Node[]) => {
    // End Block markers stay last inside their block.
    for (const n of [...list.filter((x) => !isEndBlock(x.q)), ...list.filter((x) => isEndBlock(x.q))]) {
      out.push(n.q);
      walk(n.kids);
    }
  };
  walk(nodes);
  return out;
}

function find(nodes: Node[], id: string, parent: Node[] = nodes): { list: Node[]; index: number } | null {
  const i = parent.findIndex((n) => n.q['Item.ID'] === id);
  if (i >= 0) return { list: parent, index: i };
  for (const n of parent) {
    const hit = find(nodes, id, n.kids);
    if (hit) return hit;
  }
  return null;
}

const withQuestions = (survey: Survey, questions: Question[]): Survey => ({ ...survey, questions });

/** Item.IDs inside a block (any depth). */
export function descendants(survey: Survey, blockId: string): Set<string> {
  const hit = find(tree(survey), blockId);
  const out = new Set<string>();
  const walk = (n: Node) => n.kids.forEach((k) => (out.add(k.q['Item.ID']), walk(k)));
  if (hit) walk(hit.list[hit.index]!);
  return out;
}

export function updateItem(survey: Survey, itemId: string, patch: Partial<Question>): Survey {
  return withQuestions(survey, (survey.questions ?? []).map((q) => (q['Item.ID'] === itemId ? ({ ...q, ...patch } as Question) : q)));
}

export function uniqueId(survey: Survey, base: string): string {
  const used = new Set((survey.questions ?? []).flatMap((q) => [q['Item.ID'], q['Question.ID']]));
  const clean = base.replace(/[^\w.-]+/g, '_') || 'item';
  let id = clean;
  for (let k = 2; used.has(id); k++) id = `${clean}_${k}`;
  return id;
}

/** Add a question or block after `afterId` (same block), or at the end of `intoBlock` / the survey. */
export function addItem(survey: Survey, kind: 'question' | 'block', opts: { afterId?: string | null; intoBlock?: string | null } = {}): { survey: Survey; itemId: string } {
  const prefix = (survey['Survey.Name'] || 'q').replace(/[^\w]+/g, '_').slice(0, 3).toLowerCase();
  const itemId = uniqueId(survey, kind === 'block' ? `${prefix}_block` : `${prefix}_q${(survey.questions ?? []).filter((q) => !isBlock(q)).length + 1}`);
  const roots = tree(survey);
  let list = roots;
  let index = roots.length;
  let parent: string | null = null;
  if (opts.afterId) {
    const hit = find(roots, opts.afterId);
    if (hit) {
      list = hit.list;
      index = hit.index + 1;
      parent = hit.list[hit.index]!.q.Parent ?? null;
      const owner = parent ? (survey.questions ?? []).find((q) => q['Item.ID'] === parent) : undefined;
      if (!owner || !isBlock(owner)) parent = null;
    }
  } else if (opts.intoBlock) {
    const hit = find(roots, opts.intoBlock);
    if (hit) {
      list = hit.list[hit.index]!.kids;
      index = list.filter((n) => !isEndBlock(n.q)).length;
      parent = opts.intoBlock;
    }
  }
  const q: Question =
    kind === 'block'
      ? ({ 'Item.ID': itemId, 'Question.ID': itemId, 'Item.Type': 'Block', 'Question.Type.Display.Name': 'Block', 'Question.Long.Name': 'New block', Parent: parent } as unknown as Question)
      : ({ 'Item.ID': itemId, 'Question.ID': itemId, 'Item.Type': 'Question', 'Question.Type.Display.Name': 'Multiple Choice', 'Question.Text': 'New question', Parent: parent, 'Data.Type': 'integer', responseKey: [{ value: '1', definition: 'Yes' }, { value: '0', definition: 'No' }] } as unknown as Question);
  list.splice(index, 0, { q, kids: [] });
  return { survey: withQuestions(survey, flatten(roots)), itemId };
}

/** Remove an item (a block takes its members with it) and every skip-logic reference to it. */
export function deleteItem(survey: Survey, itemId: string): Survey {
  const gone = new Set([itemId, ...descendants(survey, itemId)]);
  const questions = (survey.questions ?? [])
    .filter((q) => !gone.has(q['Item.ID']))
    .map((q) => {
      const ci = q['Conditional.Info'];
      if (!ci) return q;
      const next = { ...ci };
      if (next['Conditional.Child.Mappings']) next['Conditional.Child.Mappings'] = next['Conditional.Child.Mappings'].filter((m) => !gone.has(m['Conditional.Child.Item.ID']));
      if (next['Conditional.Master.Item.ID'] && gone.has(next['Conditional.Master.Item.ID'])) {
        next['Conditional.Master.Item.ID'] = null;
        next['Conditional.Type'] = null;
        next['Conditional.Threshold'] = null;
      }
      if (next['Conditional.Fail.Item.ID'] && gone.has(next['Conditional.Fail.Item.ID'])) next['Conditional.Fail.Item.ID'] = null;
      return { ...q, 'Conditional.Info': next };
    });
  return withQuestions(survey, questions);
}

/** Move an item (with its members) up or down among its siblings. */
export function moveItem(survey: Survey, itemId: string, dir: -1 | 1): Survey {
  const roots = tree(survey);
  const hit = find(roots, itemId);
  if (!hit) return survey;
  const j = hit.index + dir;
  if (j < 0 || j >= hit.list.length) return survey;
  [hit.list[hit.index], hit.list[j]] = [hit.list[j]!, hit.list[hit.index]!];
  return withQuestions(survey, flatten(roots));
}

/** Put an item into a block (at its end) or back at the top level of the survey. */
export function setBlock(survey: Survey, itemId: string, blockId: string | null): Survey {
  if (blockId === itemId || (blockId && descendants(survey, itemId).has(blockId))) return survey;
  const roots = tree(survey);
  const hit = find(roots, itemId);
  if (!hit) return survey;
  const [node] = hit.list.splice(hit.index, 1);
  node!.q = { ...node!.q, Parent: blockId };
  if (blockId) {
    const b = find(roots, blockId);
    if (!b) return survey;
    const kids = b.list[b.index]!.kids;
    kids.splice(kids.filter((n) => !isEndBlock(n.q)).length, 0, node!);
  } else roots.push(node!);
  return withQuestions(survey, flatten(roots));
}

/** The item's own show-condition, if it has a simple one. */
export function getSkipRule(survey: Survey, itemId: string): SkipRule | null {
  const alts = surveyLogic(survey).own(itemId);
  const a = alts[0];
  if (!a) return null;
  if (a.kind === 'cmp') return { parentId: a.parent['Item.ID'], kind: 'cmp', op: a.op, value: a.value };
  const sameParent = alts.filter((x) => x.kind === 'in' && x.parent === a.parent).flatMap((x) => (x.kind === 'in' ? x.values : []));
  return { parentId: a.parent['Item.ID'], kind: 'in', values: [...new Set(sameParent)] };
}

/** Replace the item's show-condition (null: always shown). */
export function setSkipRule(survey: Survey, itemId: string, rule: SkipRule | null): Survey {
  const qs = survey.questions ?? [];
  const parent = rule ? qs.find((q) => q['Item.ID'] === rule.parentId) : undefined;
  const labelOf = (v: string) => parent?.responseKey?.find((r) => String(r.value) === v)?.definition ?? v;
  const questions = qs.map((q) => {
    const ci = { ...(q['Conditional.Info'] ?? {}) } as NonNullable<Question['Conditional.Info']>;
    let changed = false;
    // Drop every mapping into this item.
    if (ci['Conditional.Child.Mappings']?.some((m) => m['Conditional.Child.Item.ID'] === itemId)) {
      ci['Conditional.Child.Mappings'] = ci['Conditional.Child.Mappings'].filter((m) => m['Conditional.Child.Item.ID'] !== itemId);
      changed = true;
    }
    if (rule && rule.kind === 'in' && q['Item.ID'] === rule.parentId) {
      ci['Conditional.Child.Mappings'] = [...(ci['Conditional.Child.Mappings'] ?? []), ...rule.values.map((v) => ({ 'Conditional.Child.Item.ID': itemId, Definition: labelOf(v) }))];
      if (q['Question.Type.Display.Name'] === 'Multiple Select') (ci as Record<string, unknown>)['Multi.Conditional'] = true;
      changed = true;
    }
    if (q['Item.ID'] === itemId) {
      ci['Conditional.Master.Item.ID'] = rule ? rule.parentId : null;
      ci['Conditional.Type'] = rule ? (rule.kind === 'cmp' ? OP_CODE[rule.op] : '1') : null;
      ci['Conditional.Threshold'] = rule ? (rule.kind === 'cmp' ? rule.value : (rule.values[0] ?? null)) : null;
      changed = true;
    }
    if (!changed) return q;
    if (ci['Conditional.Child.Mappings']?.length === 0) ci['Conditional.Child.Mappings'] = null;
    return { ...q, 'Conditional.Info': ci };
  });
  return withQuestions(survey, questions);
}

/** Questions that can control `itemId`: earlier in the survey, not the item or anything inside it. */
export function possibleParents(survey: Survey, itemId: string): Question[] {
  const qs = survey.questions ?? [];
  const at = qs.findIndex((q) => q['Item.ID'] === itemId);
  const inside = descendants(survey, itemId);
  return qs.slice(0, at < 0 ? qs.length : at).filter((q) => !isBlock(q) && !isEndBlock(q) && !inside.has(q['Item.ID']) && q['Question.Type.Display.Name'] !== 'Informational Fullscreen');
}

/**
 * Put the chosen items into a new block, placed where the first of them was. Items inside another
 * chosen block move with it. Returns the new block's Item.ID (null when nothing was chosen).
 */
export function groupIntoBlock(survey: Survey, itemIds: string[], name: string): { survey: Survey; blockId: string | null } {
  const chosen = new Set(itemIds);
  const inOrder = (survey.questions ?? []).map((q) => q['Item.ID']).filter((id) => chosen.has(id));
  const keep = inOrder.filter((id) => !inOrder.some((other) => other !== id && descendants(survey, other).has(id)));
  if (!keep.length) return { survey, blockId: null };
  const roots = tree(survey);
  const first = find(roots, keep[0]!)!;
  const firstQ = first.list[first.index]!.q;
  const parentQ = firstQ.Parent ? (survey.questions ?? []).find((q) => q['Item.ID'] === firstQ.Parent) : undefined;
  const parent = parentQ && isBlock(parentQ) ? parentQ['Item.ID'] : null;
  const blockId = uniqueId(survey, `${name.trim() || 'block'}`.toLowerCase().replace(/\s+/g, '_').slice(0, 30));
  const block = {
    // The schema keeps question-only fields (text, data type, options) off blocks.
    q: { 'Item.ID': blockId, 'Question.ID': blockId, 'Item.Type': 'Block', 'Question.Type.Display.Name': 'Block', 'Question.Long.Name': name.trim() || 'New block', Parent: parent } as unknown as Question,
    kids: [] as Node[],
  };
  first.list.splice(first.index, 0, block);
  for (const id of keep) {
    const hit = find(roots, id);
    if (!hit) continue;
    const [node] = hit.list.splice(hit.index, 1);
    node!.q = { ...node!.q, Parent: blockId };
    block.kids.push(node!);
  }
  return { survey: withQuestions(survey, flatten(roots)), blockId };
}

/**
 * Copy a question (from this or another survey) into `survey` with fresh IDs: after `afterId`, at
 * the end of `intoBlock`, or at the end of the survey. Skip logic isn't copied, since the questions
 * it pointed at belong to the original survey.
 */
export function copyQuestion(survey: Survey, q: Question, at: { afterId?: string | null; intoBlock?: string | null } = {}): { survey: Survey; itemId: string } {
  // Make room with a placeholder in the right place, then put the copy there.
  const placed = addItem(survey, 'question', at);
  const holder = placed.survey.questions!.find((x) => x['Item.ID'] === placed.itemId)!;
  const itemId = uniqueId(survey, q['Question.ID'] || q['Item.ID']);
  const ci = q['Conditional.Info'];
  const copy = {
    ...q,
    'Item.ID': itemId,
    'Question.ID': itemId,
    Parent: holder.Parent ?? null,
    ...(ci ? { 'Conditional.Info': { ...ci, 'Conditional.Master.Item.ID': null, 'Conditional.Type': null, 'Conditional.Threshold': null, 'Conditional.Child.Mappings': null } } : {}),
  } as Question;
  return { survey: withQuestions(placed.survey, placed.survey.questions!.map((x) => (x === holder ? copy : x))), itemId };
}
