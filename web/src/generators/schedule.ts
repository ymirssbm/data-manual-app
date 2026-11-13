// Spec schedules -> concrete, displayable occurrences.
// Times are kept as wall-clock values in each event's own UTC offset, so a
// schedule written for "9:00 -05:00" displays as 9:00 for every viewer.
import type { Recurrence, Schedule, ScheduleEvent, StudySpec } from '../core';

export interface Occurrence {
  /** YYYY-MM-DD */
  date: string;
  /** Minutes after midnight (wall clock); null for all-day events. */
  startMin: number | null;
  endMin: number | null;
  /** True when the window ends on a later day than it starts. */
  overnight: boolean;
}

export interface ScheduledEvent {
  id: string;
  scheduleName: string;
  title: string;
  description: string | null;
  surveyName: string | null;
  timingType: string | null;
  userSpecified: boolean;
  trigger: string | null;
  /** A JITAI decision point's options, e.g. "Coping Tip 50% · no intervention 50%". */
  intervention: string | null;
  windowText: string;
  recurrenceText: string;
  occurrences: Occurrence[];
  /** True if the recurrence was cut off at MAX_OCCURRENCES. */
  truncated: boolean;
  depth: number;
}

export interface StudySchedule {
  events: ScheduledEvent[];
  firstDate: string | null;
  lastDate: string | null;
  /** The weekday every participant's day 1 falls on (Study.Day1.Weekday), when the study sets one. */
  day1Weekday: (typeof DAY_CODES)[number] | null;
}

export const MAX_OCCURRENCES = 2000;
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_NAMES: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
const COMPARATOR: Record<string, string> = { '1': '=', '2': '<=', '3': '>=', '4': '<', '5': '>', '6': '!=' };

interface WallTime {
  date: string;
  minutes: number | null;
}

function parseWall(s: string): WallTime {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return { date: s.slice(0, 10), minutes: null };
  return { date: m[1]!, minutes: m[2] != null ? Number(m[2]) * 60 + Number(m[3]) : null };
}

// Date arithmetic on plain calendar dates (UTC-based, so no DST surprises).
const toDays = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const fromDays = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const weekday = (d: string) => DAY_CODES[new Date(toDays(d) * 86400000).getUTCDay()]!;

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatDate(d: string, withYear = true): string {
  const date = new Date(toDays(d) * 86400000);
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** Expand one event's recurrence into dates (YYYY-MM-DD). */
export function expandDates(startDate: string, rule: Recurrence | undefined): { dates: string[]; truncated: boolean } {
  if (!rule) return { dates: [startDate], truncated: false };
  const interval = rule.interval ?? 1;
  const until = rule.until ? parseWall(rule.until).date : null;
  const limit = Math.min(rule.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const dates: string[] = [];
  const s = toDays(startDate);
  const push = (d: string) => {
    if (until && d > until) return false;
    if (dates.length >= limit) return false;
    if (d < startDate) return true;
    dates.push(d);
    return dates.length < limit;
  };

  // Hard cap on iterations so a malformed rule can't spin forever.
  for (let step = 0; step < 20000; step++) {
    let keepGoing = true;
    if (rule.frequency === 'DAILY') {
      keepGoing = push(fromDays(s + step * interval));
    } else if (rule.frequency === 'WEEKLY') {
      const weekStart = s + step * 7 * interval - ((new Date(s * 86400000).getUTCDay() + 6) % 7); // Monday
      const days = rule.byDay?.length ? rule.byDay : [weekday(startDate)];
      for (let k = 0; k < 7 && keepGoing; k++) {
        const d = fromDays(weekStart + k);
        if (days.includes(weekday(d) as (typeof days)[number])) keepGoing = push(d);
      }
    } else if (rule.frequency === 'MONTHLY') {
      const y = +startDate.slice(0, 4);
      const m0 = +startDate.slice(5, 7) - 1 + step * interval;
      const year = y + Math.floor(m0 / 12);
      const month = ((m0 % 12) + 12) % 12;
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const wanted = rule.byMonthDay?.length ? rule.byMonthDay : [+startDate.slice(8, 10)];
      const resolved = wanted
        .map((d) => (d < 0 ? daysInMonth + 1 + d : d))
        .filter((d) => d >= 1 && d <= daysInMonth)
        .sort((a, b) => a - b);
      for (const d of resolved) {
        if (!keepGoing) break;
        keepGoing = push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    } else {
      const year = +startDate.slice(0, 4) + step * interval;
      keepGoing = push(`${year}${startDate.slice(4)}`);
    }
    if (!keepGoing) break;
  }
  return { dates, truncated: dates.length >= MAX_OCCURRENCES };
}

/**
 * "Every day, 7 times (study days 29–35)". A schedule's dates are only an example (each participant
 * starts on their own day), so with `day1` (the first day any survey is sent) the days are given as
 * study days; without it, as the dates in the file.
 */
export function describeRecurrence(rule: Recurrence | undefined, dates: string[], day1?: string): string {
  const day = (d: string) => (day1 ? `study day ${toDays(d) - toDays(day1) + 1}` : formatDate(d));
  if (!rule) return dates[0] ? `Once, ${day(dates[0])}` : 'Once';
  const n = rule.interval ?? 1;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[rule.frequency];
  let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (rule.frequency === 'WEEKLY' && rule.byDay?.length) text += ` on ${rule.byDay.map((d) => DAY_NAMES[d]).join(', ')}`;
  if (rule.frequency === 'MONTHLY' && rule.byMonthDay?.length) text += ` on day ${rule.byMonthDay.join(', ')}`;
  if (dates.length) {
    text += `, ${dates.length} time${dates.length === 1 ? '' : 's'}`;
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    text += first === last ? ` (${day(first)})` : day1 ? ` (study days ${toDays(first) - toDays(day1) + 1}–${toDays(last) - toDays(day1) + 1})` : ` (${formatDate(first)} – ${formatDate(last)})`;
  }
  return text;
}

function eventOccurrences(ev: ScheduleEvent): { occ: Occurrence[]; truncated: boolean; dates: string[] } {
  const start = parseWall(ev.start);
  const end = parseWall(ev.end);
  const spanDays = toDays(end.date) - toDays(start.date);
  const { dates, truncated } = expandDates(start.date, ev.recurrence);
  const occ: Occurrence[] = [];
  for (const date of dates) {
    // Overrides are keyed by the occurrence's date or full start date-time.
    const override = ev.overrides
      ? Object.entries(ev.overrides).find(([k]) => k.slice(0, 10) === date)?.[1]
      : undefined;
    if (override?.cancelled) continue;
    const s = override?.start ? parseWall(override.start) : null;
    const e = override?.end ? parseWall(override.end) : null;
    occ.push({
      date: s?.date ?? date,
      startMin: s ? s.minutes : start.minutes,
      endMin: e ? e.minutes : end.minutes,
      overnight: spanDays > 0,
    });
  }
  return { occ, truncated, dates: occ.map((o) => o.date) };
}

export function buildStudySchedule(spec: StudySpec): StudySchedule {
  const events: ScheduledEvent[] = [];
  const recurrences: Array<{ rule: Recurrence | undefined; dates: string[] }> = [];
  const visit = (schedule: Schedule, depth: number) => {
    const scheduleName = schedule.name ?? 'Schedule';
    for (const ev of schedule.events) {
      const { occ, truncated, dates } = eventOccurrences(ev);
      const s = parseWall(ev.start);
      const e = parseWall(ev.end);
      const x = ev.extensions;
      const trig = x?.['Trigger.Info'];
      recurrences.push({ rule: ev.recurrence, dates });
      const options = x?.['Intervention.Options'];
      const surveyLabel = (n: string | null | undefined) => (n ? (spec.surveys.find((sv) => sv['Survey.Name'] === n)?.['Survey.LongName'] || n) : 'no intervention');
      const intervention = options?.length ? options.map((o) => `${o.Label || surveyLabel(o['Survey.Name'])} ${Math.round(o.Probability * 1000) / 10}%`).join(' · ') : null;
      events.push({
        id: ev.id,
        scheduleName,
        title: ev.title,
        description: ev.description ?? null,
        surveyName: x?.['Survey.Name'] ?? null,
        timingType: x?.['Timing.Type'] ?? null,
        userSpecified: x?.['User.Specified'] ?? false,
        trigger: trig
          ? [trig['Conditional.Source'], trig['Conditional.Type'] ? COMPARATOR[trig['Conditional.Type']] : null, trig['Conditional.Threshold']]
              .filter(Boolean)
              .join(' ')
          : null,
        intervention,
        windowText:
          s.minutes == null || e.minutes == null
            ? 'All day'
            : `${formatMinutes(s.minutes)} – ${formatMinutes(e.minutes)}${e.date > s.date ? ' (next day)' : ''}`,
        recurrenceText: '', // filled in below, once day 1 is known
        occurrences: occ,
        truncated,
        depth,
      });
      for (const child of x?.children ?? []) visit(child, depth + 1);
    }
    for (const child of schedule.children ?? []) visit(child, depth + 1);
  };
  spec.schedules.forEach((s) => visit(s, 0));
  const day1Weekday = spec.schedules.map((s) => s.extensions?.['Study.Day1.Weekday']).find(Boolean) ?? null;

  const all = events.flatMap((e) => e.occurrences.map((o) => o.date)).sort();
  events.forEach((e, i) => (e.recurrenceText = describeRecurrence(recurrences[i]!.rule, recurrences[i]!.dates, all[0])));
  return { events, firstDate: all[0] ?? null, lastDate: all[all.length - 1] ?? null, day1Weekday };
}

export function dayIndex(first: string, date: string): number {
  return toDays(date) - toDays(first);
}
export function addDays(date: string, n: number): string {
  return fromDays(toDays(date) + n);
}
