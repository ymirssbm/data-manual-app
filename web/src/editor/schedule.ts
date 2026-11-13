// Schedule editing for the Survey Editor: the delivery windows of a survey, and surveys triggered by
// an answer in another survey (a schedule event with Timing.Type "Triggered" and a Trigger.Info rule).
// Pure: each takes a study and returns a new one.
import type { StudySpec } from '../core';
import type { Op } from '../exporters/logic';

export type ScheduleEvent = StudySpec['schedules'][number]['events'][number];
type Events = StudySpec['schedules'][number]['events'];

const OP_CODE: Record<Op, '1' | '2' | '3' | '4' | '5' | '6'> = { '=': '1', '<=': '2', '>=': '3', '<': '4', '>': '5', '!=': '6' };
export const OP_FROM_CODE: Record<string, Op> = { '1': '=', '2': '<=', '3': '>=', '4': '<', '5': '>', '6': '!=' };

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
const ext = (e: ScheduleEvent) => (e.extensions ?? {}) as Record<string, unknown>;

/** Every event that delivers `surveyName`, in schedule order. */
export function surveyEvents(spec: StudySpec, surveyName: string): ScheduleEvent[] {
  return spec.schedules.flatMap((s) => s.events).filter((e) => ext(e)['Survey.Name'] === surveyName);
}

export interface TriggerRule {
  /** Question.ID whose answer decides. */
  source: string;
  op: Op;
  value: string;
}

export function triggerOf(e: ScheduleEvent): TriggerRule | null {
  const t = ext(e)['Trigger.Info'] as Record<string, string> | undefined;
  if (!t?.['Conditional.Source']) return null;
  return { source: t['Conditional.Source'], op: OP_FROM_CODE[t['Conditional.Type'] ?? '1'] ?? '=', value: t['Conditional.Threshold'] ?? '' };
}

/** Events triggered by an answer to `questionId` (any survey). */
export function triggersFrom(spec: StudySpec, questionId: string): ScheduleEvent[] {
  return spec.schedules.flatMap((s) => s.events).filter((e) => triggerOf(e)?.source === questionId);
}

function mapEvents(spec: StudySpec, fn: (e: ScheduleEvent) => ScheduleEvent | null): StudySpec {
  return { ...spec, schedules: spec.schedules.map((s) => ({ ...s, events: s.events.map(fn).filter((e): e is ScheduleEvent => !!e) as Events })).filter((s) => s.events.length > 0) };
}

export function updateEvent(spec: StudySpec, id: string, patch: Partial<ScheduleEvent>, extPatch?: Record<string, unknown>): StudySpec {
  // A field set to undefined is removed.
  const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return mapEvents(spec, (e) => (e.id === id ? (clean({ ...e, ...patch, ...(extPatch ? { extensions: clean({ ...ext(e), ...extPatch }) } : {}) }) as ScheduleEvent) : e));
}

export function deleteEvent(spec: StudySpec, id: string): StudySpec {
  return mapEvents(spec, (e) => (e.id === id ? null : e));
}

function addEvents(spec: StudySpec, events: ScheduleEvent[]): StudySpec {
  if (!events.length) return spec;
  if (!spec.schedules.length) return { ...spec, schedules: [{ id: uuid(), name: 'Study schedule', events: events as Events }] };
  return { ...spec, schedules: spec.schedules.map((s, i) => (i === 0 ? { ...s, events: [...s.events, ...events] as Events } : s)) };
}

// ---- dates and times (kept in each event's own UTC offset)

/** "2026-02-02T08:00:00-05:00" -> { date: "2026-02-02", time: "08:00", offset: "-05:00" } */
export function splitDateTime(v: string): { date: string; time: string; offset: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(v ?? '');
  return m ? { date: m[1]!, time: m[2]!, offset: m[3] === 'Z' ? 'Z' : (m[3] ?? 'Z') } : { date: (v ?? '').slice(0, 10), time: '09:00', offset: 'Z' };
}
export const joinDateTime = (date: string, time: string, offset: string) => `${date}T${time}:00${offset}`;
const addDay = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A new delivery window for a survey: like its last one (a week later) or daily 9–10 AM for a week. */
export function addSurveyEvent(spec: StudySpec, surveyName: string, label: string): StudySpec {
  const last = surveyEvents(spec, surveyName).at(-1);
  if (last) {
    const s = splitDateTime(last.start);
    const e = splitDateTime(last.end);
    const days = (last.recurrence?.count ?? 1) + 7;
    return addEvents(spec, [{ ...last, id: uuid(), title: `${label} (new)`, start: joinDateTime(addDay(s.date, days), s.time, s.offset), end: joinDateTime(addDay(e.date, days), e.time, e.offset) }]);
  }
  // Starts on study day 1.
  const first = spec.schedules.flatMap((x) => x.events)[0];
  const base = { date: studyDay1(spec) ?? new Date().toISOString().slice(0, 10), offset: first ? splitDateTime(first.start).offset : 'Z' };
  return addEvents(spec, [
    {
      id: uuid(),
      title: label,
      start: joinDateTime(base.date, '09:00', base.offset),
      end: joinDateTime(base.date, '10:00', base.offset),
      recurrence: { frequency: 'DAILY', count: 7 },
      extensions: { 'Timing.Type': 'Fixed', 'Survey.Name': surveyName },
    } as ScheduleEvent,
  ]);
}

const OP_WORDS: Record<Op, string> = { '=': 'is', '!=': 'is not', '>=': 'is at least', '<=': 'is at most', '>': 'is more than', '<': 'is less than' };
export const opWords = (op: Op) => OP_WORDS[op];

/**
 * Trigger `targetSurvey` from an answer: one triggered window per delivery of the source survey,
 * the same day or the next, between `from` and `to` (HH:MM).
 */
export function addTrigger(
  spec: StudySpec,
  opts: { sourceSurvey: string; rule: TriggerRule; targetSurvey: string; targetLabel: string; when: 'same' | 'next'; from: string; to: string },
): StudySpec {
  const sources = surveyEvents(spec, opts.sourceSurvey).filter((e) => !triggerOf(e));
  const rule = `${opts.rule.source} ${OP_WORDS[opts.rule.op]} ${opts.rule.value}`;
  const events = (sources.length ? sources : [null]).map((src) => {
    const s = src ? splitDateTime(src.start) : { date: new Date().toISOString().slice(0, 10), time: '09:00', offset: 'Z' };
    const date = opts.when === 'next' ? addDay(s.date, 1) : s.date;
    const count = src?.recurrence?.count ? Math.max(1, src.recurrence.count - (opts.when === 'next' ? 1 : 0)) : undefined;
    return {
      id: uuid(),
      title: `${opts.targetLabel} (if ${rule})`,
      description: `Sent ${opts.when === 'next' ? 'the next day' : 'the same day'} between ${opts.from} and ${opts.to} when ${rule}.`,
      start: joinDateTime(date, opts.from, s.offset),
      end: joinDateTime(date, opts.to, s.offset),
      ...(count ? { recurrence: { frequency: src!.recurrence!.frequency, count } } : {}),
      extensions: {
        'Timing.Type': 'Triggered',
        'Survey.Name': opts.targetSurvey,
        'Trigger.Info': { 'Conditional.Source': opts.rule.source, 'Conditional.Type': OP_CODE[opts.rule.op], 'Conditional.Threshold': opts.rule.value },
      },
    } as ScheduleEvent;
  });
  return addEvents(spec, events);
}

/** Change the rule on every window triggered by `questionId` for `targetSurvey`. */
export function setTriggerRule(spec: StudySpec, questionId: string, targetSurvey: string, rule: TriggerRule): StudySpec {
  return mapEvents(spec, (e) =>
    triggerOf(e)?.source === questionId && ext(e)['Survey.Name'] === targetSurvey
      ? ({ ...e, extensions: { ...ext(e), 'Trigger.Info': { 'Conditional.Source': rule.source, 'Conditional.Type': OP_CODE[rule.op], 'Conditional.Threshold': rule.value } } } as ScheduleEvent)
      : e,
  );
}

/** Remove every window triggered by `questionId` for `targetSurvey`. */
export function removeTrigger(spec: StudySpec, questionId: string, targetSurvey: string): StudySpec {
  return mapEvents(spec, (e) => (triggerOf(e)?.source === questionId && ext(e)['Survey.Name'] === targetSurvey ? null : e));
}

// ---- study days. The dates in a schedule are only an example: what they carry is the spacing.
// Day 1 is the first day any window starts; each participant's own day 1 is when they start.

/** The example date of study day 1 (the first day any window starts), or null without windows. */
export function studyDay1(spec: StudySpec): string | null {
  const dates = spec.schedules.flatMap((x) => x.events).map((e) => splitDateTime(e.start).date).filter(Boolean).sort();
  return dates[0] ?? null;
}

/** The study day (1, 2, …) a date falls on, counting from `day1`. */
export const studyDayOf = (day1: string, date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${day1}T00:00:00Z`)) / 86_400_000) + 1;

/** The example date for study day `n`. */
export const dateOfStudyDay = (day1: string, n: number) => addDay(day1, n - 1);
