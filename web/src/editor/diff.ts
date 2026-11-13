// What changed between two versions of a study, in reader terms: surveys, questions (wording, type,
// options, block, skip logic), schedule events and study details. Used to show an AI's edits.
import { blockPath, buildSurveyModel, isBlock, isEndBlock, itemLabel, shownWhen, stripHtml, type Question, type StudySpec, type Survey } from '../core';

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface SpecChange {
  kind: 'added' | 'removed' | 'changed';
  area: 'study' | 'survey' | 'question' | 'block' | 'schedule';
  /** What it is, e.g. "mo_energy: How much energy do you have?" */
  label: string;
  /** Where it is, e.g. the survey's name. */
  where?: string;
  /** For changes: each field that differs. For additions and removals: the item's main fields. */
  fields: FieldChange[];
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function questionFields(survey: Survey, q: Question): Record<string, string> {
  const m = buildSurveyModel(survey);
  const fields: Record<string, string> = isBlock(q)
    ? { Name: itemLabel(q) }
    : {
        Text: stripHtml(q['Question.Text'] ?? ''),
        Type: str(q['Question.Type.Display.Name']),
        'Data type': str(q['Data.Type']),
        Options: (q.responseKey ?? []).map((r) => `${r.value} = ${r.definition}`).join('; '),
        Description: str(q['Question.Description']),
      };
  fields['Variable name'] = q['Question.ID'];
  fields.Block = blockPath(m, q).join(' › ');
  fields['Shown'] = shownWhen(m, q['Item.ID']) ?? 'always';
  return fields;
}

function compare(before: Record<string, string>, after: Record<string, string>): FieldChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => (before[k] ?? '') !== (after[k] ?? ''))
    .map((field) => ({ field, before: before[field] ?? '', after: after[field] ?? '' }));
}

const present = (fields: Record<string, string>, side: 'before' | 'after'): FieldChange[] =>
  Object.entries(fields)
    .filter(([, v]) => v)
    .map(([field, v]) => ({ field, before: side === 'before' ? v : '', after: side === 'after' ? v : '' }));

type Event = StudySpec['schedules'][number]['events'][number];
function eventFields(e: Event): Record<string, string> {
  const x = (e.extensions ?? {}) as Record<string, unknown>;
  const trig = x['Trigger.Info'] as Record<string, unknown> | undefined;
  return {
    Title: str(e.title),
    Survey: str(x['Survey.Name']),
    Start: str(e.start),
    End: str(e.end),
    Repeats: e.recurrence ? `${str(e.recurrence.frequency)}${e.recurrence.count ? ` × ${e.recurrence.count}` : ''}` : '',
    Timing: str(x['Timing.Type']),
    Trigger: trig ? `${str(trig['Conditional.Source'])} ${str(trig['Conditional.Type'])} ${str(trig['Conditional.Threshold'])}` : '',
  };
}

export function diffSpecs(a: StudySpec, b: StudySpec): SpecChange[] {
  const out: SpecChange[] = [];

  // Study details: plain text fields of the metadata.
  const meta = (s: StudySpec) => Object.fromEntries(Object.entries(s['Study.Metadata']).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)]));
  const metaChanges = compare(meta(a), meta(b));
  if (metaChanges.length) out.push({ kind: 'changed', area: 'study', label: 'Study details', fields: metaChanges });

  const surveysA = new Map(a.surveys.map((s) => [s['Survey.Name'], s]));
  const surveysB = new Map(b.surveys.map((s) => [s['Survey.Name'], s]));
  const name = (s: Survey) => s['Survey.LongName'] || s['Survey.Name'];
  for (const [n, s] of surveysA) if (!surveysB.has(n)) out.push({ kind: 'removed', area: 'survey', label: name(s), fields: [{ field: 'Questions', before: String((s.questions ?? []).filter((q) => !isBlock(q) && !isEndBlock(q)).length), after: '' }] });
  for (const [n, sb] of surveysB) {
    const sa = surveysA.get(n);
    if (!sa) {
      out.push({ kind: 'added', area: 'survey', label: name(sb), fields: [{ field: 'Questions', before: '', after: String((sb.questions ?? []).filter((q) => !isBlock(q) && !isEndBlock(q)).length) }] });
      continue;
    }
    if (name(sa) !== name(sb)) out.push({ kind: 'changed', area: 'survey', label: name(sb), fields: [{ field: 'Name', before: name(sa), after: name(sb) }] });
    const qa = new Map((sa.questions ?? []).filter((q) => !isEndBlock(q)).map((q) => [q['Item.ID'], q]));
    const qb = new Map((sb.questions ?? []).filter((q) => !isEndBlock(q)).map((q) => [q['Item.ID'], q]));
    const qLabel = (q: Question) => (isBlock(q) ? `Block: ${itemLabel(q)}` : `${q['Question.ID']}: ${stripHtml(q['Question.Text'] ?? '').slice(0, 80)}`);
    for (const [id, q] of qa) if (!qb.has(id)) out.push({ kind: 'removed', area: isBlock(q) ? 'block' : 'question', label: qLabel(q), where: name(sb), fields: present(questionFields(sa, q), 'before') });
    for (const [id, q] of qb) {
      const before = qa.get(id);
      if (!before) {
        out.push({ kind: 'added', area: isBlock(q) ? 'block' : 'question', label: qLabel(q), where: name(sb), fields: present(questionFields(sb, q), 'after') });
        continue;
      }
      const fields = compare(questionFields(sa, before), questionFields(sb, q));
      if (fields.length) out.push({ kind: 'changed', area: isBlock(q) ? 'block' : 'question', label: qLabel(q), where: name(sb), fields });
    }
  }

  const events = (s: StudySpec) => new Map(s.schedules.flatMap((sc) => sc.events.map((e) => [e.id ?? `${sc.name}/${e.title}`, e] as const)));
  const ea = events(a);
  const eb = events(b);
  for (const [id, e] of ea) if (!eb.has(id)) out.push({ kind: 'removed', area: 'schedule', label: str(e.title), fields: present(eventFields(e), 'before') });
  for (const [id, e] of eb) {
    const before = ea.get(id);
    if (!before) out.push({ kind: 'added', area: 'schedule', label: str(e.title), fields: present(eventFields(e), 'after') });
    else {
      const fields = compare(eventFields(before), eventFields(e));
      if (fields.length) out.push({ kind: 'changed', area: 'schedule', label: str(e.title), fields });
    }
  }
  return out;
}
