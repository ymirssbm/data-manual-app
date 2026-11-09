// Survey Editor: edit questions, blocks and skip logic of the loaded study, and try the survey in a
// live SurveyJS form. Edits stay in a draft until "Apply changes", which validates them like any import.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { isBlock, isEndBlock, validateSpec, type Question, type StudySpec, type Survey, type ValidationResult } from '../../core';
import { QUESTION_TYPES } from '../../generators';
import { addItem, deleteItem, descendants, getSkipRule, moveItem, possibleParents, setBlock, setSkipRule, updateItem, uniqueId, type SkipRule } from '../../editor/edit';
import { exportSurveyJs, surveyJsPageToSurvey, withSurveyReplaced } from '../../exporters';
import type { Op } from '../../exporters/logic';
import type { PageId } from '../App';
import { Field, Icon, PageTitle } from '../ui';
import { download } from '../util';
import { NoStudy } from './common';

const SurveyPreview = lazy(() => import('./SurveyPreview'));

const TYPES = QUESTION_TYPES.filter((t) => t !== 'Block');
const DATA_TYPES = ['integer', 'numeric', 'character'] as const;
const WITH_OPTIONS = new Set(['Multiple Choice', 'Multiple Select', 'Slider', 'Multiple Slider', 'Time Scale Slider']);

interface Props {
  spec: StudySpec | null;
  go(id: PageId): void;
  onApply(spec: StudySpec, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning'): void;
}

export function SurveyEditorPage({ spec, go, onApply, notify }: Props) {
  const [draft, setDraft] = useState<StudySpec | null>(spec);
  const [si, setSi] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<'edit' | 'preview'>('edit');

  // A newly loaded study replaces the draft (unless there are unsaved edits).
  useEffect(() => {
    if (!dirty) {
      setDraft(spec);
      setSi((i) => Math.min(i, Math.max(0, (spec?.surveys.length ?? 1) - 1)));
    }
  }, [spec, dirty]);

  if (!spec || !draft) return <NoStudy go={go} what="a survey to edit" />;
  const survey = draft.surveys[si] ?? draft.surveys[0]!;
  const change = (next: Survey) => {
    setDraft(withSurveyReplaced(draft, si, next));
    setDirty(true);
  };
  const apply = () => {
    const r = validateSpec(draft);
    if (!r.spec) {
      notify(`Not applied: ${r.issues.find((i) => i.severity === 'error')?.message ?? 'the study is not valid'}.`, 'error');
      return;
    }
    onApply(r.spec, r);
    setDirty(false);
  };
  const discard = () => {
    setDraft(spec);
    setDirty(false);
    setSelected(null);
  };
  const addSurvey = () => {
    const used = new Set(draft.surveys.map((s) => s['Survey.Name']));
    let name = 'new_survey';
    for (let k = 2; used.has(name); k++) name = `new_survey_${k}`;
    setDraft({ ...draft, surveys: [...draft.surveys, { 'Survey.Name': name, 'Survey.LongName': 'New survey', questions: [] }] });
    setSi(draft.surveys.length);
    setDirty(true);
  };
  const importSurveyJs = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { pages?: Array<Record<string, unknown>>; elements?: unknown[] };
      const page = json.pages?.[0] ?? (json.elements ? (json as Record<string, unknown>) : null);
      if (!page) throw new Error('No pages or elements found.');
      change(surveyJsPageToSurvey(page, survey));
      notify(`Replaced "${survey['Survey.LongName'] || survey['Survey.Name']}" with ${file.name}. Skip logic is kept for items that still exist.`);
    } catch (e) {
      notify(`Could not read ${file.name}: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <>
      <PageTitle
        actions={
          <>
            {dirty && <span className="dm-hint dm-dirty">Unapplied changes</span>}
            <button className="dm-btn dm-btn-secondary" onClick={discard} disabled={!dirty}>
              Discard
            </button>
            <button className="dm-btn dm-btn-primary" onClick={apply} disabled={!dirty}>
              Apply changes
            </button>
          </>
        }
      >
        Survey Editor
      </PageTitle>

      <div className="dm-editor-surveys">
        {draft.surveys.map((s, i) => (
          <button key={s['Survey.Name'] + i} className={i === si ? 'is-active' : ''} onClick={() => (setSi(i), setSelected(null))}>
            {s['Survey.LongName'] || s['Survey.Name']}
          </button>
        ))}
        <button className="dm-editor-add-survey" onClick={addSurvey} title="Add a survey">
          + Survey
        </button>
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
          </div>
          <ItemList survey={survey} selected={selected} onSelect={(id) => (setSelected(id), setView('edit'))} />
          <div className="dm-editor-list-actions">
            <button
              className="dm-btn dm-btn-secondary dm-btn-sm"
              onClick={() => {
                const r = addItem(survey, 'question', { afterId: selected });
                change(r.survey);
                setSelected(r.itemId);
              }}
            >
              + Question
            </button>
            <button
              className="dm-btn dm-btn-secondary dm-btn-sm"
              onClick={() => {
                const r = addItem(survey, 'block', { afterId: selected });
                change(r.survey);
                setSelected(r.itemId);
              }}
            >
              + Block
            </button>
            <span className="dm-push-right dm-inline dm-inline-tight">
              <button className="dm-link-btn" onClick={() => { const f = exportSurveyJs(draft, survey['Survey.Name']); download(f.fileName, f.text, f.mime); }}>
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
            <button className={view === 'preview' ? 'is-active' : ''} onClick={() => setView('preview')}>
              Try the survey
            </button>
          </div>
          {view === 'preview' ? (
            <Suspense fallback={<p className="dm-empty">Loading the form…</p>}>
              <SurveyPreview survey={survey} />
            </Suspense>
          ) : selected && survey.questions?.some((q) => q['Item.ID'] === selected) ? (
            <ItemForm
              key={selected}
              survey={survey}
              itemId={selected}
              onChange={change}
              onDelete={() => {
                change(deleteItem(survey, selected));
                setSelected(null);
              }}
            />
          ) : (
            <p className="dm-empty">Pick a question or block on the left to edit it, or add one.</p>
          )}
        </section>
      </div>
    </>
  );
}

function ItemList({ survey, selected, onSelect }: { survey: Survey; selected: string | null; onSelect(id: string): void }) {
  const byId = useMemo(() => new Map((survey.questions ?? []).map((q) => [q['Item.ID'], q])), [survey]);
  const depth = (q: Question) => {
    let d = 0;
    for (let p = q.Parent ? byId.get(q.Parent) : undefined; p && isBlock(p); p = p.Parent ? byId.get(p.Parent) : undefined) d++;
    return d;
  };
  const items = (survey.questions ?? []).filter((q) => !isEndBlock(q));
  if (!items.length) return <p className="dm-empty">This survey has no questions yet.</p>;
  return (
    <ul className="dm-editor-items">
      {items.map((q) => {
        const rule = getSkipRule(survey, q['Item.ID']);
        return (
          <li key={q['Item.ID']} style={{ paddingLeft: `${depth(q) * 16}px` }}>
            <button className={`${selected === q['Item.ID'] ? 'is-active' : ''}${isBlock(q) ? ' is-block' : ''}`} onClick={() => onSelect(q['Item.ID'])}>
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

function ItemForm({ survey, itemId, onChange, onDelete }: { survey: Survey; itemId: string; onChange(s: Survey): void; onDelete(): void }) {
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
          <select className="dm-input" value={q.Parent && blocks.some((b) => b['Item.ID'] === q.Parent) ? q.Parent : ''} onChange={(e) => onChange(setBlock(survey, itemId, e.target.value || null))}>
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
      <SkipEditor survey={survey} itemId={itemId} onChange={onChange} />
      <div className="dm-editor-form-actions">
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => onChange(moveItem(survey, itemId, -1))}>
          ↑ Move up
        </button>
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => onChange(moveItem(survey, itemId, 1))}>
          ↓ Move down
        </button>
        <button className="dm-btn dm-btn-danger dm-btn-sm dm-push-right" onClick={onDelete}>
          <Icon name="close" size={14} /> Delete {block ? 'block and its questions' : 'question'}
        </button>
      </div>
    </div>
  );
}

const OPS: Array<[Op, string]> = [
  ['=', 'equals'],
  ['!=', 'is not'],
  ['>=', 'is at least'],
  ['<=', 'is at most'],
  ['>', 'is more than'],
  ['<', 'is less than'],
];

function SkipEditor({ survey, itemId, onChange }: { survey: Survey; itemId: string; onChange(s: Survey): void }) {
  const rule = getSkipRule(survey, itemId);
  const parents = possibleParents(survey, itemId);
  const parent = rule ? survey.questions!.find((q) => q['Item.ID'] === rule.parentId) : undefined;
  const hasOptions = !!parent && (parent['Question.Type.Display.Name'] === 'Multiple Choice' || parent['Question.Type.Display.Name'] === 'Multiple Select');
  const update = (r: SkipRule | null) => onChange(setSkipRule(survey, itemId, r));
  const pickParent = (id: string) => {
    if (!id) return update(null);
    const p = parents.find((x) => x['Item.ID'] === id)!;
    const opts = p.responseKey ?? [];
    const choice = p['Question.Type.Display.Name'] === 'Multiple Choice' || p['Question.Type.Display.Name'] === 'Multiple Select';
    update(choice ? { parentId: id, kind: 'in', values: opts.length ? [String(opts[0]!.value)] : [] } : { parentId: id, kind: 'cmp', op: '>=', value: '1' });
  };
  return (
    <fieldset className="dm-skip">
      <legend>Show {isBlock(survey.questions!.find((q) => q['Item.ID'] === itemId)!) ? 'this block' : 'this question'}</legend>
      <div className="dm-skip-row">
        <select className="dm-input dm-input-sm" value={rule?.parentId ?? ''} onChange={(e) => pickParent(e.target.value)}>
          <option value="">Always</option>
          {parents.map((p) => (
            <option key={p['Item.ID']} value={p['Item.ID']}>
              Only if {p['Question.ID']}: {(p['Question.Text'] ?? '').slice(0, 50)}
            </option>
          ))}
        </select>
      </div>
      {rule && parent && hasOptions && (
        <div className="dm-skip-values">
          <span className="dm-hint">{parent['Question.Type.Display.Name'] === 'Multiple Select' ? 'includes any of' : 'is any of'}</span>
          {(parent.responseKey ?? []).map((o) => {
            const v = String(o.value);
            const on = rule.kind === 'in' && rule.values.includes(v);
            return (
              <label key={v} className="dm-check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const values = rule.kind === 'in' ? rule.values : [];
                    const next = on ? values.filter((x) => x !== v) : [...values, v];
                    update(next.length ? { parentId: rule.parentId, kind: 'in', values: next } : null);
                  }}
                />
                {o.definition}
              </label>
            );
          })}
        </div>
      )}
      {rule && parent && !hasOptions && (
        <div className="dm-skip-row">
          <select className="dm-input dm-input-sm" value={rule.kind === 'cmp' ? rule.op : '='} onChange={(e) => update({ parentId: rule.parentId, kind: 'cmp', op: e.target.value as Op, value: rule.kind === 'cmp' ? rule.value : '' })}>
            {OPS.map(([op, label]) => (
              <option key={op} value={op}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="dm-input dm-input-sm"
            value={rule.kind === 'cmp' ? rule.value : (rule.values[0] ?? '')}
            onChange={(e) => update({ parentId: rule.parentId, kind: 'cmp', op: rule.kind === 'cmp' ? rule.op : '=', value: e.target.value })}
            aria-label="Value"
          />
        </div>
      )}
    </fieldset>
  );
}
