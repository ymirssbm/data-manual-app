// Survey Editor: edit questions, blocks and logic of the loaded study, its schedule, and try the
// survey in a live SurveyJS form. Edits save as you make them (undo with Ctrl+Z). Click selects an
// item; Ctrl/Cmd-click and Shift-click select several (then "+ Block" puts them in a block, Delete
// or the Delete key removes them).
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { isBlock, isEndBlock, type Question, type StudySpec, type Survey } from '../../core';
import { QUESTION_TYPES } from '../../generators';
import { addItem, descendants, getSkipRule, groupIntoBlock, moveItem, setBlock, updateItem, uniqueId } from '../../editor/edit';
import { allQuestions } from '../../editor/search';
import { ScheduleEditor } from './SurveyScheduleEditor';
import { exportSurveyJs, surveyJsPageToSurvey, withSurveyReplaced } from '../../exporters';
import type { PageId } from '../App';
import { Field, Icon, PageTitle } from '../ui';
import { download } from '../util';
import { NoStudy } from './common';
import { LogicEditor } from '../LogicEditor';
import { BlockSettings } from '../BlockSettings';
import { questionOption, SearchPicker } from '../SearchPicker';
import { DeleteDialog } from '../StudyEditDialogs';
import { deleteItems } from '../../editor/data';
import { useLiveDraft, type CommitEdit } from '../useLiveDraft';

const SurveyPreview = lazy(() => import('./SurveyPreview'));

const TYPES = QUESTION_TYPES.filter((t) => t !== 'Block');
const DATA_TYPES = ['integer', 'numeric', 'character'] as const;
const WITH_OPTIONS = new Set(['Multiple Choice', 'Multiple Select', 'Slider', 'Multiple Slider', 'Time Scale Slider']);

interface Props {
  spec: StudySpec | null;
  /** Open on this survey (and tab), e.g. from the Study Schedule page. */
  target?: { surveyName: string; tab: 'edit' | 'schedule' } | null;
  onTargetUsed?(): void;
  go(id: PageId): void;
  onEdit: CommitEdit;
  notify(text: string, kind?: 'message' | 'error' | 'warning'): void;
}

/**
 * Click-to-select with Ctrl/Cmd (toggle) and Shift (range), like a file list. Returns the new
 * selection; `anchor` is where the next Shift-click range starts.
 */
export function clickSelect(order: string[], current: string[], anchor: string | null, id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): string[] {
  if (e.shiftKey && anchor && order.includes(anchor)) {
    const i = order.indexOf(anchor);
    const j = order.indexOf(id);
    const range = order.slice(Math.min(i, j), Math.max(i, j) + 1);
    return e.ctrlKey || e.metaKey ? [...new Set([...current, ...range])] : range;
  }
  if (e.ctrlKey || e.metaKey) return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  return [id];
}

export function SurveyEditorPage({ spec, go, onEdit, notify, target, onTargetUsed }: Props) {
  const { draft, change: changeSpec, problem } = useLiveDraft(spec, onEdit);
  const [si, setSi] = useState(0);
  /** Selected items; the last one clicked is edited on the right. */
  const [sel, setSel] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [view, setView] = useState<'edit' | 'schedule' | 'preview'>('edit');
  const [deleting, setDeleting] = useState<string[] | null>(null);

  useEffect(() => {
    if (!target || !spec) return;
    const i = spec.surveys.findIndex((s) => s['Survey.Name'] === target.surveyName);
    if (i >= 0) setSi(i);
    setView(target.tab);
    onTargetUsed?.();
  }, [target, spec, onTargetUsed]);

  useEffect(() => setSi((i) => Math.min(i, Math.max(0, (draft?.surveys.length ?? 1) - 1))), [draft]);

  // The Delete key removes the selected items (their data stays; undo with Ctrl+Z).
  const deleteSelected = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], .dm-modal')) return;
      e.preventDefault();
      deleteSelected.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const searchOptions = useMemo(() => (draft ? allQuestions(draft).map((h) => questionOption(h, true)) : []), [draft]);

  if (!spec || !draft) return <NoStudy go={go} what="a survey to edit" />;
  const survey = draft.surveys[si] ?? draft.surveys[0]!;
  const selected = sel[sel.length - 1] ?? null;
  const change = (next: Survey, label?: string) => changeSpec(withSurveyReplaced(draft, si, next), label, `survey:${si}:${selected}`);
  const select = (ids: string[]) => {
    setSel(ids);
    setView('edit');
  };
  deleteSelected.current = () => {
    if (!sel.length || view !== 'edit') return;
    const names = sel.map((id) => survey.questions?.find((q) => q['Item.ID'] === id)?.['Question.ID'] ?? id);
    changeSpec(deleteItems(draft, survey['Survey.Name'], sel, false), sel.length === 1 ? `Deleted ${names[0]}` : `Deleted ${sel.length} items`);
    setSel([]);
  };
  const addSurvey = () => {
    const used = new Set(draft.surveys.map((s) => s['Survey.Name']));
    let name = 'new_survey';
    for (let k = 2; used.has(name); k++) name = `new_survey_${k}`;
    changeSpec({ ...draft, surveys: [...draft.surveys, { 'Survey.Name': name, 'Survey.LongName': 'New survey', questions: [] }] }, 'Added a survey');
    setSi(draft.surveys.length);
    setSel([]);
  };
  const importSurveyJs = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { pages?: Array<Record<string, unknown>>; elements?: unknown[] };
      const page = json.pages?.[0] ?? (json.elements ? (json as Record<string, unknown>) : null);
      if (!page) throw new Error('No pages or elements found.');
      change(surveyJsPageToSurvey(page, survey), `Imported ${file.name}`);
      notify(`Replaced "${survey['Survey.LongName'] || survey['Survey.Name']}" with ${file.name}. Skip logic is kept for items that still exist.`);
    } catch (e) {
      notify(`Could not read ${file.name}: ${(e as Error).message}`, 'error');
    }
  };
  const multi = sel.length > 1;

  return (
    <>
      <PageTitle
        actions={
          problem ? (
            <span className="dm-hint dm-dirty" title={problem}>
              Not saved yet: {problem}
            </span>
          ) : (
            <span className="dm-hint">Changes save as you go · Ctrl+Z undoes</span>
          )
        }
      >
        Survey Editor
      </PageTitle>

      <div className="dm-editor-surveys">
        {draft.surveys.map((s, i) => (
          <button key={s['Survey.Name'] + i} className={i === si ? 'is-active' : ''} onClick={() => (setSi(i), setSel([]))}>
            {s['Survey.LongName'] || s['Survey.Name']}
          </button>
        ))}
        <button className="dm-editor-add-survey" onClick={addSurvey} title="Add a survey">
          + Survey
        </button>
        <span className="dm-editor-search">
          <SearchPicker
            options={searchOptions}
            placeholder="Find a question: ID, wording or type…"
            onPick={(o) => {
              const i = draft.surveys.findIndex((s) => s['Survey.Name'] === o.hit!.surveyName);
              if (i >= 0) setSi(i);
              select([o.hit!.itemId]);
              setAnchor(o.hit!.itemId);
            }}
          />
        </span>
      </div>

      <div className="dm-editor">
        <section className="dm-editor-list" aria-label="Questions">
          <div className="dm-editor-survey-meta">
            <Field label="Survey name (shown)">
              <input className="dm-input" value={survey['Survey.LongName'] ?? ''} onChange={(e) => change({ ...survey, 'Survey.LongName': e.target.value })} />
            </Field>
            <Field label="Survey ID">
              <input className="dm-input" value={survey['Survey.Name']} onChange={(e) => change({ ...survey, 'Survey.Name': e.target.value.replace(/\s+/g, '_') })} />
            </Field>
            <Field label="Kind">
              <select
                className="dm-input"
                value={survey['Survey.Role'] ?? 'Assessment'}
                onChange={(e) => {
                  const { 'Survey.Role': _old, ...rest } = survey;
                  change(e.target.value === 'Intervention' ? { ...rest, 'Survey.Role': 'Intervention' } : rest, e.target.value === 'Intervention' ? 'Marked the survey as an intervention' : 'Marked the survey as an assessment');
                }}
                title="An intervention delivers content (a message, prompt or activity) rather than measuring"
              >
                <option value="Assessment">Assessment (questions)</option>
                <option value="Intervention">Intervention (content delivered)</option>
              </select>
            </Field>
          </div>
          <p className="dm-hint dm-editor-tip">Click to select · Ctrl-click or Shift-click to select several, then + Block, or press Delete.</p>
          <ItemList
            survey={survey}
            selected={sel}
            onClick={(id, e) => {
              const order = (survey.questions ?? []).filter((q) => !isEndBlock(q)).map((q) => q['Item.ID']);
              select(clickSelect(order, sel, anchor, id, e));
              if (!e.shiftKey) setAnchor(id);
            }}
          />
          <div className="dm-editor-list-actions">
            <button
              className="dm-btn dm-btn-secondary dm-btn-sm"
              onClick={() => {
                const r = addItem(survey, 'question', { afterId: selected });
                change(r.survey, 'Added a question');
                select([r.itemId]);
              }}
            >
              + Question
            </button>
            <button
              className="dm-btn dm-btn-secondary dm-btn-sm"
              title={multi ? `Put the ${sel.length} selected items in a new block` : 'Add an empty block after the selected item'}
              onClick={() => {
                if (multi) {
                  const r = groupIntoBlock(survey, sel, 'New block');
                  if (r.blockId) {
                    change(r.survey, `Put ${sel.length} items in a block`);
                    select([r.blockId]);
                    notify(`Put ${sel.length} items in a new block. Name it on the right.`);
                  }
                  return;
                }
                const r = addItem(survey, 'block', { afterId: selected });
                change(r.survey, 'Added a block');
                select([r.itemId]);
              }}
            >
              + Block{multi ? ` (${sel.length})` : ''}
            </button>
            {sel.length > 0 && (
              <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setDeleting(sel)}>
                Delete{multi ? ` (${sel.length})` : ''}
              </button>
            )}
            <span className="dm-push-right dm-inline dm-inline-tight">
              <button
                className="dm-link-btn"
                onClick={() => {
                  const f = exportSurveyJs(draft, survey['Survey.Name']);
                  download(f.fileName, f.text, f.mime);
                }}
              >
                SurveyJS JSON
              </button>
              <label className="dm-link-btn">
                Import
                <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importSurveyJs(e.target.files[0])} />
              </label>
            </span>
          </div>
        </section>

        <section className="dm-editor-main">
          <div className="dm-segmented dm-segmented-inline">
            <button className={view === 'edit' ? 'is-active' : ''} onClick={() => setView('edit')}>
              Edit item
            </button>
            <button className={view === 'schedule' ? 'is-active' : ''} onClick={() => setView('schedule')}>
              Schedule
            </button>
            <button className={view === 'preview' ? 'is-active' : ''} onClick={() => setView('preview')}>
              Try the survey
            </button>
          </div>
          {view === 'preview' ? (
            <Suspense fallback={<p className="dm-empty">Loading the form…</p>}>
              <SurveyPreview survey={survey} />
            </Suspense>
          ) : view === 'schedule' ? (
            <ScheduleEditor spec={draft} survey={survey} onSpecChange={(next, label) => changeSpec(next, label, `schedule:${si}`)} />
          ) : multi ? (
            <div className="dm-editor-form">
              <p>
                <strong>{sel.length} items selected.</strong> Use <strong>+ Block</strong> to put them in a block, or press <strong>Delete</strong>. Click one item to edit it.
              </p>
            </div>
          ) : selected && survey.questions?.some((q) => q['Item.ID'] === selected) ? (
            <ItemForm key={selected} spec={draft} surveyName={survey['Survey.Name']} itemId={selected} onSpecChange={(next, label) => changeSpec(next, label, `item:${selected}`)} onDelete={() => setDeleting([selected])} />
          ) : (
            <p className="dm-empty">Pick a question or block on the left to edit it, or add one.</p>
          )}
        </section>
      </div>
      {deleting && (
        <DeleteDialog
          spec={draft}
          surveyName={survey['Survey.Name']}
          itemIds={deleting}
          onClose={() => setDeleting(null)}
          onDelete={(next, label) => {
            changeSpec(next, label);
            setDeleting(null);
            setSel([]);
          }}
        />
      )}
    </>
  );
}

function ItemList({ survey, selected, onClick }: { survey: Survey; selected: string[]; onClick(id: string, e: MouseEvent): void }) {
  const byId = useMemo(() => new Map((survey.questions ?? []).map((q) => [q['Item.ID'], q])), [survey]);
  const depth = (q: Question) => {
    let d = 0;
    for (let p = q.Parent ? byId.get(q.Parent) : undefined; p && isBlock(p); p = p.Parent ? byId.get(p.Parent) : undefined) d++;
    return d;
  };
  const items = (survey.questions ?? []).filter((q) => !isEndBlock(q));
  if (!items.length) return <p className="dm-empty">This survey has no questions yet.</p>;
  return (
    <ul className="dm-editor-items" role="listbox" aria-multiselectable="true">
      {items.map((q) => {
        const rule = getSkipRule(survey, q['Item.ID']);
        const on = selected.includes(q['Item.ID']);
        return (
          <li key={q['Item.ID']} style={{ paddingLeft: `${depth(q) * 16}px` }} role="option" aria-selected={on}>
            <button
              className={`${on ? 'is-active' : ''}${isBlock(q) ? ' is-block' : ''}`}
              onClick={(e) => onClick(q['Item.ID'], e)}
              onMouseDown={(e) => e.shiftKey && e.preventDefault() /* no text selection on Shift-click */}
            >
              <span className="dm-editor-item-text">{isBlock(q) ? `▸ ${q['Question.Long.Name'] || q['Question.ID']}` : q['Question.Text'] || q['Question.ID']}</span>
              <span className="dm-editor-item-meta">
                <code>{q['Question.ID']}</code>
                {!isBlock(q) && <span>{q['Question.Type.Display.Name']}</span>}
                {rule && <span className="dm-editor-if">if {byId.get(rule.parentId)?.['Question.ID']}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A question's or block's fields and logic. Works on the whole study (logic can reach other surveys). */
export function ItemForm({
  spec,
  surveyName,
  itemId,
  onSpecChange,
  onDelete,
}: {
  spec: StudySpec;
  surveyName: string;
  itemId: string;
  /** `label` marks a distinct action (its own undo step); without one it's typing. */
  onSpecChange(s: StudySpec, label?: string): void;
  onDelete(): void;
}) {
  const si = spec.surveys.findIndex((s) => s['Survey.Name'] === surveyName);
  const survey = spec.surveys[si]!;
  const onChange = (s: Survey, label?: string) => onSpecChange(withSurveyReplaced(spec, si, s), label);
  const q = survey.questions!.find((x) => x['Item.ID'] === itemId)!;
  const block = isBlock(q);
  const set = (patch: Partial<Question>) => onChange(updateItem(survey, itemId, patch));
  const blocks = (survey.questions ?? []).filter((x) => isBlock(x) && x['Item.ID'] !== itemId && !descendants(survey, itemId).has(x['Item.ID']));
  const type = q['Question.Type.Display.Name'];
  const options = q.responseKey ?? [];
  const setOptions = (next: NonNullable<Question['responseKey']>) => set({ responseKey: next });

  return (
    <div className="dm-editor-form">
      {block ? (
        <Field label="Block name">
          <input className="dm-input" value={q['Question.Long.Name'] ?? ''} onChange={(e) => set({ 'Question.Long.Name': e.target.value })} />
        </Field>
      ) : (
        <Field label="Question text">
          <textarea className="dm-input" rows={2} value={q['Question.Text'] ?? ''} onChange={(e) => set({ 'Question.Text': e.target.value })} />
        </Field>
      )}
      <div className="dm-grid-2 dm-gap-sm">
        <Field label={block ? 'Block ID' : 'Variable name (Question ID)'}>
          <input
            className="dm-input"
            value={q['Question.ID']}
            onChange={(e) => set({ 'Question.ID': e.target.value.replace(/\s+/g, '_') })}
            onBlur={(e) => {
              const taken = (survey.questions ?? []).some((x) => x !== q && x['Question.ID'] === e.target.value);
              if (taken || !e.target.value) set({ 'Question.ID': uniqueId(survey, e.target.value || itemId) });
            }}
          />
        </Field>
        <Field label="In block">
          <select className="dm-input" value={q.Parent && blocks.some((b) => b['Item.ID'] === q.Parent) ? q.Parent : ''} onChange={(e) => onChange(setBlock(survey, itemId, e.target.value || null), `Moved ${q['Question.ID']} to another block`)}>
            <option value="">(not in a block)</option>
            {blocks.map((b) => (
              <option key={b['Item.ID']} value={b['Item.ID']}>
                {b['Question.Long.Name'] || b['Question.ID']}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!block && (
        <>
          <div className="dm-grid-2 dm-gap-sm">
            <Field label="Question type">
              <select
                className="dm-input"
                value={type}
                onChange={(e) => {
                  const t = e.target.value;
                  const patch: Partial<Question> = { 'Question.Type.Display.Name': t as Question['Question.Type.Display.Name'] };
                  if (t === 'Multiple Choice' || t === 'Multiple Select') patch['Data.Type'] = 'integer';
                  if (t === 'Slider') {
                    patch['Data.Type'] = 'numeric';
                    if (!options.length) patch.responseKey = [{ value: '0', definition: 'Not at all' }, { value: '100', definition: 'Extremely' }];
                  }
                  if (t === 'Informational Fullscreen') patch['Data.Type'] = null;
                  set(patch);
                }}
              >
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Type of data">
              <select className="dm-input" value={q['Data.Type'] ?? ''} onChange={(e) => set({ 'Data.Type': (e.target.value || null) as Question['Data.Type'] })}>
                <option value="">(none)</option>
                {DATA_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          {WITH_OPTIONS.has(type) && (
            <Field label={type === 'Slider' ? 'Slider end labels (value = label)' : 'Response options (value = label)'}>
              <div className="dm-options-edit">
                {options.map((o, i) => (
                  <div key={i} className="dm-option-row">
                    <input className="dm-input dm-input-sm dm-option-value" value={o.value} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label="Value" />
                    <input className="dm-input dm-input-sm" value={o.definition} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, definition: e.target.value } : x)))} aria-label="Label" />
                    <button className="dm-icon-btn" aria-label="Remove option" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="dm-link-btn"
                  onClick={() => {
                    const nums = options.map((o) => Number(o.value)).filter(Number.isFinite);
                    setOptions([...options, { value: String(nums.length ? Math.max(...nums) + 1 : 1), definition: '' }]);
                  }}
                >
                  + Add option
                </button>
              </div>
            </Field>
          )}
          <Field label="Description (optional)">
            <input className="dm-input" value={q['Question.Description'] ?? ''} onChange={(e) => set({ 'Question.Description': e.target.value || undefined })} />
          </Field>
        </>
      )}
      {block && <BlockSettings spec={spec} survey={survey} block={q} set={set} />}
      <LogicEditor spec={spec} surveyName={surveyName} itemId={itemId} onSpecChange={(next) => onSpecChange(next)} />
      <div className="dm-editor-form-actions">
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => onChange(moveItem(survey, itemId, -1), `Moved ${q['Question.ID']} up`)}>
          ↑ Move up
        </button>
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => onChange(moveItem(survey, itemId, 1), `Moved ${q['Question.ID']} down`)}>
          ↓ Move down
        </button>
        <button className="dm-btn dm-btn-danger dm-btn-sm dm-push-right" onClick={onDelete}>
          <Icon name="close" size={14} /> Delete {block ? 'block and its questions' : 'question'}
        </button>
      </div>
    </div>
  );
}
