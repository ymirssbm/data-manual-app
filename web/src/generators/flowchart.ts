// Spec -> Mermaid flowchart for one survey.
//
// Flow rules (rewritten from the prior tool, which tracked "parent"/"child"
// flags on a flat table):
//  - Every item has a "gate chain": the conditional units (branch targets,
//    or blocks that are branch targets) it sits inside, outermost first.
//  - An item flows to the next item whose gate chain is a prefix of its own:
//    it stays inside its branch, or rejoins the enclosing path once the branch ends.
//  - Items with branches get a decision diamond with one labelled edge per
//    child, plus an "Otherwise" edge (the fail item, or wherever flow continues).
//  - Blocks are drawn as subgraphs around their members rather than as nodes.
import { buildSurveyModel, isBlock, itemLabel, type Question, type SurveyModel, type Survey } from '../core';

export interface FlowchartOptions {
  /** Max characters per line inside a node. */
  wrap?: number;
  /** Show Question.ID above the text. */
  showIds?: boolean;
  direction?: 'TD' | 'LR';
}

export function generateFlowchart(survey: Survey, opts: FlowchartOptions = {}): string {
  const { wrap = 32, showIds = false, direction = 'TD' } = opts;
  const model = buildSurveyModel(survey);
  const order = model.items;
  const index = new Map(order.map((q, i) => [q['Item.ID'], i]));

  const nodeId = new Map(order.map((q, i) => [q['Item.ID'], `n${i}`]));
  const isTarget = (id: string) => (model.branchesTo.get(id)?.length ?? 0) > 0;

  // Gate chain: walk up Parent links collecting conditional ancestors (incl. self).
  const gates = new Map<string, string[]>();
  for (const q of order) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: Question | undefined = q;
    while (cur && !seen.has(cur['Item.ID'])) {
      seen.add(cur['Item.ID']);
      if (isTarget(cur['Item.ID'])) chain.unshift(cur['Item.ID']);
      cur = cur.Parent ? model.byId.get(cur.Parent) : undefined;
    }
    gates.set(q['Item.ID'], chain);
  }
  const isPrefix = (a: string[], b: string[]) => a.length <= b.length && a.every((g, i) => b[i] === g);

  /** Next drawable item after position `from` whose gate chain is a prefix of `chain`. */
  const nextFrom = (from: number, chain: string[]): Question | undefined => {
    for (let i = from + 1; i < order.length; i++) {
      const q = order[i]!;
      if (isBlock(q)) continue;
      if (isPrefix(gates.get(q['Item.ID'])!, chain)) return q;
    }
    return undefined;
  };

  /** Where an edge "into" an item actually lands: blocks resolve to their first drawable member. */
  const entry = (id: string): Question | undefined => {
    const q = model.byId.get(id);
    if (!q) return undefined;
    if (!isBlock(q)) return q;
    const start = index.get(id)!;
    for (let i = start + 1; i < order.length; i++) {
      const m = order[i]!;
      if (!isInside(m, id)) break;
      if (!isBlock(m)) return m;
    }
    return undefined;
  };
  const isInside = (q: Question, blockId: string): boolean => {
    const seen = new Set<string>();
    let p = q.Parent;
    while (p && !seen.has(p)) {
      if (p === blockId) return true;
      seen.add(p);
      p = model.byId.get(p)?.Parent ?? null;
    }
    return false;
  };

  const lines: string[] = [`flowchart ${direction}`];
  const edges: string[] = [];
  const edgeSet = new Set<string>();
  const addEdge = (from: string, to: string, label?: string) => {
    const e = label ? `  ${from} -->|"${escapeLabel(label)}"| ${to}` : `  ${from} --> ${to}`;
    if (!edgeSet.has(e)) {
      edgeSet.add(e);
      edges.push(e);
    }
  };

  // Nodes, nested inside block subgraphs.
  const renderNode = (q: Question) =>
    `${nodeId.get(q['Item.ID'])}["${escapeLabel(nodeText(q, wrap, showIds))}"]`;
  const renderBlock = (block: Question, depth: number): string[] => {
    const pad = '  '.repeat(depth);
    const out = [`${pad}subgraph ${nodeId.get(block['Item.ID'])}_g["${escapeLabel(wrapText(itemLabel(block), 40))}"]`];
    for (const m of model.members.get(block['Item.ID']) ?? []) {
      if (isBlock(m)) out.push(...renderBlock(m, depth + 1));
      else out.push(`${pad}  ${renderNode(m)}`);
    }
    out.push(`${pad}end`);
    return out;
  };
  for (const q of order) {
    const parent = q.Parent ? model.byId.get(q.Parent) : undefined;
    if (parent && isBlock(parent)) continue; // drawn inside its block
    if (isBlock(q)) lines.push(...renderBlock(q, 1));
    else lines.push(`  ${renderNode(q)}`);
  }

  // Edges.
  const start = order.find((q) => !isBlock(q) && gates.get(q['Item.ID'])!.length === 0);
  if (start) {
    lines.push('  start(["Start"])');
    addEdge('start', nodeId.get(start['Item.ID'])!);
  }
  let endUsed = false;
  const target = (q: Question | undefined) => {
    if (q) return nodeId.get(q['Item.ID'])!;
    endUsed = true;
    return 'finish';
  };

  order.forEach((q, i) => {
    if (isBlock(q)) return;
    const id = nodeId.get(q['Item.ID'])!;
    const chain = gates.get(q['Item.ID'])!;
    const next = nextFrom(i, chain);
    const branches = model.branchesFrom.get(q['Item.ID']) ?? [];

    if (branches.length === 0) {
      addEdge(id, target(next));
      return;
    }
    const decision = `${id}_d`;
    lines.push(`  ${decision}{" "}`);
    addEdge(id, decision);
    for (const b of branches) {
      const label = b.definitions.length ? b.definitions.join(' / ') : (b.condition ?? 'Yes');
      addEdge(decision, target(entry(b.childId)), wrapText(label, 24));
    }
    const failId = model.failTargets.get(q['Item.ID']);
    addEdge(decision, target(failId ? entry(failId) : next), 'Otherwise');
  });

  if (endUsed) lines.push('  finish(["End"])');
  lines.push(...edges);
  return lines.join('\n');
}

function nodeText(q: Question, wrap: number, showIds: boolean): string {
  const text = wrapText(itemLabel(q), wrap);
  const type = q['Question.Type.Display.Name'];
  // Plain text + <br/> only: rendered as SVG <text>, so exports (PNG, codebook) stay self-contained.
  const head = showIds ? `${q['Question.ID']} · ${type}<br/>` : '';
  return head + text;
}

export function wrapText(text: string, width: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('<br/>');
}

/** Mermaid label text inside ["..."]: escape quotes and characters that break parsing. */
function escapeLabel(s: string): string {
  return s.replace(/"/g, '#quot;').replace(/\|/g, '#124;').replace(/[{}]/g, (c) => (c === '{' ? '#123;' : '#125;'));
}

export type { SurveyModel };
