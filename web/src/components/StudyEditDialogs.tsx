// Editing the study from outside the Survey Editor (the codebook, the flowchart, the schedule): a
// question editor (inline or in a dialog), a delete dialog and a confirm dialog. Changes go back
// through the app's undoable edit.
import { useEffect, useState, type ReactNode } from 'react';
import type { StudySpec } from '../core';
import { deleteItems, questionIdsOf, responseCount } from '../editor/data';
import { useLiveDraft, type CommitEdit } from './useLiveDraft';
import { ItemForm } from './pages/SurveyEditor';

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dm-modal-backdrop is-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dm-modal ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dm-modal-head">
          <h3>{title}</h3>
          <button className="dm-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dm-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, children, confirm, danger, onConfirm, onClose }: { title: string; children: ReactNode; confirm: string; danger?: boolean; onConfirm(): void; onClose(): void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div>{children}</div>
      <div className="dm-modal-foot">
        <button className="dm-btn dm-btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className={`dm-btn ${danger ? 'dm-btn-danger' : 'dm-btn-primary'}`} onClick={onConfirm} autoFocus>
          {confirm}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Deleting questions. From the study: optionally with their responses. From the codebook: either
 * leave them out of this codebook only, or delete them from the study and the data.
 */
export function DeleteDialog({
  spec,
  surveyName,
  itemIds,
  codebook,
  onDelete,
  onLeaveOut,
  onClose,
}: {
  spec: StudySpec;
  surveyName: string;
  itemIds: string[];
  /** Offer "leave out of this codebook" as well. */
  codebook?: boolean;
  onDelete(next: StudySpec, label: string): void;
  onLeaveOut?(): void;
  onClose(): void;
}) {
  const survey = spec.surveys.find((s) => s['Survey.Name'] === surveyName);
  const names = itemIds.map((id) => survey?.questions?.find((q) => q['Item.ID'] === id)?.['Question.ID'] ?? id);
  const qids = questionIdsOf(spec, surveyName, itemIds);
  const rows = responseCount(spec, qids);
  const [alsoData, setAlsoData] = useState(false);
  const label = `Deleted ${names.length === 1 ? names[0] : `${names.length} items`}`;
  const what = names.length === 1 ? <strong>{names[0]}</strong> : <strong>{names.length} items</strong>;
  return (
    <Modal title={names.length === 1 ? `Delete ${names[0]}?` : `Delete ${names.length} items?`} onClose={onClose}>
      {codebook ? (
        <>
          <p>How should {what} go?</p>
          <div className="dm-delete-choices">
            <button className="dm-delete-choice" onClick={() => (onLeaveOut?.(), onClose())}>
              <strong>Leave out of this codebook</strong>
              <span>The study and data keep it; the codebook just doesn’t show it. Bring it back on the Variables tab.</span>
            </button>
            <button className="dm-delete-choice is-danger" onClick={() => onDelete(deleteItems(spec, surveyName, itemIds, true), `${label} and its responses`)}>
              <strong>Delete from the study and the data</strong>
              <span>
                Removes the question{qids.length === 1 ? '' : 's'}, any skip logic pointing to {qids.length === 1 ? 'it' : 'them'}
                {rows ? `, and ${rows.toLocaleString()} response${rows === 1 ? '' : 's'} in the data` : ''}. You can undo this (Ctrl+Z).
              </span>
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {what}
            {qids.length > names.length ? ` (${qids.length} questions in all)` : ''} and any skip logic pointing to {names.length === 1 ? 'it' : 'them'} will be removed from the study. You can undo this (Ctrl+Z).
          </p>
          {rows > 0 && (
            <label className="dm-check">
              <input type="checkbox" checked={alsoData} onChange={(e) => setAlsoData(e.target.checked)} /> Also delete {rows.toLocaleString()} response{rows === 1 ? '' : 's'} from the data
            </label>
          )}
          <div className="dm-modal-foot">
            <button className="dm-btn dm-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="dm-btn dm-btn-danger" onClick={() => onDelete(deleteItems(spec, surveyName, itemIds, alsoData), alsoData ? `${label} and its responses` : label)} autoFocus>
              Delete
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Edit one question or block (wording, type, options, logic). Changes save as you make them. */
export function QuestionEditor({ spec, surveyName, itemId, onCommit, onDelete }: { spec: StudySpec; surveyName: string; itemId: string; onCommit: CommitEdit; onDelete(): void }) {
  const { draft, change, problem } = useLiveDraft(spec, onCommit);
  const survey = draft?.surveys.find((s) => s['Survey.Name'] === surveyName);
  const q = survey?.questions?.find((x) => x['Item.ID'] === itemId);
  if (!draft || !survey || !q) return <p className="dm-empty">This item is no longer in the study.</p>;
  return (
    <div className="dm-q-editor">
      <ItemForm spec={draft} surveyName={surveyName} itemId={itemId} onSpecChange={(next, label) => change(next, label, `item:${surveyName}/${itemId}`)} onDelete={onDelete} />
      <p className={`dm-hint ${problem ? 'dm-dirty' : ''}`}>{problem ? `Not saved yet: ${problem}` : 'Changes save as you go · Ctrl+Z undoes'}</p>
    </div>
  );
}

export function QuestionDialog({ spec, surveyName, itemId, onCommit, onClose, onDelete }: { spec: StudySpec; surveyName: string; itemId: string; onCommit: CommitEdit; onClose(): void; onDelete(): void }) {
  const q = spec.surveys.find((s) => s['Survey.Name'] === surveyName)?.questions?.find((x) => x['Item.ID'] === itemId);
  return (
    <Modal title={`Edit ${q?.['Question.ID'] ?? ''}`} onClose={onClose} wide>
      <QuestionEditor spec={spec} surveyName={surveyName} itemId={itemId} onCommit={onCommit} onDelete={onDelete} />
      <div className="dm-modal-foot">
        <button className="dm-btn dm-btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
