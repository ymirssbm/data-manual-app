// A survey's delivery schedule: its windows, and the answers in other surveys that trigger it.
// (A question's own "leads to another survey" rules are in the LogicEditor; both edit the same events.)
import type { StudySpec, Survey } from '../../core';
import { addSurveyEvent, dateOfStudyDay, deleteEvent, joinDateTime, opWords, splitDateTime, studyDay1, studyDayOf, surveyEvents, triggerOf, updateEvent, type ScheduleEvent } from '../../editor/schedule';
import { IncomingTriggers } from '../LogicEditor';
import { Field } from '../ui';

const label = (s: Survey) => s['Survey.LongName'] || s['Survey.Name'];

/** One delivery window's fields: title, first day, times, repeats, timing. */
export function EventFields({ spec, event: e, onSpecChange, onRemoved }: { spec: StudySpec; event: ScheduleEvent; onSpecChange(s: StudySpec, label?: string): void; onRemoved?(): void }) {
  const x = (e.extensions ?? {}) as Record<string, unknown>;
  const s = splitDateTime(e.start);
  const en = splitDateTime(e.end);
  const rule = triggerOf(e);
  const freq = e.recurrence?.frequency ?? 'ONCE';
  const set = (patch: Partial<ScheduleEvent>, extPatch?: Record<string, unknown>) => onSpecChange(updateEvent(spec, e.id, patch, extPatch));
  const surveyName = String(x['Survey.Name'] ?? '');
  // Days are study days; the dates in the file are only an example of the spacing.
  const day1 = studyDay1(spec) ?? s.date;
  const day = studyDayOf(day1, s.date);
  const spanDays = studyDayOf(s.date, en.date) - 1;
  return (
    <div className="dm-sched-event">
      <div className="dm-sched-head">
        <input className="dm-input" value={e.title} onChange={(ev) => set({ title: ev.target.value })} aria-label="Title" />
        <button
          className="dm-icon-btn"
          title="Remove this window"
          aria-label="Remove this window"
          onClick={() => {
            onSpecChange(deleteEvent(spec, e.id), `Removed “${e.title}”`);
            onRemoved?.();
          }}
        >
          ×
        </button>
      </div>
      <Field label="Survey">
        <select className="dm-input" value={surveyName} onChange={(ev) => set({}, { 'Survey.Name': ev.target.value })}>
          {spec.surveys.map((sv) => (
            <option key={sv['Survey.Name']} value={sv['Survey.Name']}>
              {label(sv)}
            </option>
          ))}
        </select>
      </Field>
      <div className="dm-grid-3 dm-gap-sm">
        <Field label="Starts on study day">
          <input
            className="dm-input"
            type="number"
            min={1}
            value={day}
            title="Day 1 is the first day any survey is sent; each participant's day 1 is when they start."
            onChange={(ev) => {
              const n = Math.max(1, Math.round(Number(ev.target.value)) || 1);
              const date = dateOfStudyDay(day1, n);
              set({ start: joinDateTime(date, s.time, s.offset), end: joinDateTime(dateOfStudyDay(day1, n + spanDays), en.time, en.offset) });
            }}
          />
        </Field>
        <Field label="From">
          <input className="dm-input" type="time" value={s.time} onChange={(ev) => ev.target.value && set({ start: joinDateTime(s.date, ev.target.value, s.offset) })} />
        </Field>
        <Field label="To">
          <input className="dm-input" type="time" value={en.time} onChange={(ev) => ev.target.value && set({ end: joinDateTime(en.date, ev.target.value, en.offset) })} />
        </Field>
      </div>
      <div className="dm-grid-3 dm-gap-sm">
        <Field label="Repeats">
          <select
            className="dm-input"
            value={freq}
            onChange={(ev) => {
              const v = ev.target.value;
              set({ recurrence: v === 'ONCE' ? undefined : { ...(e.recurrence ?? {}), frequency: v as 'DAILY' | 'WEEKLY', count: e.recurrence?.count ?? 7 } });
            }}
          >
            <option value="ONCE">Once</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
          </select>
        </Field>
        <Field label="Times">
          <input
            className="dm-input"
            type="number"
            min={1}
            disabled={freq === 'ONCE'}
            value={e.recurrence?.count ?? 1}
            onChange={(ev) => e.recurrence && set({ recurrence: { ...e.recurrence, count: Math.max(1, Number(ev.target.value) || 1) } })}
          />
        </Field>
        <Field label="Time within the window">
          <select className="dm-input" value={String(x['Timing.Type'] ?? 'Fixed')} onChange={(ev) => set({}, { 'Timing.Type': ev.target.value })} disabled={!!rule}>
            <option value="Fixed">Fixed (the whole window)</option>
            <option value="Random">Random time in the window</option>
            <option value="Triggered">Triggered by an answer</option>
          </select>
        </Field>
      </div>
      <label className="dm-check">
        <input type="checkbox" checked={!!x['User.Specified']} onChange={(ev) => set({}, { 'User.Specified': ev.target.checked || undefined })} /> Participants choose the time
      </label>
      <DecisionPoint spec={spec} options={x['Intervention.Options'] as InterventionOption[] | undefined} surveyName={surveyName} onChange={(o) => set({}, { 'Intervention.Options': o })} />
      {rule && (
        <p className="dm-hint">
          Sent only when <code>{rule.source}</code> {opWords(rule.op)} {rule.value}. Change the rule under that survey’s “Sent when” or on the question’s logic.
        </p>
      )}
    </div>
  );
}

/** A survey's delivery windows and the answers that trigger it. */
export function ScheduleEditor({ spec, survey, onSpecChange }: { spec: StudySpec; survey: Survey; onSpecChange(s: StudySpec, label?: string): void }) {
  const events = surveyEvents(spec, survey['Survey.Name']);
  return (
    <div className="dm-editor-form">
      <p className="dm-hint">
        When <strong>{label(survey)}</strong> is sent, by study day: day 1 is the first day any survey is sent, and each participant’s day 1 is when they start. Times use each window’s own time zone.
      </p>
      <IncomingTriggers spec={spec} surveyName={survey['Survey.Name']} onSpecChange={onSpecChange} />
      {!events.length && <p className="dm-empty">This survey isn’t on the schedule yet.</p>}
      {events.map((e) => (
        <EventFields key={e.id} spec={spec} event={e} onSpecChange={onSpecChange} />
      ))}
      <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => onSpecChange(addSurveyEvent(spec, survey['Survey.Name'], label(survey)), 'Added a delivery window')}>
        + Add a delivery window
      </button>
    </div>
  );
}

type InterventionOption = { 'Survey.Name'?: string | null; Probability: number; Label?: string };

/**
 * A JITAI decision point: at this window (and, when triggered, only when its rule is met) one
 * intervention is picked at random with the given probabilities, or none.
 */
function DecisionPoint({ spec, options, surveyName, onChange }: { spec: StudySpec; options: InterventionOption[] | undefined; surveyName: string; onChange(o: InterventionOption[] | undefined): void }) {
  const interventions = spec.surveys.filter((s) => s['Survey.Role'] === 'Intervention');
  const total = (options ?? []).reduce((n, o) => n + o.Probability, 0);
  const setAt = (i: number, patch: Partial<InterventionOption>) => onChange(options!.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <>
      <label className="dm-check">
        <input
          type="checkbox"
          checked={!!options}
          onChange={(e) => {
            if (!e.target.checked) return onChange(undefined);
            const first = interventions.find((s) => s['Survey.Name'] === surveyName) ?? interventions[0];
            onChange([
              { 'Survey.Name': first?.['Survey.Name'] ?? null, Probability: 0.5, Label: first ? label(first) : 'Intervention' },
              { 'Survey.Name': null, Probability: 0.5, Label: 'No intervention' },
            ]);
          }}
        />{' '}
        Decision point: randomly pick an intervention (JITAI)
      </label>
      {options && (
        <div className="dm-decision">
          {!interventions.length && <p className="dm-hint">No survey is marked as an intervention yet. Set a survey’s Kind to Intervention in the Survey Editor.</p>}
          {options.map((o, i) => (
            <div key={i} className="dm-skip-row">
              <select
                className="dm-input dm-input-sm"
                value={o['Survey.Name'] ?? ''}
                onChange={(e) => {
                  const s = spec.surveys.find((x) => x['Survey.Name'] === e.target.value);
                  setAt(i, { 'Survey.Name': e.target.value || null, Label: s ? label(s) : 'No intervention' });
                }}
                aria-label="Intervention"
              >
                <option value="">No intervention</option>
                {spec.surveys
                  .filter((s) => s['Survey.Role'] === 'Intervention' || s['Survey.Name'] === o['Survey.Name'])
                  .map((s) => (
                    <option key={s['Survey.Name']} value={s['Survey.Name']}>
                      {label(s)}
                    </option>
                  ))}
              </select>
              <input
                className="dm-input dm-input-sm dm-input-num"
                type="number"
                min={0}
                max={100}
                value={Math.round(o.Probability * 1000) / 10}
                onChange={(e) => setAt(i, { Probability: Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)) })}
                aria-label="Chance (%)"
              />
              <span>%</span>
              <button className="dm-icon-btn" aria-label="Remove option" disabled={options.length < 2} onClick={() => onChange(options.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <div className="dm-skip-row">
            <button className="dm-link-btn" onClick={() => onChange([...options, { 'Survey.Name': null, Probability: 0, Label: 'No intervention' }])}>
              + Add an option
            </button>
            <span className={`dm-hint ${Math.abs(total - 1) > 0.001 ? 'dm-dirty' : ''}`}>Total {Math.round(total * 1000) / 10}%{Math.abs(total - 1) > 0.001 ? ' (should be 100%)' : ''}</span>
          </div>
        </div>
      )}
    </>
  );
}
