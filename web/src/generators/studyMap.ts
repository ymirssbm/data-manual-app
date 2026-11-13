// The study as a zoomable flowchart, above the per-survey question flowcharts:
//   study level: the bursts in order, with the gaps between them;
//   burst level: the surveys in a burst, in time-of-day order, with what links them (an answer that
//     sends another survey, a floating block that moves to the next survey, a decision point that
//     may deliver an intervention).
// Each node names what it zooms into ("burst:2", "survey:evening"), so the page can make it clickable.
import { itemLabel, type StudySpec } from '../core';
import { buildStudySchedule, dayIndex, type ScheduledEvent } from './schedule';
import { wrapText } from './flowchart';

export interface StudyBurst {
  /** 1-based. */
  index: number;
  start: string;
  end: string;
  firstDay: number;
  lastDay: number;
  surveys: string[];
  prompts: number;
}

export interface StudyLink {
  from: string;
  to: string;
  kind: 'trigger' | 'float' | 'intervention';
  label: string;
}

export interface StudyMap {
  code: string;
  /** Mermaid node id -> what it opens ("burst:1", "survey:morning"). */
  nodes: Array<{ itemId: string; nodeId: string }>;
}

const OPS: Record<string, string> = { '1': '=', '2': '≤', '3': '≥', '4': '<', '5': '>', '6': '≠' };
const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/\|/g, '#124;').replace(/[{}]/g, (c) => (c === '{' ? '#123;' : '#125;'));

/** Bursts: runs of days with surveys, split where nothing is sent for more than a week. */
export function studyBursts(spec: StudySpec): StudyBurst[] {
  const sch = buildStudySchedule(spec);
  if (!sch.firstDate) return [];
  const byDate = new Map<string, ScheduledEvent[]>();
  for (const e of sch.events) for (const o of e.occurrences) byDate.set(o.date, [...(byDate.get(o.date) ?? []), e]);
  const dates = [...byDate.keys()].sort();
  const out: StudyBurst[] = [];
  for (const d of dates) {
    const cur = out[out.length - 1];
    if (cur && dayIndex(cur.end, d) <= 7) cur.end = d;
    else out.push({ index: out.length + 1, start: d, end: d, firstDay: 0, lastDay: 0, surveys: [], prompts: 0 });
  }
  for (const b of out) {
    b.firstDay = dayIndex(sch.firstDate, b.start) + 1;
    b.lastDay = dayIndex(sch.firstDate, b.end) + 1;
    const names = new Set<string>();
    for (const d of dates.filter((x) => x >= b.start && x <= b.end))
      for (const e of byDate.get(d)!) {
        if (e.surveyName) names.add(e.surveyName);
        b.prompts++;
      }
    b.surveys = [...names];
  }
  return out;
}

/** What links surveys: answers that send another survey, floating blocks, decision points. */
export function studyLinks(spec: StudySpec): StudyLink[] {
  const surveyOfQuestion = new Map<string, string>();
  for (const s of spec.surveys) for (const q of s.questions ?? []) surveyOfQuestion.set(q['Question.ID'], s['Survey.Name']);
  const label = (n: string) => spec.surveys.find((s) => s['Survey.Name'] === n)?.['Survey.LongName'] || n;
  const links: StudyLink[] = [];
  const seen = new Set<string>();
  const add = (l: StudyLink) => {
    const k = `${l.from}|${l.to}|${l.kind}|${l.label}`;
    if (!seen.has(k) && l.from !== l.to) (seen.add(k), links.push(l));
  };
  const events = spec.schedules.flatMap((s) => s.events);
  for (const e of events) {
    const x = e.extensions ?? {};
    const t = x['Trigger.Info'];
    const from = t?.['Conditional.Source'] ? surveyOfQuestion.get(t['Conditional.Source']) : undefined;
    const rule = t ? `${t['Conditional.Source']} ${OPS[t['Conditional.Type'] ?? ''] ?? ''} ${t['Conditional.Threshold'] ?? ''}`.replace(/\s+/g, ' ').trim() : '';
    const options = x['Intervention.Options'];
    if (options?.length) {
      if (!from) continue;
      for (const o of options) if (o['Survey.Name']) add({ from, to: o['Survey.Name'], kind: 'intervention', label: `${rule ? `${rule}: ` : ''}${Math.round(o.Probability * 100)}% ${o.Label || label(o['Survey.Name'])}` });
    } else if (from && x['Survey.Name']) add({ from, to: x['Survey.Name'], kind: 'trigger', label: rule });
  }
  for (const s of spec.surveys)
    for (const q of s.questions ?? []) {
      const f = q['Block.Float'];
      if (!f) continue;
      for (let i = 1; i < f.Surveys.length; i++) add({ from: f.Surveys[i - 1]!, to: f.Surveys[i]!, kind: 'float', label: `${itemLabel(q)} if missed` });
    }
  return links;
}

const gapText = (days: number) => (days % 7 === 0 && days >= 14 ? `${days / 7} weeks later` : `${days} day${days === 1 ? '' : 's'} later`);

/** The study level: bursts in order (or, with one burst, that burst's surveys). */
export function generateStudyMap(spec: StudySpec, burst: number | null = null): StudyMap {
  const bursts = studyBursts(spec);
  const label = (n: string) => spec.surveys.find((s) => s['Survey.Name'] === n)?.['Survey.LongName'] || n;
  if (burst == null && bursts.length > 1) {
    const lines = ['flowchart TD', '  start(["Study start: day 1"])'];
    const nodes: StudyMap['nodes'] = [];
    bursts.forEach((b, i) => {
      const id = `b${b.index}`;
      const days = b.firstDay === b.lastDay ? `Day ${b.firstDay}` : `Days ${b.firstDay}–${b.lastDay}`;
      lines.push(`  ${id}["${esc(`Burst ${b.index}<br/>${days}<br/>${wrapText(b.surveys.map(label).join(' · '), 34)}<br/>${b.prompts} prompts`)}"]`);
      nodes.push({ itemId: `burst:${b.index}`, nodeId: id });
      if (i === 0) lines.push(`  start --> ${id}`);
      else lines.push(`  b${b.index - 1} -->|"${gapText(dayIndex(bursts[i - 1]!.end, b.start) - 1)}"| ${id}`);
    });
    lines.push('  finish(["End of study"])', `  b${bursts.length} --> finish`);
    unscheduled(spec, bursts, lines, nodes, label);
    lines.push('  classDef burst fill:#eef3f9,stroke:#3c8dbc,stroke-width:1.5px,color:#1e293b');
    lines.push(`  class ${bursts.map((b) => `b${b.index}`).join(',')} burst`);
    return { code: lines.join('\n'), nodes };
  }
  return burstMap(spec, bursts, burst ?? bursts[0]?.index ?? null, label);
}

function unscheduled(spec: StudySpec, bursts: StudyBurst[], lines: string[], nodes: StudyMap['nodes'], label: (n: string) => string) {
  const scheduled = new Set(bursts.flatMap((b) => b.surveys));
  const rest = spec.surveys.filter((s) => !scheduled.has(s['Survey.Name']));
  rest.forEach((s, i) => {
    lines.push(`  u${i}["${esc(`${wrapText(label(s['Survey.Name']), 26)}<br/>not on the schedule`)}"]`);
    nodes.push({ itemId: `survey:${s['Survey.Name']}`, nodeId: `u${i}` });
  });
  if (rest.length) {
    lines.push('  classDef unscheduled fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:4 3,color:#475569');
    lines.push(`  class ${rest.map((_, i) => `u${i}`).join(',')} unscheduled`);
  }
}

/** One burst: its surveys in time-of-day order, and what links them. */
function burstMap(spec: StudySpec, bursts: StudyBurst[], index: number | null, label: (n: string) => string): StudyMap {
  const b = bursts.find((x) => x.index === index);
  const sch = buildStudySchedule(spec);
  const inBurst = (d: string) => !b || (d >= b.start && d <= b.end);
  type Info = { name: string; first: number; days: Set<string>; windows: Set<string>; triggered: boolean };
  const info = new Map<string, Info>();
  for (const e of sch.events) {
    if (!e.surveyName) continue;
    const occ = e.occurrences.filter((o) => inBurst(o.date));
    if (!occ.length) continue;
    const i = info.get(e.surveyName) ?? { name: e.surveyName, first: Infinity, days: new Set(), windows: new Set(), triggered: false };
    for (const o of occ) {
      i.days.add(o.date);
      i.first = Math.min(i.first, o.startMin ?? 0);
    }
    i.windows.add(e.windowText);
    i.triggered ||= !!e.trigger || e.timingType === 'Triggered';
    info.set(e.surveyName, i);
  }
  // Daily surveys in time-of-day order, then occasional ones (e.g. a weekly review at the end).
  const span = b ? b.lastDay - b.firstDay + 1 : 7;
  const occasional = (x: Info) => x.days.size < Math.max(2, span / 2);
  const list = [...info.values()].sort((a, z) => Number(occasional(a)) - Number(occasional(z)) || a.first - z.first);
  const lines = ['flowchart TD'];
  const nodes: StudyMap['nodes'] = [];
  const id = new Map(list.map((x, k) => [x.name, `s${k}`]));
  const role = (n: string) => spec.surveys.find((s) => s['Survey.Name'] === n)?.['Survey.Role'];
  for (const x of list) {
    const n = id.get(x.name)!;
    const how = `${[...x.windows].join(', ')}<br/>${x.days.size} day${x.days.size === 1 ? '' : 's'}${x.triggered ? ', when triggered' : ''}`;
    const text = esc(`${wrapText(label(x.name), 26)}<br/>${how}`);
    lines.push(role(x.name) === 'Intervention' ? `  ${n}{{"${text}"}}` : `  ${n}["${text}"]`);
    nodes.push({ itemId: `survey:${x.name}`, nodeId: n });
  }
  // The day's routine: the surveys that are always sent, in time-of-day order.
  const routine = list.filter((x) => !x.triggered);
  if (routine.length) {
    lines.push(`  start(["${esc(b ? `Burst ${b.index}: days ${b.firstDay}–${b.lastDay}` : 'Each day')}"])`);
    lines.push(`  start --> ${id.get(routine[0]!.name)}`);
    routine.slice(1).forEach((x, k) => lines.push(`  ${id.get(routine[k]!.name)} --> ${id.get(x.name)}`));
  }
  const linkStyles: string[] = [];
  let edgeCount = Math.max(0, routine.length);
  for (const l of studyLinks(spec)) {
    const from = id.get(l.from);
    const to = id.get(l.to);
    if (!from || !to) continue;
    const arrow = l.kind === 'float' ? '-.->' : l.kind === 'intervention' ? '==>' : '-->';
    lines.push(`  ${from} ${arrow}|"${esc(wrapText(l.label, 28))}"| ${to}`);
    if (l.kind === 'trigger') linkStyles.push(`  linkStyle ${edgeCount} stroke:#d97706,stroke-width:2px`);
    edgeCount++;
  }
  lines.push(...linkStyles);
  const triggered = list.filter((x) => x.triggered).map((x) => id.get(x.name)!);
  if (triggered.length) {
    lines.push('  classDef triggered fill:#fffbeb,stroke:#d97706,stroke-dasharray:5 3,color:#1e293b');
    lines.push(`  class ${triggered.join(',')} triggered`);
  }
  if (bursts.length <= 1) unscheduled(spec, bursts, lines, nodes, label);
  return { code: lines.join('\n'), nodes };
}
