// Edits save as you make them. The form shows a local copy of the study right away; the change is
// handed to the app (validated, added to the undo history, shown in every view) a moment after you
// stop typing, or at once for actions like adding or deleting. Typing in one field counts as one
// undo step. If the study isn't valid mid-edit (say, an empty variable name), the change waits
// until it is, and `problem` says why.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudySpec } from '../core';

export interface LiveEditOptions {
  /** Edits with the same key in a row are one undo step. */
  merge?: string;
  /** Don't show a message (typing). */
  quiet?: boolean;
}

/** Hand an edit to the app. Returns null when it was applied, or why it wasn't. */
export type CommitEdit = (spec: StudySpec, label: string, opts: LiveEditOptions) => string | null;

const DELAY = 350;

export function useLiveDraft(spec: StudySpec | null, commit: CommitEdit | undefined) {
  const [draft, setDraft] = useState(spec);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef<{ spec: StudySpec; label: string; opts: LiveEditOptions } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (!p || !commitRef.current) return;
    setProblem(commitRef.current(p.spec, p.label, p.opts));
  }, []);

  // The study changed outside this form (undo, another page, our own commit): show it, unless
  // there's typing still waiting to be saved.
  useEffect(() => {
    if (!pending.current) setDraft(spec);
  }, [spec]);

  // Save whatever is waiting when the form goes away.
  useEffect(() => flush, [flush]);

  /**
   * Change the study. With a `label` it's a distinct action (saved now, its own undo step, with a
   * message); without one it's typing (saved shortly, merged by `mergeKey`, quiet).
   */
  const change = useCallback(
    (next: StudySpec, label?: string, mergeKey = 'typing') => {
      setDraft(next);
      if (label) {
        // Save earlier typing as its own step first.
        flush();
        pending.current = { spec: next, label, opts: {} };
        flush();
        return;
      }
      pending.current = { spec: next, label: 'Edited the study', opts: { merge: mergeKey, quiet: true } };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DELAY);
    },
    [flush],
  );

  return { draft, change, problem, flush };
}
