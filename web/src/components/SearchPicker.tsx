// A search box that lists the best-matching questions (or surveys) as you type: "mo_" finds the
// morning questions, "craving" finds them by wording, "multiple select" by type.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { scoreHit, type QuestionHit } from '../editor/search';

export interface PickOption {
  key: string;
  /** Bold part: the Question ID, or a survey's name. */
  primary: string;
  /** The wording, or what the option does. */
  secondary: string;
  /** Small tag: question type, "Block", "Survey". */
  tag: string;
  /** Where it is (a survey's name), shown faintly. */
  where?: string;
  /** For questions: what the search matches against. */
  hit?: QuestionHit;
}

const score = (o: PickOption, q: string) => {
  if (o.hit) return scoreHit(o.hit, q);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${o.primary} ${o.secondary} ${o.tag}`.toLowerCase();
  return words.every((w) => hay.includes(w)) ? 50 : 0;
};

export function questionOption(h: QuestionHit, showWhere = false): PickOption {
  return { key: `${h.surveyName}/${h.itemId}`, primary: h.block ? h.text : h.questionId, secondary: h.block ? '' : h.text, tag: h.type, where: showWhere ? h.surveyLabel : undefined, hit: h };
}

export function SearchPicker({
  options,
  onPick,
  placeholder = 'Search questions by ID, wording or type…',
  current,
  autoFocus,
  limit = 10,
}: {
  options: PickOption[];
  onPick(o: PickOption): void;
  placeholder?: string;
  /** What's chosen now, shown while the box isn't being typed in. */
  current?: string;
  autoFocus?: boolean;
  limit?: number;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return options.slice(0, limit);
    return options
      .map((o, i) => ({ o, i, s: score(o, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, limit)
      .map((x) => x.o);
  }, [options, query, limit]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (o: PickOption | undefined) => {
    if (!o) return;
    onPick(o);
    setQuery('');
    setOpen(false);
  };
  return (
    <div className="dm-picker" ref={box}>
      <input
        className="dm-input dm-input-sm"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={open ? query : (current ?? '')}
        placeholder={current ? current : placeholder}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={(e) => (setQuery(e.target.value), setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setOpen(true), setActive((a) => Math.min(results.length - 1, a + 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          else if (e.key === 'Enter') (e.preventDefault(), pick(results[active]));
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="dm-picker-list" id={listId} role="listbox">
          {results.length ? (
            results.map((o, i) => (
              <li
                key={o.key}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => (e.preventDefault(), pick(o))}
              >
                <span className="dm-picker-main">
                  <code>{o.primary}</code>
                  <span className="dm-picker-tag">{o.tag}</span>
                  {o.where && <span className="dm-picker-where">{o.where}</span>}
                </span>
                {o.secondary && <span className="dm-picker-text">{o.secondary}</span>}
              </li>
            ))
          ) : (
            <li className="dm-picker-none">No matches.</li>
          )}
        </ul>
      )}
    </div>
  );
}
