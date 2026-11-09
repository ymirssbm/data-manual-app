// Read-side helpers over a StudySpec, shared by every generator.
// Everything derived (block membership, skip-logic relationships, response
// ranges) is computed here once so generators don't each re-interpret the spec.
import type { BlockMapEntry, Question, StudySpec, Survey } from './spec';

/** Comparator codes used by Conditional.Type, in schema order. */
export const COMPARATORS: Record<string, string> = { '1': '=', '2': '<=', '3': '>=', '4': '<', '5': '>', '6': '!=' };

export const isBlock = (q: Question) => q['Item.Type'] === 'Block';
export const isEndBlock = (q: Question) => q['Question.Type.Display.Name'] === 'End Block';
export const isQuestion = (q: Question) => q['Item.Type'] === 'Question' && !isEndBlock(q);

/** Human label for an item: its text, or for blocks a long name / ID. */
export function itemLabel(q: Question): string {
  if (isBlock(q)) return q['Question.Long.Name'] || q['Question.ID'] || q['Item.ID'];
  return stripHtml(q['Question.Text'] ?? '') || q['Question.Long.Name'] || q['Question.ID'];
}

export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ResponseOption {
  value: string;
  label: string;
}

export function responseOptions(q: Question): ResponseOption[] {
  return (q.responseKey ?? []).map((r) => ({ value: String(r.value), label: r.definition }));
}

/** "min - max" when every response value is numeric, else null. */
export function responseRange(q: Question): string | null {
  const nums = responseOptions(q).map((o) => Number(o.value));
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n))) return null;
  return `${Math.min(...nums)} - ${Math.max(...nums)}`;
}

/** Label for a stored response value, falling back to the value itself. */
export function labelForValue(q: Question, value: string): string {
  return responseOptions(q).find((o) => o.value === value)?.label ?? value;
}

/** One conditional relationship: `parent` shows `child` when the condition holds. */
export interface Branch {
  parentId: string;
  childId: string;
  /** Response labels that route to the child (from Child.Mappings), if known. */
  definitions: string[];
  /** Fallback condition text from the child's own Conditional.Info, e.g. "= 1". */
  condition: string | null;
}

export interface SurveyModel {
  survey: Survey;
  name: string;
  label: string;
  /** All items in spec order, excluding End Block markers. */
  items: Question[];
  byId: Map<string, Question>;
  /** Block Item.ID -> direct members, in order. */
  members: Map<string, Question[]>;
  branches: Branch[];
  /** parent Item.ID -> branches out of it */
  branchesFrom: Map<string, Branch[]>;
  /** child Item.ID -> branches into it */
  branchesTo: Map<string, Branch[]>;
  /** Item.ID -> Conditional.Fail.Item.ID, for parents that have one */
  failTargets: Map<string, string>;
}

export function buildSurveyModel(survey: Survey): SurveyModel {
  const items = (survey.questions ?? []).filter((q) => !isEndBlock(q));
  const byId = new Map(items.map((q) => [q['Item.ID'], q]));

  const members = new Map<string, Question[]>();
  for (const q of items) {
    if (q.Parent && byId.get(q.Parent) && isBlock(byId.get(q.Parent)!)) {
      const list = members.get(q.Parent) ?? [];
      list.push(q);
      members.set(q.Parent, list);
    }
  }

  // Branches come from two places that specs fill in inconsistently: the
  // parent's Child.Mappings, and the child's own Master.Item.ID. Merge both.
  const key = (p: string, c: string) => `${p}\u0000${c}`;
  const merged = new Map<string, Branch>();
  const failTargets = new Map<string, string>();
  for (const q of items) {
    const ci = q['Conditional.Info'];
    if (!ci) continue;
    for (const m of ci['Conditional.Child.Mappings'] ?? []) {
      const childId = m['Conditional.Child.Item.ID'];
      if (!byId.has(childId) || childId === q['Item.ID']) continue;
      const k = key(q['Item.ID'], childId);
      const b = merged.get(k) ?? { parentId: q['Item.ID'], childId, definitions: [], condition: null };
      if (m.Definition && !b.definitions.includes(m.Definition)) b.definitions.push(m.Definition);
      merged.set(k, b);
    }
    const fail = ci['Conditional.Fail.Item.ID'];
    if (fail && byId.has(fail)) failTargets.set(q['Item.ID'], fail);
  }
  for (const q of items) {
    const ci = q['Conditional.Info'];
    const master = ci?.['Conditional.Master.Item.ID'];
    if (!ci || !master || master === q['Item.ID'] || !byId.has(master)) continue;
    const k = key(master, q['Item.ID']);
    const b = merged.get(k) ?? { parentId: master, childId: q['Item.ID'], definitions: [], condition: null };
    const op = COMPARATORS[ci['Conditional.Type'] ?? ''] ?? '=';
    const threshold = ci['Conditional.Threshold'];
    if (threshold != null && threshold !== '') {
      const label = labelForValue(byId.get(master)!, threshold);
      b.condition = label !== threshold ? `${op} ${threshold} (${label})` : `${op} ${threshold}`;
    }
    merged.set(k, b);
  }

  const branches = [...merged.values()];
  const group = (pick: (b: Branch) => string) => {
    const m = new Map<string, Branch[]>();
    for (const b of branches) m.set(pick(b), [...(m.get(pick(b)) ?? []), b]);
    return m;
  };

  return {
    survey,
    name: survey['Survey.Name'],
    label: survey['Survey.LongName'] || survey['Survey.Name'],
    items,
    byId,
    members,
    branches,
    branchesFrom: group((b) => b.parentId),
    branchesTo: group((b) => b.childId),
    failTargets,
  };
}

/** Human-readable description of when an item is shown, or null if always shown. */
export function shownWhen(model: SurveyModel, itemId: string): string | null {
  const parts: string[] = [];
  // An item is conditional if it, or any block containing it, is a branch target.
  let cur: Question | undefined = model.byId.get(itemId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur['Item.ID'])) {
    seen.add(cur['Item.ID']);
    for (const b of model.branchesTo.get(cur['Item.ID']) ?? []) {
      const parent = model.byId.get(b.parentId);
      const pname = parent ? parent['Question.ID'] : b.parentId;
      if (b.definitions.length) parts.push(`${pname} is ${b.definitions.map((d) => `"${d}"`).join(' or ')}`);
      else if (b.condition) parts.push(`${pname} ${b.condition}`);
      else parts.push(`${pname} meets its condition`);
    }
    cur = cur.Parent ? model.byId.get(cur.Parent) : undefined;
  }
  return parts.length ? parts.join('; and ') : null;
}

/** Items this item can trigger, described for display. */
export function triggers(model: SurveyModel, itemId: string): string[] {
  return (model.branchesFrom.get(itemId) ?? []).map((b) => {
    const child = model.byId.get(b.childId);
    const name = child ? (isBlock(child) ? `block ${itemLabel(child)}` : child['Question.ID']) : b.childId;
    const when = b.definitions.length ? b.definitions.map((d) => `"${d}"`).join(' or ') : (b.condition ?? 'condition met');
    return `${when} → ${name}`;
  });
}

/** Block chain for an item, outermost first (labels). */
export function blockPath(model: SurveyModel, q: Question): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let parentId = q.Parent;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const p = model.byId.get(parentId);
    if (!p) break;
    if (isBlock(p)) path.unshift(itemLabel(p));
    parentId = p.Parent;
  }
  return path;
}

/** Derive blockMap entries from surveys. Translators use this so blockMap never drifts from Parent. */
export function buildBlockMap(surveys: Survey[]): BlockMapEntry[] {
  return surveys.flatMap((s) =>
    (s.questions ?? []).map((q) => ({
      'Survey.Name': s['Survey.Name'],
      'Item.ID': q['Item.ID'],
      'Item.Type': q['Item.Type'] === 'Block' ? ('Block' as const) : ('Question' as const),
      Parent: q.Parent ?? null,
    })),
  );
}

export function surveyModels(spec: StudySpec): SurveyModel[] {
  return spec.surveys.map(buildSurveyModel);
}
