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
import { buildSurveyModel, floatingBlocksInto, isBlock, isQuestion, itemLabel, type Question, type StudySpec, type SurveyModel, type Survey } from '../core';

export interface FlowchartOptions {
  /** Max characters per line inside a node. */
  wrap?: number;
  /** Show Question.ID above the text. */
  showIds?: boolean;
  direction?: 'TD' | 'LR';
  /** Block Item.IDs drawn folded into a single node. */
  collapsed?: string[];
  /** Survey names to labels (for floating blocks' survey lists). */
  surveyLabel?(name: string): string;
  /** Floating blocks from other surveys that can be asked in this one, drawn after Start. */
  floatingIn?: Array<{ label: string; from: string }>;
}

/** The study-wide context a survey's flowchart needs: survey labels, and floating blocks that land in it. */
export function flowchartContext(spec: StudySpec, surveyName: string): Pick<FlowchartOptions, 'surveyLabel' | 'floatingIn'> {
  const surveyLabel = (n: string) => spec.surveys.find((s) => s['Survey.Name'] === n)?.['Survey.LongName'] || n;
  return { surveyLabel, floatingIn: floatingBlocksInto(spec, surveyName).map(({ survey, block }) => ({ label: itemLabel(block), from: surveyLabel(survey['Survey.Name']) })) };
}

export interface FlowchartBlock {
  itemId: string;
  label: string;
  /** Questions inside (including nested blocks). */
  questions: number;
  /** Mermaid ids of this block when expanded (subgraph) and folded (node). */
  clusterId: string;
  collapsedId: string;
}

/** Blocks in a survey, with the ids the rendered flowchart uses for them (for click-to-fold). */
export function flowchartBlocks(survey: Survey): FlowchartBlock[] {
  const model = buildSurveyModel(survey);
  const count = (id: string): number => (model.members.get(id) ?? []).reduce((n, m) => n + (isBlock(m) ? count(m['Item.ID']) : 1), 0);
  return model.items
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => isBlock(q))
    .map(({ q, i }) => ({ itemId: q['Item.ID'], label: itemLabel(q), questions: count(q['Item.ID']), clusterId: `n${i}_g`, collapsedId: `n${i}_c` }));
}

/** Questions in a survey with the Mermaid node id each is drawn as (for click-to-inspect). */
export function flowchartQuestionNodes(survey: Survey): Array<{ itemId: string; nodeId: string }> {
  return buildSurveyModel(survey)
    .items.map((q, i) => ({ q, i }))
    .filter(({ q }) => isQuestion(q))
    .map(({ q, i }) => ({ itemId: q['Item.ID'], nodeId: `n${i}` }));
}

export function generateFlowchart(survey: Survey, opts: FlowchartOptions = {}): string {
  const { wrap = 32, showIds = false, direction = 'TD' } = opts;
  const collapsed = new Set(opts.collapsed ?? []);
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

  /** Outermost folded block containing an item (or the item itself when it's a folded block). */
  const owner = (q: Question): Question | undefined => {
    let found: Question | undefined;
    const seen = new Set<string>();
    let cur: Question | undefined = q;
    while (cur && !seen.has(cur['Item.ID'])) {
      seen.add(cur['Item.ID']);
      if (isBlock(cur) && collapsed.has(cur['Item.ID'])) found = cur;
      cur = cur.Parent ? model.byId.get(cur.Parent) : undefined;
    }
    return found;
  };
  /** Map an item/decision node id onto its folded block's node. */
  const remap = (id: string): string => {
    const m = /^n(\d+)(?:_d\d*)?$/.exec(id);
    if (!m) return id;
    const own = owner(order[Number(m[1])]!);
    return own ? `${nodeId.get(own['Item.ID'])}_c` : id;
  };

  const lines: string[] = [`flowchart ${direction}`];
  const edges: string[] = [];
  const edgeSet = new Set<string>();
  const addEdge = (rawFrom: string, rawTo: string, label?: string) => {
    const from = remap(rawFrom);
    const to = remap(rawTo);
    if (from === to) return; // both ends inside the same folded block
    const e = label ? `  ${from} -->|"${escapeLabel(label)}"| ${to}` : `  ${from} --> ${to}`;
    if (!edgeSet.has(e)) {
      edgeSet.add(e);
      edges.push(e);
    }
  };

  // Nodes, nested inside block subgraphs.
  /** Decision diamonds per question, declared next to the question so they stay inside its block. */
  const decisions = new Map<string, string[]>();
  const renderNode = (q: Question, pad = '  ') =>
    [`${nodeId.get(q['Item.ID'])}["${escapeLabel(nodeText(q, wrap, showIds))}"]`, ...(decisions.get(q['Item.ID']) ?? [])].join(`\n${pad}`);
  /** A block title's second line: how it repeats or floats. */
  const label = opts.surveyLabel ?? ((n: string) => n);
  const blockTag = (block: Question): string => {
    const r = block['Block.Repeat'];
    const qid = (id?: string) => (id ? (model.byId.get(id)?.['Question.ID'] ?? id) : '?');
    const parts: string[] = [];
    if (r?.Type === 'Fixed') parts.push(`↻ repeated ${r.Count ?? '?'} times`);
    if (r?.Type === 'Per.Answer') parts.push(`↻ once per answer to ${qid(r['Source.Item.ID'])}`);
    if (r?.Type === 'Until') parts.push(`↻ until ${qid(r['Stop.Item.ID'])} = ${r['Stop.Value'] ?? '?'}`);
    const f = block['Block.Float'];
    if (f) parts.push(`⇢ floats: ${f.Surveys.map(label).join(' → ')}`);
    return parts.map((x) => `<br/>${wrapText(x, 44)}`).join('');
  };
  const questionsIn = (id: string): number => (model.members.get(id) ?? []).reduce((n, m) => n + (isBlock(m) ? questionsIn(m['Item.ID']) : 1), 0);
  const folded: string[] = [];
  const renderBlock = (block: Question, depth: number): string[] => {
    const pad = '  '.repeat(depth);
    if (collapsed.has(block['Item.ID'])) {
      const id = `${nodeId.get(block['Item.ID'])}_c`;
      folded.push(id);
      const n = questionsIn(block['Item.ID']);
      return [`${pad}${id}[["${escapeLabel(`▸ ${wrapText(itemLabel(block), 36)}<br/>${n} question${n === 1 ? '' : 's'}${blockTag(block)}`)}"]]`];
    }
    const out = [`${pad}subgraph ${nodeId.get(block['Item.ID'])}_g["${escapeLabel(wrapText(itemLabel(block), 40) + blockTag(block))}"]`];
    for (const m of model.members.get(block['Item.ID']) ?? []) {
      if (isBlock(m)) out.push(...renderBlock(m, depth + 1));
      else out.push(`${pad}  ${renderNode(m, `${pad}  `)}`);
    }
    out.push(`${pad}end`);
    return out;
  };
  // Edges.
  let endUsed = false;
  const target = (q: Question | undefined) => {
    if (q) return nodeId.get(q['Item.ID'])!;
    endUsed = true;
    return 'finish';
  };

  // Multi-select parents (several branches can apply) become a chain of yes/no checks, one per
  // option, so the drawing runs straight down: check 1 -> follow-up 1 -> check 2 -> ... -> continue.
  // When a follow-up unit ends, flow resumes at the next check rather than skipping past it.
  const resumeAt = new Map<string, string>(); // gate (child Item.ID) -> node to continue at
  const isMultiParent = (q: Question) => q['Question.Type.Display.Name'] === 'Multiple Select' && (model.branchesFrom.get(q['Item.ID'])?.length ?? 0) > 1;
  const sortedBranches = (q: Question) => [...(model.branchesFrom.get(q['Item.ID']) ?? [])].sort((a, b) => (index.get(a.childId) ?? 0) - (index.get(b.childId) ?? 0));
  for (const q of order) {
    if (!isMultiParent(q)) continue;
    const id = nodeId.get(q['Item.ID'])!;
    sortedBranches(q).forEach((b, k, all) => {
      if (k < all.length - 1) resumeAt.set(b.childId, `${id}_d${k + 1}`);
    });
  }

  /** Where flow goes after item i: the next item on its path, or the next pending check when leaving a follow-up. */
  const continuation = (i: number): string => {
    const q = order[i]!;
    const chain = gates.get(q['Item.ID'])!;
    const next = nextFrom(i, chain);
    const stillIn = new Set(next ? gates.get(next['Item.ID'])! : []);
    for (let g = chain.length - 1; g >= 0; g--) {
      const gate = chain[g]!;
      if (stillIn.has(gate)) break;
      const resume = resumeAt.get(gate);
      if (resume) return resume;
      // Leaving a follow-up continues wherever the question that opened it continues
      // (e.g. a nested follow-up inside a multi-select chain resumes at the next check).
      const opener = model.branchesTo.get(gate)?.[0]?.parentId;
      const oi = opener ? index.get(opener) : undefined;
      if (oi != null && oi < i) return continuation(oi);
    }
    return target(next);
  };

  const branchLabel = (b: { definitions: string[]; condition: string | null }) => (b.definitions.length ? b.definitions.join(' / ') : (b.condition ?? 'Yes'));
  order.forEach((q, i) => {
    if (isBlock(q)) return;
    const id = nodeId.get(q['Item.ID'])!;
    const branches = sortedBranches(q);
    if (branches.length === 0) {
      addEdge(id, continuation(i));
      return;
    }
    const failId = model.failTargets.get(q['Item.ID']);
    const otherwise = failId ? target(entry(failId)) : continuation(i);
    const folded = !!owner(q); // a branching question inside a folded block branches from the folded node
    if (isMultiParent(q)) {
      const checks = branches.map((_, k) => `${id}_d${k}`);
      if (!folded) decisions.set(q['Item.ID'], checks.map((c, k) => `${c}{"${escapeLabel(wrapText(`${branchLabel(branches[k]!)}?`, 18))}"}`));
      addEdge(id, checks[0]!);
      branches.forEach((b, k) => {
        addEdge(checks[k]!, target(entry(b.childId)), 'Yes');
        addEdge(checks[k]!, k < branches.length - 1 ? checks[k + 1]! : otherwise, 'No');
      });
      return;
    }
    const decision = `${id}_d`;
    if (!folded) decisions.set(q['Item.ID'], [`${decision}{" "}`]);
    addEdge(id, decision);
    for (const b of branches) addEdge(decision, target(entry(b.childId)), wrapText(branchLabel(b), 24));
    addEdge(decision, otherwise, 'Otherwise');
  });

  // Nodes, nested inside block subgraphs (decision diamonds travel with their question).
  for (const q of order) {
    const parent = q.Parent ? model.byId.get(q.Parent) : undefined;
    if (parent && isBlock(parent)) continue; // drawn inside its block
    if (isBlock(q)) lines.push(...renderBlock(q, 1));
    else lines.push(`  ${renderNode(q)}`);
  }
  const start = order.find((q) => !isBlock(q) && gates.get(q['Item.ID'])!.length === 0);
  // Floating blocks from other surveys that land here when their own survey was missed.
  const floats = opts.floatingIn ?? [];
  if (start) {
    lines.push('  start(["Start"])');
    const first = remap(nodeId.get(start['Item.ID'])!);
    if (floats.length) {
      lines.push('  floatcheck{"Floating block<br/>already answered today?"}');
      floats.forEach((f, k) => lines.push(`  float${k}["${escapeLabel(`⇢ ${wrapText(f.label, 32)}<br/>(floats from ${f.from})`)}"]`));
      const chain = floats.map((_, k) => `float${k}`);
      edges.unshift(`  start --> floatcheck`, `  floatcheck -->|"No"| ${chain[0]}`, ...chain.slice(1).map((c, k) => `  ${chain[k]} --> ${c}`), `  ${chain.at(-1)} --> ${first}`, `  floatcheck -->|"Yes"| ${first}`);
    } else edges.unshift(`  start --> ${first}`);
  }

  if (endUsed) lines.push('  finish(["End"])');
  lines.push(...edges);
  if (floats.length) {
    lines.push('  classDef floating fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,stroke-dasharray:6 4,color:#1e293b');
    lines.push(`  class ${floats.map((_, k) => `float${k}`).join(',')} floating`);
  }
  if (folded.length) {
    lines.push('  classDef folded fill:#eef3f9,stroke:#6f8fb8,stroke-width:1.5px,stroke-dasharray:5 3,color:#1e293b');
    lines.push(`  class ${folded.join(',')} folded`);
  }
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

/**
 * The survey's flow as an indented text outline (the prior tool's "text" flowchart output):
 * blocks and skip-logic conditions open nested sections, questions are listed inside them.
 *
 *   ev_used: Did you use any alcohol or drugs today?
 *     IF ev_used is "Yes":
 *       Block: Substance use details
 *         ev_substances: Which did you use?
 *           IF ev_substances includes "Alcohol":
 *             ev_alc_drinks: How many standard drinks did you have?
 */
export function flowchartText(survey: Survey): string {
  const model = buildSurveyModel(survey);
  const isTarget = (id: string) => (model.branchesTo.get(id)?.length ?? 0) > 0;
  const condition = (id: string) =>
    (model.branchesTo.get(id) ?? [])
      .map((b) => {
        const parent = model.byId.get(b.parentId);
        const name = parent?.['Question.ID'] ?? b.parentId;
        const verb = parent?.['Question.Type.Display.Name'] === 'Multiple Select' ? 'includes' : 'is';
        return b.definitions.length ? `${name} ${verb} ${b.definitions.map((d) => `"${d}"`).join(' or ')}` : `${name} ${b.condition ?? 'meets its condition'}`;
      })
      .join(', or ');

  /**
   * Open contexts for an item, outermost first. A skip-logic target nests under the question that
   * opens it ("if:<id>"); a block member nests under its block ("block:<id>").
   */
  const memo = new Map<string, string[]>();
  const contexts = (q: Question, guard = new Set<string>()): string[] => {
    const id = q['Item.ID'];
    if (memo.has(id)) return memo.get(id)!;
    if (guard.has(id)) return [];
    guard.add(id);
    let out: string[] = [];
    const opener = model.branchesTo.get(id)?.[0]?.parentId;
    const parentBlock = q.Parent ? model.byId.get(q.Parent) : undefined;
    if (isTarget(id) && opener && model.byId.has(opener)) {
      // "under:" adds one indent level so the IF sits beneath the question that opens it.
      out = [...contexts(model.byId.get(opener)!, guard), `under:${opener}`, `if:${id}`];
    } else if (parentBlock && isBlock(parentBlock)) {
      out = [...contexts(parentBlock, guard), `block:${parentBlock['Item.ID']}`];
    }
    // A block member whose block is itself a target: the block's contexts already carry the IF.
    if (isTarget(id) && parentBlock && isBlock(parentBlock) && !out.includes(`block:${parentBlock['Item.ID']}`)) {
      const inBlock = contexts(parentBlock, guard);
      if (inBlock.length >= out.length - 1) out = [...inBlock, `block:${parentBlock['Item.ID']}`, `if:${id}`];
    }
    memo.set(id, out);
    return out;
  };

  const lines = [survey['Survey.LongName'] || survey['Survey.Name']];
  let open: string[] = [];
  for (const q of model.items) {
    if (isBlock(q)) continue;
    const ctx = contexts(q);
    let common = 0;
    while (common < open.length && common < ctx.length && open[common] === ctx[common]) common++;
    for (let k = common; k < ctx.length; k++) {
      const [kind, id] = [ctx[k]!.slice(0, ctx[k]!.indexOf(':')), ctx[k]!.slice(ctx[k]!.indexOf(':') + 1)];
      const pad = '  '.repeat(k + 1);
      if (kind === 'under') continue;
      lines.push(kind === 'if' ? `${pad}IF ${condition(id)}:` : `${pad}Block: ${itemLabel(model.byId.get(id)!)}`);
    }
    open = ctx;
    lines.push(`${'  '.repeat(ctx.length + 1)}${q['Question.ID']}: ${itemLabel(q)} [${q['Question.Type.Display.Name']}]`);
  }
  return lines.join('\n');
}
