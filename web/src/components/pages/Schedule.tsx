import { useMemo } from 'react';
import type { StudySpec } from '../../core';
import { addDays, buildStudySchedule, dayIndex, formatDate, formatMinutes, type ScheduledEvent } from '../../generators';
import type { PageId } from '../App';
import { Box, PageTitle } from '../ui';
import { NoStudy } from './common';

const PALETTE = ['#3c8dbc', '#f39c12', '#00a65a', '#605ca8', '#dd4b39', '#39cccc', '#d81b60', '#3d9970'];

export function SchedulePage({ spec, go }: { spec: StudySpec | null; go(id: PageId): void }) {
  const schedule = useMemo(() => (spec ? buildStudySchedule(spec) : null), [spec]);
  if (!spec || !schedule) return (<><PageTitle>Study Schedule</PageTitle><NoStudy go={go} what="a schedule" /></>);

  const surveyLabel = (name: string | null) => (name ? (spec.surveys.find((s) => s['Survey.Name'] === name)?.['Survey.LongName'] ?? name) : null);
  if (schedule.events.length === 0) {
    return (
      <>
        <PageTitle>Study Schedule</PageTitle>
        <Box title="No Schedule">
          <p>This study has no schedules. Imported Qualtrics, REDCap and Wear-IT data files don't include delivery timing, so add schedules to the study spec to see them here.</p>
        </Box>
      </>
    );
  }
  const color = (i: number) => PALETTE[i % PALETTE.length]!;
  const totalDays = schedule.firstDate && schedule.lastDate ? dayIndex(schedule.firstDate, schedule.lastDate) + 1 : 0;
  const totalOcc = schedule.events.reduce((a, e) => a + e.occurrences.length, 0);

  return (
    <>
      <PageTitle>Study Schedule</PageTitle>
      <Box title="Scheduled Events">
        <p>
          {schedule.events.length} event{schedule.events.length === 1 ? '' : 's'} · {totalOcc.toLocaleString()} scheduled prompt{totalOcc === 1 ? '' : 's'}
          {schedule.firstDate && ` · ${formatDate(schedule.firstDate)} to ${formatDate(schedule.lastDate!)} (${totalDays} days)`}
        </p>
        <div className="dm-events">
          {schedule.events.map((e, i) => (
            <EventCard key={`${e.id}-${i}`} event={e} color={color(i)} surveyLabel={surveyLabel(e.surveyName)} />
          ))}
        </div>
      </Box>
      <Box title="Typical Day">
        <DayProfile events={schedule.events} color={color} />
      </Box>
      {schedule.firstDate && (
        <Box title="Study Timeline">
          <Timeline events={schedule.events} first={schedule.firstDate} days={totalDays} color={color} />
        </Box>
      )}
    </>
  );
}

function EventCard({ event: e, color, surveyLabel }: { event: ScheduledEvent; color: string; surveyLabel: string | null }) {
  return (
    <article className="dm-event" style={{ borderLeftColor: color, marginLeft: e.depth * 16 }}>
      <div className="dm-event-head">
        <strong>{e.title}</strong>
        <span className="dm-hint">{e.scheduleName}</span>
      </div>
      <dl className="dm-dl">
        <dt>Window</dt>
        <dd>{e.windowText}</dd>
        <dt>Repeats</dt>
        <dd>
          {e.recurrenceText}
          {e.truncated && ' (first 2,000 shown)'}
        </dd>
        {surveyLabel && (
          <>
            <dt>Survey</dt>
            <dd>{surveyLabel}</dd>
          </>
        )}
        {(e.timingType || e.userSpecified) && (
          <>
            <dt>Timing</dt>
            <dd>
              {[e.timingType, e.userSpecified ? 'participant chooses the time' : null].filter(Boolean).join(' · ')}
              {e.trigger && ` · triggered when ${e.trigger}`}
            </dd>
          </>
        )}
      </dl>
    </article>
  );
}

function DayProfile({ events, color }: { events: ScheduledEvent[]; color: (i: number) => string }) {
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  return (
    <div className="dm-day">
      <div className="dm-day-axis">
        {hours.map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {h === 24 ? '' : formatMinutes(h * 60).replace(':00', '')}
          </span>
        ))}
      </div>
      {events.map((e, i) => {
        const o = e.occurrences[0];
        const allDay = !o || o.startMin == null || o.endMin == null;
        const start = allDay ? 0 : o.startMin!;
        const end = allDay ? 1440 : o.overnight || o.endMin! <= o.startMin! ? 1440 : o.endMin!;
        return (
          <div className="dm-day-row" key={`${e.id}-${i}`}>
            <span className="dm-day-label" title={e.title}>
              {e.title}
            </span>
            <div className="dm-day-track">
              {hours.slice(1, -1).map((h) => (
                <span key={h} className="dm-day-grid" style={{ left: `${(h / 24) * 100}%` }} />
              ))}
              <span className="dm-day-bar" style={{ left: `${(start / 1440) * 100}%`, width: `${Math.max(0.6, ((end - start) / 1440) * 100)}%`, background: color(i) }} title={`${e.title}: ${e.windowText}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ events, first, days, color }: { events: ScheduledEvent[]; first: string; days: number; color: (i: number) => string }) {
  const bucket = days > 120 ? 7 : 1;
  const cols = Math.ceil(days / bucket);
  const labelEvery = Math.max(1, Math.ceil(cols / 12));
  return (
    <div className="dm-timeline-wrap">
      <div className="dm-timeline" style={{ gridTemplateColumns: `minmax(120px, 180px) repeat(${cols}, minmax(6px, 1fr))` }}>
        <span />
        {Array.from({ length: cols }, (_, c) => (
          <span key={c} className="dm-tl-head">
            {c % labelEvery === 0 ? formatDate(addDays(first, c * bucket), false) : ''}
          </span>
        ))}
        {events.map((e, i) => {
          const counts = new Array<number>(cols).fill(0);
          for (const o of e.occurrences) counts[Math.floor(dayIndex(first, o.date) / bucket)]! += 1;
          return [
            <span key={`l${i}`} className="dm-tl-label" title={e.title}>
              {e.title}
            </span>,
            ...counts.map((n, c) => (
              <span
                key={`${i}-${c}`}
                className="dm-tl-cell"
                style={n ? { background: color(i), opacity: bucket > 1 ? 0.35 + 0.65 * Math.min(1, n / bucket) : 1 } : undefined}
                title={n ? `${e.title}: ${formatDate(addDays(first, c * bucket))}` : undefined}
              />
            )),
          ];
        })}
      </div>
    </div>
  );
}
