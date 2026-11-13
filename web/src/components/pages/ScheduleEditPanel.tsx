// The Study Schedule's side panel in edit mode. Click a window on the calendar to change it, or
// build a whole survey here: its name, when it's sent (repeating windows), and its questions (new
// ones, or copies of questions from other surveys). Everything saves as you go; Ctrl+Z undoes.
import { useEffect, useMemo, useState } from 'react';
import { isBlock, isEndBlock, type StudySpec, type Survey } from '../../core';
import { addItem, copyQuestion } from '../../editor/edit';
import { deleteItems } from '../../editor/data';
import { addSurveyEvent, surveyEvents } from '../../editor/schedule';
import { allQuestions } from '../../editor/search';
import { withSurveyReplaced } from '../../exporters';
import { questionOption, SearchPicker } from '../SearchPicker';
import { useLiveDraft, type CommitEdit } from '../useLiveDraft';
import { Field } from '../ui';
import { ItemForm } from './SurveyEditor';
import { EventFields } from './SurveyScheduleEditor';

const surveyLabel = (s: Survey) => s['Survey.LongName'] || s['Survey.Name'];

export function ScheduleEditPanel({ spec, onCommit, eventId, onDeselect }: { spec: StudySpec; onCommit: CommitEdit; eventId: string | null; onDeselect(): void }) {
  const { draft, change, problem } = useLiveDraft(spec, onCommit);
  /** The survey being built or edited in the panel. */
  const [building, setBuilding] = useState<string | null>(null);
  const [addFor, setAddFor] = useState(spec.surveys[0]?.['Survey.Name'] ?? '');
  // Clicking a window on the calendar shows that window.
  useEffect(() => {
    if (eventId) setBuilding(null);
  }, [eventId]);
  if (!draft) return null;
  const event = eventId ? draft.schedules.flatMap((x) => x.events).find((x) => x.id === eventId) : undefined;
  const eventSurvey = event ? String((event.extensions as Record<string, unknown> | undefined)?.['Survey.Name'] ?? '') : '';

  const newSurvey = () => {
    const used = new Set(draft.surveys.map((s) => s['Survey.Name']));
    let name = 'new_survey';
    for (let k = 2; used.has(name); k++) name = `new_survey_${k}`;
    const withSurvey: StudySpec = { ...draft, surveys: [...draft.surveys, { 'Survey.Name': name, 'Survey.LongName': 'New survey', questions: [] }] };
    // Repeats daily for a week, 9–10 AM, from the study's first day; change it below.
    change(addSurveyEvent(withSurvey, name, 'New survey'), 'Added a new repeating survey');
    onDeselect();
    setBuilding(name);
  };

  const status = <p className={`dm-hint ${problem ? 'dm-dirty' : ''}`}>{problem ? `Not saved yet: ${problem}` : 'Changes save as you go · Ctrl+Z undoes'}</p>;

  if (building) {
    return (
      <div className="dm-cal-edit">
        <button className="dm-link-btn dm-cal-back" onClick={() => setBuilding(null)}>
          ‹ Back
        </button>
        <SurveyBuilder spec={draft} surveyName={building} change={change} />
        {status}
      </div>
    );
  }

  return (
    <div className="dm-cal-edit">
      {event ? (
        <>
          <div className="dm-cal-window-edit">
            <EventFields spec={draft} event={event} onSpecChange={(next, label) => change(next, label, `event:${event.id}`)} onRemoved={onDeselect} />
          </div>
          {eventSurvey && draft.surveys.some((s) => s['Survey.Name'] === eventSurvey) && (
            <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setBuilding(eventSurvey)}>
              Edit this survey’s questions and windows
            </button>
          )}
        </>
      ) : (
        <p className="dm-hint">Click a window on the calendar to change it, or:</p>
      )}
      <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={newSurvey}>
        + New repeating survey
      </button>
      <Field label="Participants start on" hint="Set this when everyone’s day 1 is the same weekday, so the calendar can show weekdays and weekends.">
        <select
          className="dm-input dm-input-sm"
          value={draft.schedules.map((s) => s.extensions?.['Study.Day1.Weekday']).find(Boolean) ?? ''}
          onChange={(e) => {
            const v = e.target.value as NonNullable<NonNullable<StudySpec['schedules'][number]['extensions']>['Study.Day1.Weekday']> | '';
            const schedules = draft.schedules.map((s, i) => {
              const { 'Study.Day1.Weekday': _old, ...rest } = s.extensions ?? {};
              const ext = i === 0 && v ? { ...rest, 'Study.Day1.Weekday': v } : rest;
              const { extensions: _e, ...base } = s;
              return Object.keys(ext).length ? { ...base, extensions: ext } : base;
            });
            change({ ...draft, schedules: schedules as StudySpec['schedules'] }, v ? 'Set the weekday participants start on' : 'Cleared the start weekday');
          }}
        >
          <option value="">Any day (each participant’s own)</option>
          {(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const).map((c, i) => (
            <option key={c} value={c}>
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}
            </option>
          ))}
        </select>
      </Field>
      <div className="dm-skip-row">
        <select className="dm-input dm-input-sm" value={addFor} onChange={(e) => setAddFor(e.target.value)} aria-label="Survey">
          {draft.surveys.map((s) => (
            <option key={s['Survey.Name']} value={s['Survey.Name']}>
              {surveyLabel(s)}
            </option>
          ))}
        </select>
        <button
          className="dm-btn dm-btn-secondary dm-btn-sm"
          onClick={() => {
            const s = draft.surveys.find((x) => x['Survey.Name'] === addFor);
            if (s) change(addSurveyEvent(draft, addFor, surveyLabel(s)), `Added a window for ${surveyLabel(s)}`);
          }}
        >
          + Add a window
        </button>
        <button className="dm-link-btn" onClick={() => setBuilding(addFor)}>
          Edit survey
        </button>
      </div>
      {status}
    </div>
  );
}

/** One survey, built in the side panel: name, delivery windows, questions. */
function SurveyBuilder({ spec, surveyName, change }: { spec: StudySpec; surveyName: string; change(next: StudySpec, label?: string, mergeKey?: string): void }) {
  const [open, setOpen] = useState<string | null>(null);
  const si = spec.surveys.findIndex((s) => s['Survey.Name'] === surveyName);
  const survey = spec.surveys[si];
  const copyOptions = useMemo(
    () => allQuestions(spec).filter((h) => h.surveyName !== surveyName && !h.block).map((h) => questionOption(h, true)),
    [spec, surveyName],
  );
  if (!survey) return <p className="dm-empty">This survey is no longer in the study.</p>;
  const setSurvey = (s: Survey, label?: string) => change(withSurveyReplaced(spec, si, s), label, `survey:${surveyName}`);
  const events = surveyEvents(spec, surveyName);
  const items = (survey.questions ?? []).filter((q) => !isEndBlock(q));

  return (
    <div className="dm-cal-builder">
      <Field label="Survey name">
        <input className="dm-input" value={survey['Survey.LongName'] ?? ''} onChange={(e) => setSurvey({ ...survey, 'Survey.LongName': e.target.value })} />
      </Field>

      <h4>When it’s sent</h4>
      {!events.length && <p className="dm-empty">Not on the schedule yet.</p>}
      {events.map((e) => (
        <div key={e.id} className="dm-cal-window-edit">
          <EventFields spec={spec} event={e} onSpecChange={(next, label) => change(next, label, `event:${e.id}`)} />
        </div>
      ))}
      <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => change(addSurveyEvent(spec, surveyName, surveyLabel(survey)), `Added a window for ${surveyLabel(survey)}`)}>
        + Add a window
      </button>

      <h4>Questions</h4>
      {!items.length && <p className="dm-empty">No questions yet. Add one, or copy one from another survey.</p>}
      <ul className="dm-cal-questions">
        {items.map((q) => (
          <li key={q['Item.ID']} className={open === q['Item.ID'] ? 'is-open' : ''}>
            <div className="dm-cal-question">
              <button className="dm-cal-question-name" onClick={() => setOpen(open === q['Item.ID'] ? null : q['Item.ID'])} aria-expanded={open === q['Item.ID']}>
                <code>{q['Question.ID']}</code> {isBlock(q) ? `▸ ${q['Question.Long.Name'] ?? ''}` : q['Question.Text']}
              </button>
              <button
                className="dm-icon-btn"
                aria-label={`Delete ${q['Question.ID']}`}
                title="Delete (its data stays; undo with Ctrl+Z)"
                onClick={() => change(deleteItems(spec, surveyName, [q['Item.ID']], false), `Deleted ${q['Question.ID']}`)}
              >
                ×
              </button>
            </div>
            {open === q['Item.ID'] && (
              <ItemForm
                spec={spec}
                surveyName={surveyName}
                itemId={q['Item.ID']}
                onSpecChange={(next, label) => change(next, label, `item:${surveyName}/${q['Item.ID']}`)}
                onDelete={() => change(deleteItems(spec, surveyName, [q['Item.ID']], false), `Deleted ${q['Question.ID']}`)}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="dm-skip-row">
        <button
          className="dm-btn dm-btn-secondary dm-btn-sm"
          onClick={() => {
            const r = addItem(survey, 'question');
            setSurvey(r.survey, 'Added a question');
            setOpen(r.itemId);
          }}
        >
          + Question
        </button>
        <SearchPicker
          options={copyOptions}
          placeholder="Copy a question from another survey…"
          onPick={(o) => {
            const src = spec.surveys.find((s) => s['Survey.Name'] === o.hit!.surveyName)?.questions?.find((q) => q['Item.ID'] === o.hit!.itemId);
            if (!src) return;
            const r = copyQuestion(survey, src);
            setSurvey(r.survey, `Copied ${src['Question.ID']} into ${surveyLabel(survey)}`);
            setOpen(r.itemId);
          }}
        />
      </div>
    </div>
  );
}
