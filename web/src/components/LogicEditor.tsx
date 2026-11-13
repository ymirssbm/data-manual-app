// One place for a question's logic, from either end:
//   "Show this question when…"  — the condition on this item (an earlier question's answer)
//   "What this answer leads to" — later questions/blocks this answer shows, and other surveys it sends
// Both ends edit the same rules: setting "leads to Q5" here is the same as "show Q5 when…" on Q5.
import { useMemo, useState } from 'react';
import { isBlock, type Question, type StudySpec, type Survey } from '../core';
import { getSkipRule, possibleParents, setSkipRule, type SkipRule } from '../editor/edit';
import { addTrigger, opWords, removeTrigger, setTriggerRule, splitDateTime, triggerOf, triggersFrom, type TriggerRule } from '../editor/schedule';
import { allQuestions } from '../editor/search';
import type { Op } from '../exporters/logic';
import { withSurveyReplaced } from '../exporters';
import { firstRule, isChoice } from '../editor/link';
import { questionOption, SearchPicker, type PickOption } from './SearchPicker';

const OPS: Op[] = ['=', '!=', '>=', '<=', '>', '<'];
const surveyLabel = (s: Survey) => s['Survey.LongName'] || s['Survey.Name'];
const itemName = (q: Question) => (isBlock(q) ? `block ${q['Question.Long.Name'] || q['Question.ID']}` : q['Question.ID']);

/** A condition on `parent`'s answer: ticked options for choice questions, else a comparison. */
function Condition({ parent, rule, onChange }: { parent: Question; rule: SkipRule; onChange(r: SkipRule | null): void }) {
  if (isChoice(parent)) {
    const values = rule.kind === 'in' ? rule.values : [];
    return (
      <div className="dm-skip-values">
        <span className="dm-hint">{parent['Question.Type.Display.Name'] === 'Multiple Select' ? 'includes any of' : 'is any of'}</span>
        {(parent.responseKey ?? []).map((o) => {
          const v = String(o.value);
          const on = values.includes(v);
          return (
            <label key={v} className="dm-check">
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  const next = on ? values.filter((x) => x !== v) : [...values, v];
                  onChange(next.length ? { parentId: rule.parentId, kind: 'in', values: next } : null);
                }}
              />
              {o.definition}
            </label>
          );
        })}
      </div>
    );
  }
  return (
    <span className="dm-skip-row">
      <select className="dm-input dm-input-sm" value={rule.kind === 'cmp' ? rule.op : '='} onChange={(e) => onChange({ parentId: rule.parentId, kind: 'cmp', op: e.target.value as Op, value: rule.kind === 'cmp' ? rule.value : '' })}>
        {OPS.map((op) => (
          <option key={op} value={op}>
            {opWords(op)}
          </option>
        ))}
      </select>
      <input
        className="dm-input dm-input-sm dm-skip-value"
        value={rule.kind === 'cmp' ? rule.value : (rule.values[0] ?? '')}
        onChange={(e) => onChange({ parentId: rule.parentId, kind: 'cmp', op: rule.kind === 'cmp' ? rule.op : '=', value: e.target.value })}
        aria-label="Value"
      />
    </span>
  );
}

/** A trigger condition (one comparison; for choice questions, pick the option). */
function TriggerCondition({ source, rule, onChange }: { source: Question; rule: TriggerRule; onChange(r: TriggerRule): void }) {
  const opts = source.responseKey ?? [];
  return (
    <span className="dm-skip-row">
      <select className="dm-input dm-input-sm" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as Op })}>
        {OPS.map((op) => (
          <option key={op} value={op}>
            {opWords(op)}
          </option>
        ))}
      </select>
      {isChoice(source) && opts.length ? (
        <select className="dm-input dm-input-sm" value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })}>
          {opts.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.definition}
            </option>
          ))}
        </select>
      ) : (
        <input className="dm-input dm-input-sm dm-skip-value" value={rule.value} placeholder="value" onChange={(e) => onChange({ ...rule, value: e.target.value })} aria-label="Value" />
      )}
    </span>
  );
}

export function LogicEditor({ spec, surveyName, itemId, onSpecChange }: { spec: StudySpec; surveyName: string; itemId: string; onSpecChange(s: StudySpec): void }) {
  const si = spec.surveys.findIndex((s) => s['Survey.Name'] === surveyName);
  const survey = spec.surveys[si]!;
  const qs = survey.questions ?? [];
  const item = qs.find((q) => q['Item.ID'] === itemId)!;
  const block = isBlock(item);
  const setSurvey = (s: Survey) => onSpecChange(withSurveyReplaced(spec, si, s));

  // ---- incoming: show this item when…
  const rule = getSkipRule(survey, itemId);
  const parent = rule ? qs.find((q) => q['Item.ID'] === rule.parentId) : undefined;
  const parentOptions = useMemo(() => {
    const ok = new Set(possibleParents(survey, itemId).map((q) => q['Item.ID']));
    return allQuestions(spec)
      .filter((h) => h.surveyName === surveyName && ok.has(h.itemId))
      .map((h) => questionOption(h));
  }, [spec, survey, surveyName, itemId]);

  // ---- outgoing: what this answer leads to
  const answerable = !block && item['Question.Type.Display.Name'] !== 'Informational Fullscreen';
  const shows = qs.filter((q) => q['Item.ID'] !== itemId && getSkipRule(survey, q['Item.ID'])?.parentId === itemId);
  const triggers = triggersFrom(spec, item['Question.ID']);
  const triggerTargets = [...new Set(triggers.map((e) => String((e.extensions as Record<string, unknown>)?.['Survey.Name'] ?? '')))];
  const targetOptions = useMemo(() => {
    const laterIds = new Set(qs.filter((q) => q['Item.ID'] !== itemId && possibleParents(survey, q['Item.ID']).some((p) => p['Item.ID'] === itemId)).map((q) => q['Item.ID']));
    const items = allQuestions(spec)
      .filter((h) => h.surveyName === surveyName && laterIds.has(h.itemId))
      .map((h) => questionOption(h));
    const surveys: PickOption[] = spec.surveys
      .filter((s) => s['Survey.Name'] !== surveyName)
      .map((s) => ({ key: `survey:${s['Survey.Name']}`, primary: surveyLabel(s), secondary: 'Send this survey', tag: 'Survey' }));
    return [...items, ...surveys];
  }, [spec, survey, qs, surveyName, itemId]);
  const [adding, setAdding] = useState<PickOption | null>(null);
  const [trig, setTrig] = useState<{ rule: TriggerRule; when: 'same' | 'next'; from: string; to: string }>({ rule: { source: item['Question.ID'], op: '>=', value: '' }, when: 'next', from: '10:00', to: '10:30' });

  return (
    <div className="dm-logic">
      <fieldset className="dm-skip">
        <legend>Show this {block ? 'block' : 'question'}</legend>
        {rule && parent ? (
          <>
            <div className="dm-skip-row">
              <span>Only if</span>
              <SearchPicker options={parentOptions} current={`${parent['Question.ID']}: ${(parent['Question.Text'] ?? '').slice(0, 40)}`} onPick={(o) => {
                const p = qs.find((q) => q['Item.ID'] === o.hit!.itemId)!;
                setSurvey(setSkipRule(survey, itemId, firstRule(p, p['Item.ID'])));
              }} />
              <button className="dm-link-btn dm-push-right" onClick={() => setSurvey(setSkipRule(survey, itemId, null))}>
                Always show
              </button>
            </div>
            <Condition parent={parent} rule={rule} onChange={(r) => setSurvey(setSkipRule(survey, itemId, r))} />
          </>
        ) : (
          <div className="dm-skip-row">
            <span>Always. Or only if…</span>
            {parentOptions.length ? (
              <SearchPicker options={parentOptions} placeholder="pick an earlier question" onPick={(o) => {
                const p = qs.find((q) => q['Item.ID'] === o.hit!.itemId)!;
                setSurvey(setSkipRule(survey, itemId, firstRule(p, p['Item.ID'])));
              }} />
            ) : (
              <span className="dm-hint">(no earlier question can control it)</span>
            )}
          </div>
        )}
      </fieldset>

      {answerable && (
        <fieldset className="dm-skip">
          <legend>What this answer leads to</legend>
          {shows.map((t) => {
            const r = getSkipRule(survey, t['Item.ID'])!;
            return (
              <div key={t['Item.ID']} className="dm-trigger">
                <div className="dm-skip-row">
                  <span>
                    Shows <strong>{itemName(t)}</strong> when the answer
                  </span>
                  <button className="dm-link-btn dm-push-right" onClick={() => setSurvey(setSkipRule(survey, t['Item.ID'], null))}>
                    Remove
                  </button>
                </div>
                <Condition parent={item} rule={r} onChange={(nr) => setSurvey(setSkipRule(survey, t['Item.ID'], nr))} />
              </div>
            );
          })}
          {triggerTargets.map((t) => {
            const evs = triggers.filter((e) => (e.extensions as Record<string, unknown>)?.['Survey.Name'] === t);
            const r = triggerOf(evs[0]!)!;
            const target = spec.surveys.find((s) => s['Survey.Name'] === t);
            return (
              <div key={`survey:${t}`} className="dm-trigger">
                <div className="dm-skip-row">
                  <span>
                    Sends <strong>{target ? surveyLabel(target) : t}</strong> ({splitDateTime(evs[0]!.start).time}–{splitDateTime(evs[0]!.end).time}, {evs.length} window{evs.length === 1 ? '' : 's'}) when the answer
                  </span>
                  <button className="dm-link-btn dm-push-right" onClick={() => onSpecChange(removeTrigger(spec, item['Question.ID'], t))}>
                    Remove
                  </button>
                </div>
                <TriggerCondition source={item} rule={r} onChange={(nr) => onSpecChange(setTriggerRule(spec, item['Question.ID'], t, nr))} />
              </div>
            );
          })}
          {adding ? (
            <div className="dm-trigger is-new">
              {adding.key.startsWith('survey:') ? (
                <>
                  <div className="dm-skip-row">
                    <span>
                      Send <strong>{adding.primary}</strong> when the answer
                    </span>
                  </div>
                  <TriggerCondition source={item} rule={trig.rule} onChange={(r) => setTrig({ ...trig, rule: r })} />
                  <div className="dm-skip-row">
                    <select className="dm-input dm-input-sm" value={trig.when} onChange={(e) => setTrig({ ...trig, when: e.target.value as 'same' | 'next' })}>
                      <option value="same">the same day</option>
                      <option value="next">the next day</option>
                    </select>
                    <span>between</span>
                    <input className="dm-input dm-input-sm" type="time" value={trig.from} onChange={(e) => setTrig({ ...trig, from: e.target.value })} aria-label="From" />
                    <span>and</span>
                    <input className="dm-input dm-input-sm" type="time" value={trig.to} onChange={(e) => setTrig({ ...trig, to: e.target.value })} aria-label="To" />
                  </div>
                  <div className="dm-skip-row">
                    <button
                      className="dm-btn dm-btn-primary dm-btn-sm"
                      disabled={!trig.rule.value.trim()}
                      onClick={() => {
                        const target = adding.key.slice(7);
                        onSpecChange(addTrigger(spec, { sourceSurvey: surveyName, rule: { ...trig.rule, source: item['Question.ID'] }, targetSurvey: target, targetLabel: adding.primary, when: trig.when, from: trig.from, to: trig.to }));
                        setAdding(null);
                      }}
                    >
                      Add
                    </button>
                    <button className="dm-link-btn" onClick={() => setAdding(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                (() => {
                  const target = qs.find((q) => q['Item.ID'] === adding.hit!.itemId)!;
                  const r = firstRule(item, itemId);
                  return (
                    <div className="dm-skip-row">
                      <span>
                        Show <strong>{itemName(target)}</strong> only when this answer matches (you can change the condition after adding).
                      </span>
                      <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={() => (setSurvey(setSkipRule(survey, target['Item.ID'], r)), setAdding(null))}>
                        Add
                      </button>
                      <button className="dm-link-btn" onClick={() => setAdding(null)}>
                        Cancel
                      </button>
                    </div>
                  );
                })()
              )}
            </div>
          ) : (
            <div className="dm-skip-row">
              <span>+ Leads to</span>
              <SearchPicker
                options={targetOptions}
                placeholder="a later question, a block, or another survey"
                onPick={(o) => {
                  setTrig({ rule: { source: item['Question.ID'], op: isChoice(item) ? '=' : '>=', value: isChoice(item) ? String(item.responseKey?.[0]?.value ?? '') : '' }, when: 'next', from: '10:00', to: '10:30' });
                  setAdding(o);
                }}
              />
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}

/** "Sent when…": the answers in other surveys that trigger `surveyName`, and a way to add one. */
export function IncomingTriggers({ spec, surveyName, onSpecChange }: { spec: StudySpec; surveyName: string; onSpecChange(s: StudySpec): void }) {
  const target = spec.surveys.find((s) => s['Survey.Name'] === surveyName)!;
  const incoming = spec.schedules.flatMap((s) => s.events).filter((e) => (e.extensions as Record<string, unknown>)?.['Survey.Name'] === surveyName && triggerOf(e));
  const sources = [...new Set(incoming.map((e) => triggerOf(e)!.source))];
  const all = useMemo(() => allQuestions(spec), [spec]);
  const options = useMemo(() => all.filter((h) => h.surveyName !== surveyName && !h.block && h.type !== 'Informational Fullscreen').map((h) => questionOption(h, true)), [all, surveyName]);
  const [adding, setAdding] = useState<{ hit: PickOption; rule: TriggerRule; when: 'same' | 'next'; from: string; to: string } | null>(null);
  const questionBy = (qid: string) => {
    for (const s of spec.surveys) {
      const q = s.questions?.find((x) => x['Question.ID'] === qid);
      if (q) return { q, s };
    }
    return null;
  };
  return (
    <fieldset className="dm-skip">
      <legend>Sent when an answer in another survey…</legend>
      {sources.map((src) => {
        const found = questionBy(src);
        const r = triggerOf(incoming.find((e) => triggerOf(e)!.source === src)!)!;
        return (
          <div key={src} className="dm-trigger">
            <div className="dm-skip-row">
              <span>
                <code>{src}</code> {found ? `in ${surveyLabel(found.s)}` : ''}
              </span>
              <button className="dm-link-btn dm-push-right" onClick={() => onSpecChange(removeTrigger(spec, src, surveyName))}>
                Remove
              </button>
            </div>
            {found && <TriggerCondition source={found.q} rule={r} onChange={(nr) => onSpecChange(setTriggerRule(spec, src, surveyName, nr))} />}
          </div>
        );
      })}
      {adding ? (
        <div className="dm-trigger is-new">
          <div className="dm-skip-row">
            <span>
              When <code>{adding.hit.primary}</code> ({adding.hit.where})
            </span>
          </div>
          {(() => {
            const found = questionBy(adding.hit.primary);
            return found ? <TriggerCondition source={found.q} rule={adding.rule} onChange={(r) => setAdding({ ...adding, rule: r })} /> : null;
          })()}
          <div className="dm-skip-row">
            <span>send it</span>
            <select className="dm-input dm-input-sm" value={adding.when} onChange={(e) => setAdding({ ...adding, when: e.target.value as 'same' | 'next' })}>
              <option value="same">the same day</option>
              <option value="next">the next day</option>
            </select>
            <span>between</span>
            <input className="dm-input dm-input-sm" type="time" value={adding.from} onChange={(e) => setAdding({ ...adding, from: e.target.value })} aria-label="From" />
            <span>and</span>
            <input className="dm-input dm-input-sm" type="time" value={adding.to} onChange={(e) => setAdding({ ...adding, to: e.target.value })} aria-label="To" />
          </div>
          <div className="dm-skip-row">
            <button
              className="dm-btn dm-btn-primary dm-btn-sm"
              disabled={!adding.rule.value.trim()}
              onClick={() => {
                onSpecChange(addTrigger(spec, { sourceSurvey: adding.hit.hit!.surveyName, rule: adding.rule, targetSurvey: surveyName, targetLabel: surveyLabel(target), when: adding.when, from: adding.from, to: adding.to }));
                setAdding(null);
              }}
            >
              Add
            </button>
            <button className="dm-link-btn" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="dm-skip-row">
          <span>+ Triggered by</span>
          <SearchPicker
            options={options}
            placeholder="a question in another survey"
            onPick={(o) => {
              const found = questionBy(o.primary);
              const choice = isChoice(found?.q);
              setAdding({ hit: o, rule: { source: o.primary, op: choice ? '=' : '>=', value: choice ? String(found?.q.responseKey?.[0]?.value ?? '') : '' }, when: 'next', from: '10:00', to: '10:30' });
            }}
          />
        </div>
      )}
    </fieldset>
  );
}
