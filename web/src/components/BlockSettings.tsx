// A block's behaviour beyond "asked once, here": repeating (a set number of times, once per option
// chosen in an earlier multi-select, or until an answer says stop) and floating (if its survey is
// missed, it's asked in the next survey the participant takes that day).
import { isBlock, isEndBlock, type Question, type StudySpec, type Survey } from '../core';
import { descendants, possibleParents } from '../editor/edit';


type Repeat = NonNullable<Question['Block.Repeat']>;
type Float = NonNullable<Question['Block.Float']>;

const surveyLabel = (s: Survey) => s['Survey.LongName'] || s['Survey.Name'];

export function BlockSettings({ spec, survey, block, set }: { spec: StudySpec; survey: Survey; block: Question; set(patch: Partial<Question>): void }) {
  const repeat = block['Block.Repeat'];
  const float = block['Block.Float'];
  const qs = survey.questions ?? [];
  const multiSelects = possibleParents(survey, block['Item.ID']).filter((q) => q['Question.Type.Display.Name'] === 'Multiple Select');
  // A stop question: usually one inside the block ("Anything else to add?").
  const inside = descendants(survey, block['Item.ID']);
  const stopCandidates = qs.filter((q) => !isBlock(q) && !isEndBlock(q) && (inside.has(q['Item.ID']) || possibleParents(survey, block['Item.ID']).includes(q)));
  const stopQ = repeat?.['Stop.Item.ID'] ? qs.find((q) => q['Item.ID'] === repeat['Stop.Item.ID']) : undefined;
  const setRepeat = (r: Repeat | undefined) => set({ 'Block.Repeat': r });
  const setFloat = (f: { Surveys: string[]; 'Once.Per'?: Float['Once.Per'] } | undefined) => set({ 'Block.Float': f as Float | undefined });
  const others = spec.surveys.filter((s) => s['Survey.Name'] !== survey['Survey.Name'] && !float?.Surveys.includes(s['Survey.Name']));

  return (
    <>
      <fieldset className="dm-skip">
        <legend>Repeat this block</legend>
        <div className="dm-skip-row">
          <select
            className="dm-input dm-input-sm"
            value={repeat?.Type ?? ''}
            onChange={(e) => {
              const t = e.target.value as Repeat['Type'] | '';
              if (!t) return setRepeat(undefined);
              if (t === 'Fixed') setRepeat({ Type: 'Fixed', Count: repeat?.Count ?? 2 });
              if (t === 'Per.Answer') setRepeat({ Type: 'Per.Answer', 'Source.Item.ID': multiSelects[0]?.['Item.ID'] ?? '' });
              if (t === 'Until') setRepeat({ Type: 'Until', 'Stop.Item.ID': stopCandidates[0]?.['Item.ID'] ?? '', 'Stop.Value': String(stopCandidates[0]?.responseKey?.[0]?.value ?? ''), Count: 5 });
            }}
            aria-label="Repeat"
          >
            <option value="">No, ask it once</option>
            <option value="Fixed">A set number of times</option>
            <option value="Per.Answer" disabled={!multiSelects.length}>
              Once for each option chosen in…{multiSelects.length ? '' : ' (needs an earlier multiple-select question)'}
            </option>
            <option value="Until">Until an answer says stop</option>
          </select>
          {repeat?.Type === 'Fixed' && (
            <>
              <input className="dm-input dm-input-sm dm-input-num" type="number" min={1} value={repeat.Count ?? 2} onChange={(e) => setRepeat({ ...repeat, Count: Math.max(1, Number(e.target.value) || 1) })} aria-label="Times" />
              <span>times</span>
            </>
          )}
          {repeat?.Type === 'Per.Answer' && (
            <select className="dm-input dm-input-sm" value={repeat['Source.Item.ID'] ?? ''} onChange={(e) => setRepeat({ ...repeat, 'Source.Item.ID': e.target.value })} aria-label="Question">
              {multiSelects.map((q) => (
                <option key={q['Item.ID']} value={q['Item.ID']}>
                  {q['Question.ID']}: {(q['Question.Text'] ?? '').slice(0, 50)}
                </option>
              ))}
            </select>
          )}
        </div>
        {repeat?.Type === 'Until' && (
          <div className="dm-skip-row">
            <span>until</span>
            <select className="dm-input dm-input-sm" value={repeat['Stop.Item.ID'] ?? ''} onChange={(e) => setRepeat({ ...repeat, 'Stop.Item.ID': e.target.value })} aria-label="Stop question">
              {stopCandidates.map((q) => (
                <option key={q['Item.ID']} value={q['Item.ID']}>
                  {q['Question.ID']}
                </option>
              ))}
            </select>
            <span>is</span>
            {stopQ?.responseKey?.length ? (
              <select className="dm-input dm-input-sm" value={repeat['Stop.Value'] ?? ''} onChange={(e) => setRepeat({ ...repeat, 'Stop.Value': e.target.value })} aria-label="Stop answer">
                {stopQ.responseKey.map((k) => (
                  <option key={String(k.value)} value={String(k.value)}>
                    {k.definition}
                  </option>
                ))}
              </select>
            ) : (
              <input className="dm-input dm-input-sm" value={repeat['Stop.Value'] ?? ''} onChange={(e) => setRepeat({ ...repeat, 'Stop.Value': e.target.value })} aria-label="Stop answer" />
            )}
            <span>at most</span>
            <input className="dm-input dm-input-sm dm-input-num" type="number" min={1} value={repeat.Count ?? ''} onChange={(e) => setRepeat({ ...repeat, Count: Math.max(1, Number(e.target.value) || 1) })} aria-label="At most" />
            <span>times</span>
          </div>
        )}
        {repeat && <p className="dm-hint">Each answer in the data records which repetition it was (the Iteration column{repeat.Type === 'Per.Answer' ? ', and Iteration.Key for the option it was about' : ''}).</p>}
      </fieldset>

      <fieldset className="dm-skip">
        <legend>Floating</legend>
        <label className="dm-check">
          <input
            type="checkbox"
            checked={!!float}
            disabled={!float && spec.surveys.length < 2}
            onChange={(e) => {
              const next = spec.surveys.find((s) => s['Survey.Name'] !== survey['Survey.Name']);
              setFloat(e.target.checked && next ? { Surveys: [survey['Survey.Name'], next['Survey.Name']], 'Once.Per': 'Day' } : undefined);
            }}
          />{' '}
          If {surveyLabel(survey)} is missed, ask this block in the next survey the participant takes
        </label>
        {float && (
          <>
            <ol className="dm-float-list">
              {float.Surveys.map((n, i) => {
                const s = spec.surveys.find((x) => x['Survey.Name'] === n);
                return (
                  <li key={n}>
                    <span>{s ? surveyLabel(s) : n}</span>
                    {i === 0 ? (
                      <span className="dm-hint">(where it’s defined)</span>
                    ) : (
                      <span className="dm-inline dm-inline-tight dm-push-right">
                        <button className="dm-icon-btn" disabled={i === 1} aria-label="Earlier" title="Earlier" onClick={() => setFloat({ ...float, Surveys: [...float.Surveys.slice(0, i - 1), n, float.Surveys[i - 1]!, ...float.Surveys.slice(i + 1)] })}>
                          ↑
                        </button>
                        <button className="dm-icon-btn" disabled={i === float.Surveys.length - 1} aria-label="Later" title="Later" onClick={() => setFloat({ ...float, Surveys: [...float.Surveys.slice(0, i), float.Surveys[i + 1]!, n, ...float.Surveys.slice(i + 2)] })}>
                          ↓
                        </button>
                        <button className="dm-icon-btn" aria-label="Remove" title="Remove" onClick={() => setFloat(float.Surveys.length > 2 ? { ...float, Surveys: float.Surveys.filter((x) => x !== n) } : undefined)}>
                          ×
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="dm-skip-row">
              {others.length > 0 && (
                <select className="dm-input dm-input-sm" value="" onChange={(e) => e.target.value && setFloat({ ...float, Surveys: [...float.Surveys, e.target.value] })} aria-label="Add a survey">
                  <option value="">+ then in…</option>
                  {others.map((s) => (
                    <option key={s['Survey.Name']} value={s['Survey.Name']}>
                      {surveyLabel(s)}
                    </option>
                  ))}
                </select>
              )}
              <span>asked once per</span>
              <select className="dm-input dm-input-sm" value={float['Once.Per'] ?? 'Day'} onChange={(e) => setFloat({ ...float, 'Once.Per': e.target.value as Float['Once.Per'] })} aria-label="Once per">
                <option value="Day">day</option>
                <option value="Burst">burst</option>
                <option value="Study">study</option>
              </select>
            </div>
            <p className="dm-hint">It moves down this list until the participant takes one of these surveys. The data’s Survey.Name column records where it was answered.</p>
          </>
        )}
      </fieldset>
    </>
  );
}
