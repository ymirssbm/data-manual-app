import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { blockPath, buildSurveyModel, flowKnown, isQuestion, itemLabel, responseOptions, shownWhen, stripHtml, triggers, type StudySpec, type Survey } from '../../core';
import { dataOverview, describeItem, flowchartBlocks, flowchartQuestionNodes, flowchartText, generateFlowchart, hasResponseData, indexResponses } from '../../generators';
import type { PageId } from '../App';
import { Icon, PageTitle } from '../ui';
import { download, renderMermaid, safeFileName, svgToPng } from '../util';
import { NoStudy } from './common';
import { DeleteDialog, QuestionEditor } from '../StudyEditDialogs';
import { groupIntoBlock } from '../../editor/edit';
import { clickSelect } from './SurveyEditor';
import { withSurveyReplaced } from '../../exporters';
import { deleteItems } from '../../editor/data';
import type { LiveEditOptions } from '../useLiveDraft';
import { dropItem, linkItems, linkSurvey, type DropItem, type DropTarget } from '../../editor/link';
import { allQuestions } from '../../editor/search';
import { questionOption, SearchPicker } from '../SearchPicker';

interface Props {
  spec: StudySpec | null;
  go(id: PageId): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
  /** Save a changed study (undoable). Returns why it wasn't saved, if it wasn't. */
  onChange(spec: StudySpec, label?: string, opts?: LiveEditOptions): string | null;
  /** Show one question in the Codebook. */
  openInCodebook(surveyName: string, itemId: string): void;
}

type Tool = 'move' | 'select' | 'link';
/** Drag-and-drop payload type for things dragged from the palette onto the chart. */
const DND_TYPE = 'application/x-dm-item';

interface View {
  x: number;
  y: number;
  k: number;
}

export function FlowchartPage({ spec, go, notify, onChange, openInCodebook }: Props) {
  const surveys = spec?.surveys ?? [];
  const [surveyName, setSurveyName] = useState(surveys[0]?.['Survey.Name'] ?? '');
  const [showIds, setShowIds] = useState(false);
  const [direction, setDirection] = useState<'TD' | 'LR'>('TD');
  /** Folded blocks, per survey. */
  const [folded, setFolded] = useState<Record<string, string[]>>({});
  /** The rendered drawing together with the survey/layout it belongs to (it arrives asynchronously). */
  const [drawn, setDrawn] = useState<{ svg: string; key: string } | null>(null);
  const svg = drawn?.svg ?? null;
  const [showCode, setShowCode] = useState(false);
  const [showText, setShowText] = useState(false);
  const survey = surveys.find((s) => s['Survey.Name'] === surveyName) ?? surveys[0];
  const blocks = useMemo(() => (survey ? flowchartBlocks(survey) : []), [survey]);
  const questionNodes = useMemo(() => (survey ? flowchartQuestionNodes(survey) : []), [survey]);
  /** The question whose details are open, per survey. */
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const selected = survey ? (picked[survey['Survey.Name']] ?? null) : null;
  const select = useCallback((itemId: string | null) => survey && setPicked((p) => ({ ...p, [survey['Survey.Name']]: itemId })), [survey]);
  // Edit mode: clicking selects (Ctrl/Shift for several, or drag a box with the Select tool); the side
  // panel becomes the edit form; several selected can go in a block or be deleted.
  const [editMode, setEditMode] = useState(false);
  const [tool, setTool] = useState<Tool>('move');
  /** A question picked in the palette's search, ready to drag onto the chart. */
  const [copyPick, setCopyPick] = useState<{ surveyName: string; itemId: string; label: string } | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [blockName, setBlockName] = useState('');
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [panelW, setPanelW] = useState(() => {
    try {
      return Number(localStorage.getItem('dm.flowchart.panel')) || 360;
    } catch {
      return 360;
    }
  });
  const nodeOrder = useMemo(() => questionNodes.map((q) => q.itemId), [questionNodes]);
  const onQuestion = useCallback(
    (itemId: string | null, mods?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
      if (!editMode) return select(itemId);
      if (!itemId) return setMulti([]);
      const next = clickSelect(nodeOrder, multi, anchor, itemId, mods ?? { ctrlKey: false, metaKey: false, shiftKey: false });
      setMulti(next);
      if (!mods?.shiftKey) setAnchor(itemId);
      select(next.length === 1 ? next[0]! : null);
    },
    [editMode, select, nodeOrder, multi, anchor],
  );
  const onArea = useCallback(
    (ids: string[], additive: boolean) => {
      const next = additive ? [...new Set([...multi, ...ids])] : ids;
      setMulti(next);
      select(next.length === 1 ? next[0]! : null);
    },
    [multi, select],
  );
  const deleteSelection = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], .dm-modal')) return;
      e.preventDefault();
      deleteSelection.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const collapsed = survey ? (folded[survey['Survey.Name']] ?? []) : [];
  const known = survey ? flowKnown(survey) : true;
  const code = useMemo(() => (survey && known ? generateFlowchart(survey, { showIds, direction, collapsed }) : ''), [survey, known, showIds, direction, collapsed.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitKey = survey ? `${survey['Survey.Name']}|${direction}|${showIds}` : '';
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const key = fitKey;
    renderMermaid(code)
      .then((s) => !cancelled && setDrawn({ svg: s, key }))
      .catch((e: Error) => !cancelled && notify(`Error generating flowchart: ${e.message}`, 'error', 10000));
    return () => {
      cancelled = true;
    };
  }, [code, notify]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCollapsed = useCallback(
    (ids: string[]) => survey && setFolded((f) => ({ ...f, [survey['Survey.Name']]: ids })),
    [survey],
  );
  const toggleBlock = useCallback(
    (itemId: string) => setCollapsed(collapsed.includes(itemId) ? collapsed.filter((x) => x !== itemId) : [...collapsed, itemId]),
    [collapsed, setCollapsed],
  );
  // In edit mode a click on a block selects it (to rename it or set its logic) instead of folding it.
  const onBlock = useCallback(
    (itemId: string) => {
      if (!editMode) return toggleBlock(itemId);
      setMulti([itemId]);
      select(itemId);
    },
    [editMode, toggleBlock, select],
  );

  if (!spec || !survey) return (<><PageTitle>Flowchart Visualization</PageTitle><NoStudy go={go} what="a flowchart" /></>);
  const base = safeFileName(`${survey['Survey.Name']}_flowchart`);
  const otherQuestions = allQuestions(spec)
    .filter((h) => h.surveyName !== survey['Survey.Name'] && !h.block)
    .map((h) => questionOption(h, true));
  /** Apply a link or drop, then select what it made so its details show in the side panel. */
  const applyEdit = (r: ReturnType<typeof dropItem>) => {
    if ('error' in r) return void notify(r.error, 'warning', 7000);
    onChange(r.spec, r.label);
    if (r.select) {
      setMulti([r.select]);
      select(r.select);
    }
  };
  const onLink = (fromId: string, to: { kind: 'question' | 'block'; itemId: string } | { kind: 'survey'; surveyName: string }) =>
    applyEdit(to.kind === 'survey' ? linkSurvey(spec, survey['Survey.Name'], fromId, to.surveyName) : linkItems(spec, survey['Survey.Name'], fromId, to.itemId));
  const onDropItem = (item: DropItem, target: DropTarget) => applyEdit(dropItem(spec, survey['Survey.Name'], item, target));
  /** A palette chip: drag it onto the chart, or click it to add after the selected question. */
  const chip = (item: DropItem, text: string, extra: Record<string, string> = {}, title?: string) => (
    <button
      type="button"
      className={`dm-chip dm-palette-chip ${item.kind === 'survey' || item.kind === 'new-survey' ? 'is-survey' : ''}`}
      draggable
      title={title ?? 'Drag onto the chart, or click to add after the selected question'}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, JSON.stringify(item));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onDropItem(item, selected ? { kind: 'question', itemId: selected } : null)}
      {...extra}
    >
      {text}
    </button>
  );
  deleteSelection.current = () => {
    if (!editMode || !multi.length) return;
    const ids = multi;
    const name = ids.length === 1 ? survey.questions?.find((q) => q['Item.ID'] === ids[0])?.['Question.ID'] ?? 'the item' : `${ids.length} items`;
    onChange(deleteItems(spec, survey['Survey.Name'], ids, false), `Deleted ${name}`);
    setMulti([]);
    select(null);
  };

  return (
    <>
      <PageTitle
        actions={
          <>
            <button className="dm-btn dm-btn-secondary" onClick={() => svg && download(`${base}.svg`, svg, 'image/svg+xml')} disabled={!svg || !known}>
              Export SVG
            </button>
            <button
              className="dm-btn dm-btn-primary"
              disabled={!svg || !known}
              onClick={() => svg && void svgToPng(svg, 2).then((b) => download(`${base}.png`, b)).catch((e: Error) => notify(e.message, 'error'))}
            >
              <Icon name="download" /> Export PNG
            </button>
          </>
        }
      >
        Flowchart Visualization
      </PageTitle>
      <div className="dm-flow-layout">
        <nav className="dm-flow-surveys" aria-label="Surveys">
          <p className="dm-flow-surveys-title">Surveys</p>
          {surveys.map((s) => {
            const m = buildSurveyModel(s);
            const active = s === survey;
            return (
              <button key={s['Survey.Name']} className={`dm-flow-survey ${active ? 'is-active' : ''}`} onClick={() => setSurveyName(s['Survey.Name'])} aria-current={active}>
                <strong>{s['Survey.LongName'] || s['Survey.Name']}</strong>
                <span>
                  {m.items.filter(isQuestion).length} questions · {flowKnown(s) ? `${m.branches.length} branches` : 'no flow information'}
                </span>
              </button>
            );
          })}
        </nav>

        {!known ? (
          <section className="dm-flow-main">
            <div className="dm-flow-none">
              <h3>No flowchart for this survey</h3>
              <div>
                <p>
                  <strong>{survey['Survey.LongName'] || survey['Survey.Name']}</strong> was built from a dataset's columns, which don't say what order its questions were asked in or
                  whether any were skipped, so there is no flow to draw. Its {buildSurveyModel(survey).items.filter(isQuestion).length} variables are still in the data dictionary and
                  codebook.
                </p>
                <p className="dm-hint">To get a flowchart, set the question order and skip logic in the Survey Editor, or import the survey design (a Qualtrics .qsf, a REDCap data dictionary or a study spec) and attach this data to it.</p>
                <div className="dm-inline">
                  <button className="dm-btn dm-btn-primary" onClick={() => go('editor')}>
                    <Icon name="edit" /> Open the Survey Editor
                  </button>
                  <button
                    className="dm-btn dm-btn-secondary"
                    onClick={() => {
                      onChange({ ...spec, surveys: spec.surveys.map((x) => (x === survey ? { ...x, 'Survey.Flow.Known': true } : x)) });
                      notify(`Showing "${survey['Survey.LongName'] || survey['Survey.Name']}" in its column order, with no skip logic.`);
                    }}
                  >
                    The columns are in the order asked
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
        <section className="dm-flow-main">
          <div className="dm-flow-toolbar">
            <label className="dm-check">
              <input type="checkbox" checked={showIds} onChange={(e) => setShowIds(e.target.checked)} /> Question IDs
            </label>
            <select className="dm-input dm-select-sm" value={direction} onChange={(e) => setDirection(e.target.value as 'TD' | 'LR')} aria-label="Direction">
              <option value="TD">Top to bottom</option>
              <option value="LR">Left to right</option>
            </select>
            {blocks.length > 0 && (
              <span className="dm-inline dm-inline-tight">
                <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setCollapsed(blocks.map((b) => b.itemId))} disabled={collapsed.length === blocks.length}>
                  Collapse all blocks
                </button>
                <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setCollapsed([])} disabled={!collapsed.length}>
                  Expand all
                </button>
              </span>
            )}
            <span className="dm-hint dm-push-right">
              {editMode
                ? 'Click a question to edit it · drag things in from the bar · ↘ Link draws logic · Delete removes the selection'
                : `Click a question for details · ${blocks.length ? 'click a block to fold or unfold it · ' : ''}scroll or drag to move · Ctrl + scroll to zoom`}
            </span>
            <button
              className={`dm-btn dm-btn-sm dm-edit-toggle ${editMode ? 'is-on' : ''}`}
              aria-pressed={editMode}
              onClick={() => {
                setEditMode((m) => !m);
                setMulti(selected ? [selected] : []);
                setTool('move');
              }}
            >
              {editMode ? '✎ Editing: done' : '✎ Edit'}
            </button>
          </div>
          {editMode && multi.length > 1 && (
            <div className="dm-editor-blockbar">
              <span>{multi.length} selected</span>
              <input className="dm-input dm-input-sm" value={blockName} placeholder="Block name" onChange={(e) => setBlockName(e.target.value)} />
              <button
                className="dm-btn dm-btn-primary dm-btn-sm"
                onClick={() => {
                  const si = spec.surveys.indexOf(survey);
                  const r = groupIntoBlock(survey, multi, blockName || 'New block');
                  if (!r.blockId) return;
                  onChange(withSurveyReplaced(spec, si, r.survey), `Made the block “${blockName || 'New block'}”`);
                  setMulti([r.blockId]);
                  select(r.blockId);
                  setBlockName('');
                }}
              >
                + Block
              </button>
              <button className="dm-btn dm-btn-danger dm-btn-sm" onClick={() => setDeleting(multi)}>
                Delete
              </button>
              <button className="dm-link-btn" onClick={() => (setMulti([]), select(null))}>
                Clear
              </button>
            </div>
          )}
          {editMode && (
            <div className="dm-flow-palette" aria-label="Drag onto the chart">
              <span className="dm-palette-label">Drag in:</span>
              {chip({ kind: 'question' }, '＋ Question')}
              {chip({ kind: 'block' }, '＋ Block')}
              {chip({ kind: 'new-survey' }, '＋ New survey', {}, 'Drop on a question to have its answer send a new survey, or anywhere to add a survey')}
              <span className="dm-palette-label">Surveys:</span>
              {surveys
                .filter((s) => s !== survey)
                .map((s) => (
                  <span key={s['Survey.Name']}>
                    {chip({ kind: 'survey', surveyName: s['Survey.Name'] }, s['Survey.LongName'] || s['Survey.Name'], { 'data-dm-survey': s['Survey.Name'] }, 'Drop on a question (or draw a line here with ↘ Link) to have its answer send this survey')}
                  </span>
                ))}
              <span className="dm-palette-copy">
                <SearchPicker
                  options={otherQuestions}
                  placeholder="Copy a question from another survey…"
                  onPick={(o) => setCopyPick({ surveyName: o.hit!.surveyName, itemId: o.hit!.itemId, label: o.hit!.questionId })}
                />
                {copyPick && chip({ kind: 'copy', surveyName: copyPick.surveyName, itemId: copyPick.itemId }, `⠿ ${copyPick.label}`)}
              </span>
            </div>
          )}
          <div className={`dm-flow-canvas-row ${selected ? 'has-panel' : ''}`}>
            {drawn ? (
              <Canvas
                svg={drawn.svg}
                fitKey={drawn.key}
                blocks={blocks}
                onToggleBlock={onBlock}
                questions={questionNodes}
                selected={editMode ? null : selected}
                onQuestion={onQuestion}
                ticked={editMode ? multi : []}
                tool={editMode ? tool : 'move'}
                onArea={onArea}
                onLink={editMode ? onLink : undefined}
                onDropItem={editMode ? onDropItem : undefined}
                corner={
                  editMode && (
                    <div className="dm-segmented dm-flow-tools" role="radiogroup" aria-label="Tool">
                      <button role="radio" aria-checked={tool === 'move'} className={tool === 'move' ? 'is-active' : ''} onClick={() => setTool('move')} title="Drag to move around the chart">
                        ✥ Move
                      </button>
                      <button role="radio" aria-checked={tool === 'select'} className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')} title="Drag a box around questions to select them (Shift or Ctrl adds to the selection)">
                        ⬚ Select area
                      </button>
                      <button role="radio" aria-checked={tool === 'link'} className={tool === 'link' ? 'is-active' : ''} onClick={() => setTool('link')} title="Draw a line from a question to a later question, a block, or a survey in the bar above">
                        ↘ Link
                      </button>
                    </div>
                  )
                }
              />
            ) : (
              <p className="dm-empty">Drawing…</p>
            )}
            {selected && (
              <div className="dm-flow-panel" style={{ width: panelW }}>
                <div
                  className="dm-flow-panel-grip"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize the side panel"
                  title="Drag to resize"
                  onPointerDown={(e) => {
                    const startX = e.clientX;
                    const startW = panelW;
                    const move = (ev: PointerEvent) => setPanelW(Math.max(260, Math.min(820, startW + (startX - ev.clientX))));
                    const up = (ev: PointerEvent) => {
                      window.removeEventListener('pointermove', move);
                      window.removeEventListener('pointerup', up);
                      try {
                        localStorage.setItem('dm.flowchart.panel', String(Math.max(260, Math.min(820, startW + (startX - ev.clientX)))));
                      } catch {
                        /* per-viewer convenience only */
                      }
                    };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                  }}
                />
                {editMode ? (
                  <aside className="dm-q-panel is-edit" aria-label="Edit question">
                    <div className="dm-q-panel-head">
                      <strong>Edit</strong>
                      <button className="dm-icon-btn" onClick={() => (select(null), setMulti([]))} aria-label="Close" title="Close">
                        ×
                      </button>
                    </div>
                    <QuestionEditor
                      spec={spec}
                      surveyName={survey['Survey.Name']}
                      itemId={selected}
                      onCommit={(next, label, opts) => onChange(next, label, opts)}
                      onDelete={() => setDeleting([selected])}
                    />
                  </aside>
                ) : (
                  <QuestionPanel
                    spec={spec}
                    survey={survey}
                    itemId={selected}
                    onClose={() => select(null)}
                    openInCodebook={() => openInCodebook(survey['Survey.Name'], selected)}
                    onEdit={() => (setEditMode(true), setMulti([selected]))}
                  />
                )}
              </div>
            )}
          </div>
          {deleting && (
            <DeleteDialog
              spec={spec}
              surveyName={survey['Survey.Name']}
              itemIds={deleting}
              onClose={() => setDeleting(null)}
              onDelete={(next, label) => {
                onChange(next, label);
                setDeleting(null);
                setMulti([]);
                select(null);
              }}
            />
          )}
          <div className="dm-inline dm-mt">
            <label className="dm-check">
              <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> Show text outline
            </label>
            <label className="dm-check">
              <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} /> Show Mermaid code
            </label>
          </div>
          {showText && <TextOutline text={flowchartText(survey)} fileName={`${base}.txt`} notify={notify} />}
          {showCode && <pre className="dm-code">{code}</pre>}
        </section>
        )}
      </div>
    </>
  );
}

/** Pan/zoom canvas with a clickable minimap; clicks on block clusters fold them. */
/** `fitKey` changes when a different survey/layout is shown (refit); folding keeps the current view. */
function Canvas({
  svg,
  fitKey,
  blocks,
  onToggleBlock,
  questions,
  selected,
  onQuestion,
  ticked,
  tool = 'move',
  onArea,
  corner,
  onLink,
  onDropItem,
}: {
  svg: string;
  fitKey: string;
  blocks: ReturnType<typeof flowchartBlocks>;
  onToggleBlock(itemId: string): void;
  questions: Array<{ itemId: string; nodeId: string }>;
  selected: string | null;
  onQuestion(itemId: string | null, mods?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void;
  ticked?: string[];
  tool?: Tool;
  onArea?(ids: string[], additive: boolean): void;
  /** The Link tool: a line drawn from a question to a question, block or survey. */
  onLink?(fromId: string, to: { kind: 'question' | 'block'; itemId: string } | { kind: 'survey'; surveyName: string }): void;
  /** Something from the palette dropped on the chart (on a question, a block, or empty space). */
  onDropItem?(item: DropItem, target: DropTarget): void;
  /** Shown in the canvas's top-left corner (the edit tools). */
  corner?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setViewRaw] = useState<View>({ x: 0, y: 0, k: 1 });
  const [size, setSizeRaw] = useState({ w: 800, h: 600, cw: 800, ch: 500 });
  const sizeRef = useRef(size);
  const setSize = (s: typeof size) => {
    sizeRef.current = s;
    setSizeRaw(s);
  };
  // Keep the chart on screen: a wide/tall chart can't be pulled past its edges (plus a small margin),
  // and one that fits can't be pushed out of the window.
  const setView = useCallback((u: View | ((v: View) => View)) => {
    setViewRaw((prev) => {
      const v = typeof u === 'function' ? u(prev) : u;
      const { w, h, cw, ch } = sizeRef.current;
      const M = 40;
      const clamp = (pos: number, len: number, win: number) => {
        const a = M;
        const b = win - len - M;
        return Math.max(Math.min(a, b), Math.min(Math.max(a, b), pos));
      };
      return { k: v.k, x: clamp(v.x, w * v.k, cw), y: clamp(v.y, h * v.k, ch) };
    });
  }, []);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const lastKey = useRef<string | null>(null);

  // Measure the drawing; fit it the first time a survey is shown (keep the view when only folding).
  useEffect(() => {
    const el = host.current;
    const svgEl = el?.querySelector('.dm-canvas-inner svg') as SVGSVGElement | null;
    if (!el || !svgEl) return;
    const vb = svgEl.viewBox.baseVal;
    const w = vb?.width || svgEl.getBoundingClientRect().width;
    const h = vb?.height || svgEl.getBoundingClientRect().height;
    svgEl.setAttribute('width', String(w));
    svgEl.setAttribute('height', String(h));
    svgEl.style.maxWidth = 'none';
    setSize({ w, h, cw: el.clientWidth, ch: el.clientHeight });
    const firstDraw = lastKey.current !== fitKey;
    lastKey.current = fitKey;
    if (firstDraw) {
      // Show the whole chart when it fits at a readable size; otherwise start at the top, centred.
      const k = Math.max(0.4, Math.min(1.1, (el.clientWidth - 40) / w, (el.clientHeight - 40) / h));
      setView({ k, x: (el.clientWidth - w * k) / 2, y: h * k < el.clientHeight ? (el.clientHeight - h * k) / 2 : 20 });
    }
    // Make block clusters, folded nodes and questions look clickable.
    for (const b of blocks) {
      for (const id of [b.clusterId, b.collapsedId]) {
        const g = findMermaidEl(svgEl, id);
        if (g) g.classList.add('dm-foldable');
      }
    }
    for (const q of questions) findMermaidEl(svgEl, q.nodeId)?.classList.add('dm-inspectable');
  }, [svg, blocks, fitKey, questions]);

  // Mark the question whose details are open, and questions picked for a new block.
  useEffect(() => {
    const svgEl = host.current?.querySelector('.dm-canvas-inner svg');
    if (!svgEl) return;
    svgEl.querySelectorAll('.dm-node-selected, .dm-node-ticked').forEach((g) => g.classList.remove('dm-node-selected', 'dm-node-ticked'));
    const node = questions.find((q) => q.itemId === selected);
    if (node) findMermaidEl(svgEl, node.nodeId)?.classList.add('dm-node-selected');
    for (const id of ticked ?? []) {
      const n = questions.find((q) => q.itemId === id);
      if (n) findMermaidEl(svgEl, n.nodeId)?.classList.add('dm-node-ticked');
    }
  }, [svg, selected, questions, ticked]);

  const fit = () => {
    const k = Math.max(0.1, Math.min(1.1, (size.cw - 40) / size.w, (size.ch - 40) / size.h));
    setView({ k, x: (size.cw - size.w * k) / 2, y: (size.ch - size.h * k) / 2 });
  };
  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.max(0.1, Math.min(4, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });

  // Wheel: scroll moves the chart (Shift or a sideways swipe moves it sideways); Ctrl+scroll or a
  // trackpad pinch zooms at the pointer. A native, non-passive listener so the page itself doesn't
  // scroll or browser-zoom while the pointer is over the chart.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.002), e.clientX - r.left, e.clientY - r.top);
      } else if (e.shiftKey && !dx) {
        setView((v) => ({ ...v, x: v.x - dy }));
      } else {
        setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // zoomAt only uses the functional setView, so the first one stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The question or block under an element of the drawing. */
  const hitTest = (target: EventTarget | null): DropTarget => {
    let el = target as Element | null;
    const matches = (id: string, dataId: string, x: string) => id === x || dataId === x || id.includes(`-${x}-`) || id.endsWith(`-${x}`);
    while (el && el !== host.current) {
      const id = el.getAttribute('id') ?? '';
      const dataId = el.getAttribute('data-id') ?? '';
      // A question node sits inside its block's cluster, so it is reached (and wins) first.
      const question = el.matches('g.node') ? questions.find((q) => matches(id, dataId, q.nodeId)) : undefined;
      if (question) return { kind: 'question', itemId: question.itemId };
      const block = blocks.find((b) => [b.clusterId, b.collapsedId].some((x) => matches(id, dataId, x)));
      if (block) return { kind: 'block', itemId: block.itemId };
      el = el.parentElement;
    }
    return null;
  };
  const onClick = (target: EventTarget | null, mods?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const hit = hitTest(target);
    if (hit?.kind === 'question') return onQuestion(!mods?.ctrlKey && !mods?.shiftKey && !mods?.metaKey && hit.itemId === selected ? null : hit.itemId, mods);
    if (hit?.kind === 'block') return onToggleBlock(hit.itemId);
  };
  /** The Link tool's line, in canvas coordinates. */
  const [link, setLink] = useState<{ from: string; x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** The question or block a drop would land on, highlighted while dragging over the chart. */
  const markDrop = (t: DropTarget) => {
    const svgEl = host.current?.querySelector('.dm-canvas-inner svg');
    if (!svgEl) return;
    svgEl.querySelectorAll('.dm-drop-target').forEach((g) => g.classList.remove('dm-drop-target'));
    if (!t) return;
    const nodeId = t.kind === 'question' ? questions.find((q) => q.itemId === t.itemId)?.nodeId : blocks.find((b) => b.itemId === t.itemId)?.clusterId;
    if (nodeId) findMermaidEl(svgEl, nodeId)?.classList.add('dm-drop-target');
  };

  // Minimap geometry. Short charts fit whole; long ones keep a readable width and the map scrolls
  // to follow the view (like an editor's code overview).
  const MW = 240;
  const MH = 300;
  const MIN_W = 170;
  let m = Math.min(MW / size.w, MH / size.h);
  if (size.w * m < MIN_W) m = Math.min(MW, MIN_W) / size.w;
  const miniW = size.w * m;
  const fullH = size.h * m;
  const boxH = Math.min(fullH, Math.max(140, Math.min(420, size.ch - 90)));
  const vp = { left: (-view.x / view.k) * m, top: (-view.y / view.k) * m, width: (size.cw / view.k) * m, height: (size.ch / view.k) * m };
  const off = Math.max(0, Math.min(fullH - boxH, vp.top + vp.height / 2 - boxH / 2));
  const jump = (mx: number, my: number) => setView((v) => ({ ...v, x: size.cw / 2 - (mx / m) * v.k, y: size.ch / 2 - ((my + off) / m) * v.k }));
  const miniSrc = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);
  const miniDrag = useRef(false);
  const [miniOpen, setMiniOpenState] = useState(() => {
    try {
      return localStorage.getItem('dm.flowchart.minimap') !== 'closed';
    } catch {
      return true;
    }
  });
  const setMiniOpen = (open: boolean) => {
    setMiniOpenState(open);
    try {
      localStorage.setItem('dm.flowchart.minimap', open ? 'open' : 'closed');
    } catch {
      /* per-viewer convenience only */
    }
  };

  /** The Select tool's box, in canvas coordinates. */
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const finishBand = (b: NonNullable<typeof band>, additive: boolean) => {
    const box = host.current!.getBoundingClientRect();
    const r = { left: box.left + Math.min(b.x0, b.x1), right: box.left + Math.max(b.x0, b.x1), top: box.top + Math.min(b.y0, b.y1), bottom: box.top + Math.max(b.y0, b.y1) };
    const svgEl = host.current!.querySelector('.dm-canvas-inner svg');
    const ids = svgEl
      ? questions
          .filter((q) => {
            const n = findMermaidEl(svgEl, q.nodeId)?.getBoundingClientRect();
            return n && n.right > r.left && n.left < r.right && n.bottom > r.top && n.top < r.bottom;
          })
          .map((q) => q.itemId)
      : [];
    onArea?.(ids, additive);
  };

  return (
    <div
      ref={host}
      className={`dm-canvas ${tool === 'select' ? 'is-selecting' : ''} ${tool === 'link' ? 'is-linking' : ''}`}
      onDragOver={(e) => {
        if (!onDropItem || !e.dataTransfer.types.includes(DND_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        markDrop(hitTest(document.elementFromPoint(e.clientX, e.clientY)));
      }}
      onDragLeave={() => markDrop(null)}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DND_TYPE);
        markDrop(null);
        if (!onDropItem || !raw) return;
        e.preventDefault();
        onDropItem(JSON.parse(raw) as DropItem, hitTest(document.elementFromPoint(e.clientX, e.clientY)));
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, .dm-minimap, .dm-canvas-corner')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (tool === 'link') {
          const hit = hitTest(document.elementFromPoint(e.clientX, e.clientY));
          if (hit?.kind === 'question') {
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - box.left;
            const y = e.clientY - box.top;
            setLink({ from: hit.itemId, x0: x, y0: y, x1: x, y1: y });
            return;
          }
        }
        if (tool === 'select') {
          e.preventDefault(); // don't highlight the labels' text while dragging the box
          window.getSelection()?.removeAllRanges();
          const box = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - box.left;
          const y = e.clientY - box.top;
          setBand({ x0: x, y0: y, x1: x, y1: y });
          return;
        }
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      }}
      onPointerMove={(e) => {
        if (link) {
          const box = e.currentTarget.getBoundingClientRect();
          setLink({ ...link, x1: e.clientX - box.left, y1: e.clientY - box.top });
          const under = document.elementFromPoint(e.clientX, e.clientY);
          markDrop(under?.closest('[data-dm-survey]') ? null : hitTest(under));
          return;
        }
        if (band) {
          const box = e.currentTarget.getBoundingClientRect();
          setBand({ ...band, x1: e.clientX - box.left, y1: e.clientY - box.top });
          return;
        }
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
        setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
      }}
      onPointerUp={(e) => {
        const mods = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey };
        if (link) {
          const l = link;
          setLink(null);
          markDrop(null);
          const under = document.elementFromPoint(e.clientX, e.clientY);
          const surveyChip = under?.closest('[data-dm-survey]');
          if (surveyChip) return onLink?.(l.from, { kind: 'survey', surveyName: surveyChip.getAttribute('data-dm-survey')! });
          const hit = hitTest(under);
          // A short drag is a click: select the question.
          if (Math.abs(l.x1 - l.x0) + Math.abs(l.y1 - l.y0) < 6) return onClick(under, mods);
          if (hit && hit.itemId !== l.from) onLink?.(l.from, hit);
          return;
        }
        if (band) {
          const b = band;
          setBand(null);
          // A box too small to be a drag is a click.
          if (Math.abs(b.x1 - b.x0) + Math.abs(b.y1 - b.y0) < 6) onClick(document.elementFromPoint(e.clientX, e.clientY), mods);
          else finishBand(b, e.shiftKey || e.ctrlKey || e.metaKey);
          return;
        }
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          // Pointer capture retargets the event; find what's under the pointer instead.
          onClick(document.elementFromPoint(e.clientX, e.clientY), mods);
        }
      }}
    >
      {band && (
        <div
          className="dm-select-band"
          style={{ left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }}
        />
      )}
      {link && (
        <svg className="dm-link-line" aria-hidden="true">
          <defs>
            <marker id="dm-link-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          <line x1={link.x0} y1={link.y0} x2={link.x1} y2={link.y1} markerEnd="url(#dm-link-arrow)" />
        </svg>
      )}
      {corner && <div className="dm-canvas-corner">{corner}</div>}
      <div className="dm-canvas-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }} dangerouslySetInnerHTML={{ __html: svg }} />
      {miniOpen ? (
        <div className="dm-minimap" style={{ width: miniW + 14 }}>
          <div className="dm-minimap-head">
            <span>Overview</span>
            <button onClick={() => setMiniOpen(false)} aria-label="Hide overview" title="Hide overview">
              −
            </button>
          </div>
          <div
            className="dm-minimap-body"
            style={{ width: miniW, height: boxH }}
            onPointerDown={(e) => {
              miniDrag.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              const r = e.currentTarget.getBoundingClientRect();
              jump(e.clientX - r.left, e.clientY - r.top);
            }}
            onPointerMove={(e) => {
              if (!miniDrag.current) return;
              const r = e.currentTarget.getBoundingClientRect();
              jump(e.clientX - r.left, e.clientY - r.top);
            }}
            onPointerUp={() => (miniDrag.current = false)}
            title="Click or drag to move around"
          >
            <img src={miniSrc} alt="" width={miniW} height={fullH} draggable={false} style={{ transform: `translateY(${-off}px)` }} />
            <span className="dm-minimap-view" style={{ left: vp.left, top: vp.top - off, width: vp.width, height: vp.height }} />
          </div>
        </div>
      ) : (
        <button className="dm-minimap-show" onClick={() => setMiniOpen(true)} title="Show overview">
          Overview
        </button>
      )}
      <div className="dm-zoom">
        <button onClick={() => zoomAt(1.25, size.cw / 2, size.ch / 2)} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomAt(0.8, size.cw / 2, size.ch / 2)} aria-label="Zoom out">
          −
        </button>
        <button onClick={fit}>Fit</button>
      </div>
    </div>
  );
}

/** Mermaid element for a node/cluster id (ids are prefixed differently across versions). */
function findMermaidEl(root: Element, id: string): Element | null {
  return (
    root.querySelector(`[id="${id}"]`) ??
    root.querySelector(`[data-id="${id}"]`) ??
    [...root.querySelectorAll('g.node, g.cluster')].find((g) => (g.id ?? '').includes(`-${id}-`) || (g.id ?? '').endsWith(`-${id}`)) ??
    null
  );
}

/** The survey flow as indented text, with copy and download. */
function TextOutline({ text, fileName, notify }: { text: string; fileName: string; notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number }) {
  return (
    <div className="dm-outline">
      <div className="dm-outline-bar">
        <strong>Text outline</strong>
        <span className="dm-inline dm-inline-tight">
          <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => void navigator.clipboard.writeText(text).then(() => notify('Outline copied.'))}>
            Copy
          </button>
          <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => download(fileName, text, 'text/plain')}>
            Download .txt
          </button>
        </span>
      </div>
      <pre className="dm-outline-text">{text}</pre>
    </div>
  );
}

/** Details of one question, opened by clicking it in the flowchart. */
function QuestionPanel({
  spec,
  survey,
  itemId,
  onClose,
  openInCodebook,
  onEdit,
}: {
  spec: StudySpec;
  survey: Survey;
  itemId: string;
  onClose(): void;
  openInCodebook(): void;
  onEdit(): void;
}) {
  const model = useMemo(() => buildSurveyModel(survey), [survey]);
  // Indexing every response is the slow part, so it happens once per study, and only when a panel opens.
  const responses = useMemo(() => (hasResponseData(spec) ? indexResponses(spec) : null), [spec]);
  const total = useMemo(() => dataOverview(spec)?.participants ?? 0, [spec]);
  const q = model.byId.get(itemId);
  if (!q) return null;
  const text = stripHtml(q['Question.Text'] ?? '') || itemLabel(q);
  const opts = responseOptions(q);
  const when = shownWhen(model, itemId);
  const leadsTo = triggers(model, itemId);
  const path = blockPath(model, q);
  const stats = responses ? describeItem(q, responses.get(q['Question.ID']), total) : null;
  const pct = stats?.delivered ? Math.round((stats.answered / stats.delivered) * 1000) / 10 : null;
  const MAX_OPTS = 12;
  return (
    <aside className="dm-q-panel" aria-label="Question details">
      <div className="dm-q-panel-head">
        <code>{q['Question.ID']}</code>
        <button className="dm-icon-btn" onClick={onClose} aria-label="Close details" title="Close">
          ×
        </button>
      </div>
      <h3>{text}</h3>
      <p className="dm-q-panel-meta">
        {[q['Question.Type.Display.Name'], q['Data.Type'], path.length ? `Block: ${path.join(' › ')}` : ''].filter(Boolean).join(' · ')}
      </p>
      {q['Question.Description'] && <p>{q['Question.Description']}</p>}
      <dl className="dm-q-panel-dl">
        <dt>Shown</dt>
        <dd>{when ? `Only if ${when}` : 'Always'}</dd>
        {leadsTo.length > 0 && (
          <>
            <dt>Leads to</dt>
            <dd>
              <ul>
                {leadsTo.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {stats && (
          <>
            <dt>Responses</dt>
            <dd>
              {stats.answered.toLocaleString()} answered of {stats.delivered.toLocaleString()} delivered{pct != null ? ` (${pct}%)` : ''}, from {stats.participantsAnswered.toLocaleString()} participant
              {stats.participantsAnswered === 1 ? '' : 's'}
            </dd>
          </>
        )}
      </dl>
      {opts.length > 0 && (
        <table className="dm-q-panel-opts">
          <thead>
            <tr>
              <th>Value</th>
              <th>Label</th>
            </tr>
          </thead>
          <tbody>
            {opts.slice(0, MAX_OPTS).map((o) => (
              <tr key={o.value}>
                <td>{o.value}</td>
                <td>{o.label}</td>
              </tr>
            ))}
            {opts.length > MAX_OPTS && (
              <tr>
                <td colSpan={2} className="dm-hint">
                  and {opts.length - MAX_OPTS} more
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="dm-q-panel-actions">
        <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={openInCodebook}>
          <Icon name="book" size={14} /> Open in codebook
        </button>
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={onEdit}>
          <Icon name="edit" size={14} /> Edit
        </button>
      </div>
    </aside>
  );
}
