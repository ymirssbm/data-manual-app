import { useMemo, useState, type CSSProperties } from 'react';
import type { StudySpec } from '../../core';
import { addDays, buildStudySchedule, dayIndex, formatMinutes, type ScheduledEvent } from '../../generators';
import type { PageId } from '../App';
import { Box, PageTitle } from '../ui';
import { NoStudy } from './common';
import { ScheduleEditPanel } from './ScheduleEditPanel';
import type { CommitEdit } from '../useLiveDraft';

const PALETTE = ['#3c8dbc', '#f39c12', '#00a65a', '#605ca8', '#dd4b39', '#39cccc', '#d81b60', '#3d9970'];
const HOUR_PX = 52;
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));
/** The first day of the month `n` months from `date`'s month. */
function monthStart(date: string, n = 0): string {
  const m0 = +date.slice(0, 4) * 12 + (+date.slice(5, 7) - 1) + n;
  return `${Math.floor(m0 / 12)}-${String((m0 % 12) + 1).padStart(2, '0')}-01`;
}
/** "rd_craving >= 70" -> "rd_craving ≥ 70". */
const prettyRule = (t: string) => t.replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/!=/g, '≠');
/** How a window's timing reads on the calendar: random and triggered windows look different from fixed ones. */
const timingClass = (e: ScheduledEvent) => (e.timingType === 'Random' ? 'is-random' : e.timingType === 'Triggered' || e.trigger ? 'is-triggered' : '');

/** One survey window on one day, placed in the calendar. */
interface Placed {
  key: string;
  event: ScheduledEvent;
  eventIndex: number;
  color: string;
  /** Minutes after midnight; untimed windows have neither. */
  start: number | null;
  end: number | null;
  /** The window runs past midnight. */
  continues: boolean;
  /** Position among overlapping windows: later ones are drawn over earlier ones, shifted right. */
  col: number;
  cols: number;
}

/** Overlapping windows get a "column" each (0 for the first), so later ones can be drawn over earlier ones, shifted right. */
function layout(items: Placed[]): Placed[] {
  const timed = items.filter((p) => p.start != null).sort((a, b) => a.start! - b.start! || b.end! - a.end!);
  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const p of cluster) p.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const p of timed) {
    if (p.start! >= clusterEnd) close();
    let col = colEnds.findIndex((e) => e <= p.start!);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(p.end!);
    } else colEnds[col] = p.end!;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.end!);
  }
  close();
  return items;
}

export function SchedulePage({ spec, go, onEditSchedule, onChange }: { spec: StudySpec | null; go(id: PageId): void; onEditSchedule?(surveyName: string): void; onChange?: CommitEdit }) {
  const schedule = useMemo(() => (spec ? buildStudySchedule(spec) : null), [spec]);
  if (!spec || !schedule) return (<><PageTitle>Study Schedule</PageTitle><NoStudy go={go} what="a schedule" /></>);
  if (schedule.events.length === 0) {
    return (
      <>
        <PageTitle>Study Schedule</PageTitle>
        <Box title="No Schedule">
          <p>This study has no schedules. Imported Qualtrics, REDCap and Wear-IT data files don't include delivery timing. Add delivery windows on a survey's Schedule tab in the Survey Editor to see them here.</p>
          {onEditSchedule && spec.surveys[0] && (
            <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={() => onEditSchedule(spec.surveys[0]!['Survey.Name'])}>
              Add a schedule
            </button>
          )}
        </Box>
      </>
    );
  }
  return <Calendar spec={spec} events={schedule.events} first={schedule.firstDate!} last={schedule.lastDate!} onEditSchedule={onEditSchedule} onChange={onChange} />;
}

function Calendar({
  spec,
  events,
  first,
  last,
  onEditSchedule,
  onChange,
}: {
  spec: StudySpec;
  events: ScheduledEvent[];
  first: string;
  last: string;
  onEditSchedule?(surveyName: string): void;
  onChange?: CommitEdit;
}) {
  const [editMode, setEditMode] = useState(false);
  const surveyLabel = (name: string | null) => (name ? (spec.surveys.find((s) => s['Survey.Name'] === name)?.['Survey.LongName'] ?? name) : null);

  // One colour per survey (or per event when it has no survey), so every morning check-in looks alike.
  const colorKey = (e: ScheduledEvent) => e.surveyName ?? `event:${e.title}`;
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (!m.has(colorKey(e))) m.set(colorKey(e), PALETTE[m.size % PALETTE.length]!);
    return m;
  }, [events]);

  // Every day's windows, and the days that have any.
  const byDate = useMemo(() => {
    const m = new Map<string, Array<{ event: ScheduledEvent; eventIndex: number; start: number | null; end: number | null; continues: boolean }>>();
    events.forEach((event, eventIndex) => {
      for (const o of event.occurrences) {
        const timed = o.startMin != null && o.endMin != null;
        const continues = timed && (o.overnight || o.endMin! <= o.startMin!);
        const list = m.get(o.date) ?? [];
        list.push({ event, eventIndex, start: timed ? o.startMin : null, end: timed ? (continues ? 1440 : o.endMin) : null, continues });
        m.set(o.date, list);
      }
    });
    return m;
  }, [events]);
  const activeDates = useMemo(() => [...byDate.keys()].sort(), [byDate]);
  const totalDays = dayIndex(first, last) + 1;

  // Start on the busiest day, where overlaps (if any) show.
  const busiest = useMemo(() => activeDates.reduce((best, d) => (byDate.get(d)!.length > byDate.get(best)!.length ? d : best), activeDates[0]!), [activeDates, byDate]);
  const [date, setDate] = useState(busiest);
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [skipEmpty, setSkipEmpty] = useState(true);
  /** Month view laid out by study day, one burst after another, with the gaps between bursts left out. */
  const [byBurst, setByBurst] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [focusSurvey, setFocusSurvey] = useState<string | null>(null);

  // Hours shown: the study's earliest start to its latest end, with a little room, at least 8 hours.
  const [fromH, toH] = useMemo(() => {
    let lo = 24;
    let hi = 0;
    for (const list of byDate.values())
      for (const w of list)
        if (w.start != null) {
          lo = Math.min(lo, Math.floor(w.start / 60));
          hi = Math.max(hi, Math.ceil(w.end! / 60));
        }
    if (lo > hi) return [8, 20];
    lo = Math.max(0, lo - 1);
    hi = Math.min(24, hi + 1);
    while (hi - lo < 8) hi < 24 ? hi++ : lo--;
    return [lo, hi];
  }, [byDate]);

  const weekStart = mondayOf(date);
  const columns = view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // Month view: whole weeks (Monday first) covering the month.
  const mStart = monthStart(date);
  const mEnd = addDays(monthStart(date, 1), -1);
  const monthDays = Array.from({ length: dayIndex(mStart, mEnd) + 1 }, (_, i) => addDays(mStart, i));
  const gridStart = mondayOf(mStart);
  const weeks = Array.from({ length: Math.ceil((dayIndex(gridStart, mEnd) + 1) / 7) }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(gridStart, w * 7 + i)));
  // Bursts: runs of study days where no gap without surveys is longer than a week.
  const bursts = useMemo(() => {
    const out: Array<{ start: string; end: string }> = [];
    for (const d of activeDates) {
      const cur = out[out.length - 1];
      if (cur && dayIndex(cur.end, d) <= 7) cur.end = d;
      else out.push({ start: d, end: d });
    }
    return out;
  }, [activeDates]);
  const burstMode = view === 'month' && byBurst;
  const placedFor = (d: string): Placed[] =>
    layout(
      (byDate.get(d) ?? []).map((w, i) => ({
        key: `${d}-${w.eventIndex}-${i}`,
        event: w.event,
        eventIndex: w.eventIndex,
        color: colors.get(colorKey(w.event))!,
        start: w.start,
        end: w.end,
        continues: w.continues,
        col: 0,
        cols: 1,
      })),
    );
  const days = columns.map((d) => ({ date: d, items: placedFor(d) }));
  const untimed = days.some((d) => d.items.some((p) => p.start == null));

  const step = (dir: 1 | -1) => {
    if (burstMode) return;
    if (view === 'month') return setDate(monthStart(date, dir));
    if (view === 'week') return setDate(addDays(date, dir * 7));
    if (!skipEmpty) return setDate(addDays(date, dir));
    const next = dir > 0 ? activeDates.find((d) => d > date) : [...activeDates].reverse().find((d) => d < date);
    if (next) setDate(next);
  };
  const dayNo = (d: string) => dayIndex(first, d) + 1;
  const activeInMonth = monthDays.filter((d) => byDate.has(d)).length;
  const inStudy = monthDays.map(dayNo).filter((n) => n >= 1 && n <= totalDays);
  const monthStudyDays = inStudy.length ? `Study days ${inStudy[0]}–${inStudy[inStudy.length - 1]}` : 'Outside the study period';
  const inStudyDay = (d: string) => dayNo(d) >= 1 && dayNo(d) <= totalDays;
  const weekDays = columns.filter(inStudyDay).map(dayNo);
  const heading =
    view === 'day'
      ? inStudyDay(date)
        ? `Day ${dayNo(date)}`
        : 'Outside the study period'
      : view === 'week'
        ? weekDays.length
          ? `Study days ${weekDays[0]}–${weekDays[weekDays.length - 1]}`
          : 'Outside the study period'
        : burstMode
          ? 'Study days by burst'
          : monthStudyDays;
  const sub =
    view === 'day'
      ? `of ${totalDays} study days · ${(byDate.get(date) ?? []).length} survey window${(byDate.get(date) ?? []).length === 1 ? '' : 's'}`
      : view === 'week'
        ? `${columns.filter((d) => byDate.has(d)).length} of 7 days with surveys`
        : burstMode
          ? `${bursts.length} burst${bursts.length === 1 ? '' : 's'}, ${activeDates.length} days with surveys; the gaps between bursts are left out`
          : `${activeInMonth} day${activeInMonth === 1 ? '' : 's'} with surveys this month`;

  const surveys = [...colors.entries()].map(([key, color]) => {
    const evs = events.filter((e) => colorKey(e) === key);
    const label = key.startsWith('event:') ? key.slice(6) : (surveyLabel(key) ?? key);
    const windows = [...new Set(evs.map((e) => e.windowText))];
    const prompts = evs.reduce((n, e) => n + e.occurrences.length, 0);
    const timing = evs.some((e) => e.timingType === 'Triggered' || e.trigger) ? 'triggered' : evs.some((e) => e.timingType === 'Random') ? 'random time' : null;
    return { key, color, label, windows, prompts, events: evs.length, timing, cls: timingClass(evs[0]!) };
  });
  const sel = selected != null ? events[selected] : null;

  return (
    <>
      <PageTitle>Study Schedule</PageTitle>
      <div className="dm-cal-bar">
        <div className="dm-cal-nav">
          <button className="dm-icon-btn" onClick={() => step(-1)} aria-label={`Previous ${view}`} disabled={burstMode}>
            ‹
          </button>
          <button className="dm-icon-btn" onClick={() => step(1)} aria-label={`Next ${view}`} disabled={burstMode}>
            ›
          </button>
          <div className="dm-cal-title">
            <strong>{heading}</strong>
            <span>{sub}</span>
          </div>
        </div>
        <div className="dm-cal-tools">
          {view === 'day' && (
            <label className="dm-check">
              <input type="checkbox" checked={skipEmpty} onChange={(e) => setSkipEmpty(e.target.checked)} /> Skip days without surveys
            </label>
          )}
          {view === 'month' && bursts.length > 0 && (
            <label className="dm-check" title="Lay the month out by study day: burst 1 from day 1, then burst 2 from its first day, without the weeks in between.">
              <input type="checkbox" checked={byBurst} onChange={(e) => setByBurst(e.target.checked)} /> By burst
            </label>
          )}
          {onChange && (
            <button className={`dm-btn dm-btn-sm dm-edit-toggle ${editMode ? 'is-on' : ''}`} aria-pressed={editMode} onClick={() => setEditMode((m) => !m)}>
              {editMode ? '✎ Editing: done' : '✎ Edit'}
            </button>
          )}
          <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setDate(busiest)}>
            Busiest day
          </button>
          <div className="dm-segmented dm-segmented-inline" role="radiogroup" aria-label="View">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>
                {v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <StudyStrip
        first={first}
        totalDays={totalDays}
        byDate={byDate}
        selected={burstMode ? activeDates : view === 'month' ? monthDays : columns}
        onPick={setDate}
        focus={focusSurvey ? { has: (d) => (byDate.get(d) ?? []).some((w) => colorKey(w.event) === focusSurvey), color: colors.get(focusSurvey)! } : null}
      />

      <div className={`dm-cal-layout ${view === 'month' ? 'is-month' : ''} ${editMode && onChange ? 'is-editing' : ''}`}>
        {burstMode ? (
          <div className="dm-burst-months">
            {bursts.map((b, i) => {
              const n = dayIndex(b.start, b.end) + 1;
              const rows = Array.from({ length: Math.ceil(n / 7) }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(b.start, r * 7 + c)));
              return (
                <section key={b.start} className="dm-burst-month">
                  <h3>
                    Burst {i + 1}
                    <span>
                      Days {dayNo(b.start)}–{dayNo(b.end)}
                    </span>
                  </h3>
                  <MonthGrid
                    weeks={rows}
                    month=""
                    today={date}
                    byDate={byDate}
                    colorKey={colorKey}
                    colors={colors}
                    surveyLabel={surveyLabel}
                    dayNo={(d) => (d <= b.end ? dayNo(d) : null)}
                    focus={focusSurvey}
                    onPick={(d) => (setDate(d), setView('day'))}
                    burst
                    lastDay={b.end}
                  />
                </section>
              );
            })}
          </div>
        ) : view === 'month' ? (
          <MonthGrid
            weeks={weeks}
            month={date.slice(0, 7)}
            today={date}
            byDate={byDate}
            colorKey={colorKey}
            colors={colors}
            surveyLabel={surveyLabel}
            dayNo={(d) => (dayNo(d) >= 1 && dayNo(d) <= totalDays ? dayNo(d) : null)}
            focus={focusSurvey}
            onPick={(d) => (setDate(d), setView('day'))}
          />
        ) : (
        <div className="dm-cal" style={{ '--hour': `${HOUR_PX}px` } as CSSProperties}>
          <div className={`dm-cal-head ${view === 'week' ? 'is-week' : ''}`}>
            <span />
            {days.map(({ date: d }) => (
              <button key={d} className={`dm-cal-dayhead ${d === date ? 'is-current' : ''}`} onClick={() => (setDate(d), setView('day'))} disabled={view === 'day'}>
                <strong>{inStudyDay(d) ? `Day ${dayNo(d)}` : ''}</strong>
              </button>
            ))}
          </div>
          {untimed && (
            <div className={`dm-cal-allday ${view === 'week' ? 'is-week' : ''}`}>
              <span className="dm-cal-gutter-label">Any time</span>
              {days.map(({ date: d, items }) => (
                <div key={d} className="dm-cal-allday-cell">
                  {items
                    .filter((p) => p.start == null)
                    .map((p) => (
                      <Card key={p.key} p={p} label={surveyLabel(p.event.surveyName)} compact selected={selected === p.eventIndex} dim={!!focusSurvey && focusSurvey !== colorKey(p.event)} focused={focusSurvey === colorKey(p.event)} onSelect={setSelected} fromMin={0} />
                    ))}
                </div>
              ))}
            </div>
          )}
          <div className={`dm-cal-body ${view === 'week' ? 'is-week' : ''}`} style={{ height: (toH - fromH) * HOUR_PX }}>
            <div className="dm-cal-gutter">
              {Array.from({ length: toH - fromH }, (_, i) => (
                <span key={i} style={{ top: i * HOUR_PX }}>
                  {i === 0 ? '' : formatMinutes((fromH + i) * 60).replace(':00', '')}
                </span>
              ))}
            </div>
            {days.map(({ date: d, items }) => (
              <div key={d} className="dm-cal-col">
                {Array.from({ length: toH - fromH }, (_, i) => (
                  <span key={i} className="dm-cal-line" style={{ top: i * HOUR_PX }} />
                ))}
                {items
                  .filter((p) => p.start != null)
                  .map((p) => (
                    <Card
                      key={p.key}
                      p={p}
                      label={surveyLabel(p.event.surveyName)}
                      compact={view === 'week'}
                      selected={selected === p.eventIndex}
                      dim={!!focusSurvey && focusSurvey !== colorKey(p.event)}
                      focused={focusSurvey === colorKey(p.event)}
                      onSelect={setSelected}
                      fromMin={fromH * 60}
                    />
                  ))}
                {!items.length && view === 'day' && <p className="dm-cal-empty">No surveys scheduled on this day.</p>}
              </div>
            ))}
          </div>
        </div>
        )}

        <aside className="dm-cal-side">
          {editMode && onChange && <ScheduleEditPanel spec={spec} onCommit={onChange} eventId={sel?.id ?? null} onDeselect={() => setSelected(null)} />}
          {editMode && onChange ? null : sel ? (
            <div className="dm-cal-detail">
              <div className="dm-cal-detail-head">
                <span className="dm-cal-dot" style={{ background: colors.get(colorKey(sel)) }} />
                <strong>{surveyLabel(sel.surveyName) ?? sel.title}</strong>
                <button className="dm-icon-btn" onClick={() => setSelected(null)} aria-label="Close details">
                  ×
                </button>
              </div>
              {surveyLabel(sel.surveyName) && <p className="dm-cal-event-title">{sel.title}</p>}
              <dl className="dm-dl">
                <dt>Window</dt>
                <dd>{sel.windowText}</dd>
                <dt>Repeats</dt>
                <dd>
                  {sel.recurrenceText}
                  {sel.truncated && ' (first 2,000 shown)'}
                </dd>
                {(sel.timingType || sel.userSpecified || sel.trigger) && (
                  <>
                    <dt>Timing</dt>
                    <dd>
                      {[
                        sel.timingType === 'Random' ? 'Random: sent once at a random time within the window' : sel.timingType === 'Triggered' ? 'Triggered' : sel.timingType,
                        sel.userSpecified ? 'participant chooses the time' : null,
                        sel.trigger ? `sent only when ${prettyRule(sel.trigger)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </dd>
                  </>
                )}
                <dt>Schedule</dt>
                <dd>{sel.scheduleName}</dd>
                {sel.description && (
                  <>
                    <dt>Notes</dt>
                    <dd>{sel.description}</dd>
                  </>
                )}
              </dl>
              {onEditSchedule && sel.surveyName && (
                <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => onEditSchedule(sel.surveyName!)}>
                  Edit this schedule
                </button>
              )}
            </div>
          ) : (
            <p className="dm-hint">Click a survey on the calendar for its details.</p>
          )}
          <div className="dm-cal-legend">
            <h4>Surveys</h4>
            {surveys.map((s) => (
              <button
                key={s.key}
                className={`dm-cal-legend-row ${focusSurvey === s.key ? 'is-on' : ''}`}
                onClick={() => setFocusSurvey(focusSurvey === s.key ? null : s.key)}
                aria-pressed={focusSurvey === s.key}
                title={focusSurvey === s.key ? 'Show all surveys' : 'Highlight this survey on the calendar and the study days'}
              >
                <span className={`dm-cal-dot ${s.cls}`} style={{ '--c': s.color } as CSSProperties} />
                <span>
                  <strong>
                    {s.label}
                    {s.timing && <em className="dm-cal-kind"> {s.timing}</em>}
                  </strong>
                  <span className="dm-hint">
                    {s.windows.join(', ')} · {s.prompts.toLocaleString()} prompt{s.prompts === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            ))}
            <p className="dm-hint">
              {activeDates.length} of {totalDays} days have surveys
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Card({ p, label, compact, selected, dim, focused, onSelect, fromMin }: { p: Placed; label: string | null; compact?: boolean; selected: boolean; dim: boolean; focused?: boolean; onSelect(i: number): void; fromMin: number }) {
  const timed = p.start != null;
  const height = timed ? ((p.end! - p.start!) / 60) * HOUR_PX : 0;
  const indent = p.cols > 1 ? Math.min(compact ? 30 : 40, 75 / (p.cols - 1)) : 0;
  const style: CSSProperties = {
    '--c': p.color,
    ...(timed
      ? {
          top: ((p.start! - fromMin) / 60) * HOUR_PX + 1,
          // Short windows (30 minutes) still get room for one line of text.
          height: Math.max(30, height - 3),
          // Overlaps stack like a calendar: each later window sits on top, indented, so every title stays visible.
          left: `calc(${p.col * indent}% + 3px)`,
          width: `calc(${100 - p.col * indent}% - 6px)`,
          zIndex: 1 + p.col,
        }
      : {}),
  } as CSSProperties;
  const range = timed ? `${formatMinutes(p.start!)} – ${p.continues ? 'next day' : formatMinutes(p.end!)}` : 'Any time';
  const time = p.event.timingType === 'Random' ? `Random, ${range}` : p.event.timingType === 'Triggered' || p.event.trigger ? `If triggered, ${range}` : range;
  const short = height < 50;
  return (
    <button
      type="button"
      className={`dm-cal-card ${timingClass(p.event)} ${timed ? '' : 'is-untimed'} ${selected ? 'is-selected' : ''} ${dim ? 'is-dim' : focused ? 'is-focus' : ''} ${p.col > 0 ? 'is-over' : ''} ${short ? 'is-short' : ''} ${compact ? 'is-compact' : ''}`}
      style={style}
      onClick={() => onSelect(p.eventIndex)}
      title={`${label ?? p.event.title}: ${time}`}
    >
      <strong>{label ?? p.event.title}</strong>
      <span className="dm-cal-time">{time}</span>
      {!compact && !short && (
        <span className="dm-cal-tags">
          {p.event.timingType === 'Random' && <span>random time in this window</span>}
          {p.event.trigger ? <span>only if {prettyRule(p.event.trigger)}</span> : p.event.timingType === 'Triggered' && <span>only when triggered</span>}
          {p.event.userSpecified && <span>participant sets time</span>}
          {label && <span className="dm-cal-sub">{p.event.title}</span>}
        </span>
      )}
    </button>
  );
}

/** The whole study as a strip of days, shaded by how many surveys each has; click a day to show it. */
function StudyStrip({
  first,
  totalDays,
  byDate,
  selected,
  onPick,
  focus,
}: {
  first: string;
  totalDays: number;
  byDate: Map<string, unknown[]>;
  selected: string[];
  onPick(d: string): void;
  /** A survey picked in the list: its days take its colour, the rest fade. */
  focus: { has(d: string): boolean; color: string } | null;
}) {
  const max = Math.max(1, ...[...byDate.values()].map((l) => l.length));
  return (
    <div className="dm-strip" role="group" aria-label="Study days">
      <span className="dm-strip-label">Study days</span>
      <div className="dm-strip-days">
        {Array.from({ length: totalDays }, (_, i) => {
          const d = addDays(first, i);
          const n = byDate.get(d)?.length ?? 0;
          const inFocus = focus?.has(d);
          return (
            <button
              key={d}
              className={`dm-strip-day ${selected.includes(d) ? 'is-on' : ''} ${focus ? (inFocus ? 'is-focus' : 'is-faded') : ''}`}
              style={inFocus ? ({ '--fc': focus!.color } as CSSProperties) : n ? ({ '--n': 0.3 + 0.7 * (n / max) } as CSSProperties) : undefined}
              data-empty={n ? undefined : ''}
              onClick={() => onPick(d)}
              title={`Day ${i + 1}: ${n ? `${n} survey${n === 1 ? '' : 's'}` : 'no surveys'}`}
              aria-label={`Day ${i + 1}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A month of study days: each day lists its surveys (grouped, with a count), and opens in the day view. */
function MonthGrid({
  weeks,
  month,
  today,
  byDate,
  colorKey,
  colors,
  surveyLabel,
  dayNo,
  focus,
  onPick,
  burst = false,
  lastDay,
}: {
  /** Burst layout: rows are runs of 7 study days (not calendar weeks), each cell names its weekday. */
  burst?: boolean;
  /** In burst layout, days after this are padding and drawn empty. */
  lastDay?: string;
  weeks: string[][];
  month: string;
  today: string;
  byDate: Map<string, Array<{ event: ScheduledEvent; start: number | null }>>;
  colorKey(e: ScheduledEvent): string;
  colors: Map<string, string>;
  surveyLabel(name: string | null): string | null;
  dayNo(d: string): number | null;
  focus: string | null;
  onPick(d: string): void;
}) {
  const MAX = 5;
  return (
    <div className="dm-month">
      {!burst && (
        <div className="dm-month-head">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
      )}
      {weeks.map((week) => (
        <div key={week[0]} className="dm-month-week">
          {week.map((d) => {
            const groups = new Map<string, { event: ScheduledEvent; count: number; first: number }>();
            for (const w of byDate.get(d) ?? []) {
              const k = colorKey(w.event);
              const g = groups.get(k);
              if (g) {
                g.count++;
                g.first = Math.min(g.first, w.start ?? 9999);
              } else groups.set(k, { event: w.event, count: 1, first: w.start ?? 9999 });
            }
            const list = [...groups.entries()].sort((a, b) => a[1].first - b[1].first);
            const n = dayNo(d);
            if (burst && lastDay && d > lastDay) return <span key={d} className="dm-month-day is-pad" aria-hidden="true" />;
            return (
              <button key={d} className={`dm-month-day ${burst || d.slice(0, 7) === month ? '' : 'is-other'} ${d === today ? 'is-current' : ''} ${list.length ? '' : 'is-empty'}`} onClick={() => onPick(d)} title="Open this day">
                <span className="dm-month-date">
                  {burst ? <strong>{n ? `Day ${n}` : ''}</strong> : <strong>{Number(d.slice(8, 10))}</strong>}
                  {!burst && n && <em>Day {n}</em>}
                </span>
                {list.slice(0, list.length > MAX ? MAX - 1 : MAX).map(([k, g]) => (
                  <span
                    key={k}
                    className={`dm-month-chip ${timingClass(g.event)} ${focus && focus !== k ? 'is-dim' : ''}`}
                    style={{ '--c': colors.get(k) } as CSSProperties}
                  >
                    <span className="dm-month-chip-name">{surveyLabel(g.event.surveyName) ?? g.event.title}</span>
                    {g.count > 1 && <span className="dm-month-chip-n">×{g.count}</span>}
                  </span>
                ))}
                {list.length > MAX && <span className="dm-month-more">+{list.length - (MAX - 1)} more</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
