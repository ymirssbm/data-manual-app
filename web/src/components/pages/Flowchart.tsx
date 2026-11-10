import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSurveyModel, isQuestion, type StudySpec } from '../../core';
import { flowchartBlocks, flowchartText, generateFlowchart } from '../../generators';
import type { PageId } from '../App';
import { Icon, PageTitle } from '../ui';
import { download, renderMermaid, safeFileName, svgToPng } from '../util';
import { NoStudy } from './common';

interface Props {
  spec: StudySpec | null;
  go(id: PageId): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

interface View {
  x: number;
  y: number;
  k: number;
}

export function FlowchartPage({ spec, go, notify }: Props) {
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
  const collapsed = survey ? (folded[survey['Survey.Name']] ?? []) : [];
  const code = useMemo(() => (survey ? generateFlowchart(survey, { showIds, direction, collapsed }) : ''), [survey, showIds, direction, collapsed.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!spec || !survey) return (<><PageTitle>Flowchart Visualization</PageTitle><NoStudy go={go} what="a flowchart" /></>);
  const base = safeFileName(`${survey['Survey.Name']}_flowchart`);

  return (
    <>
      <PageTitle
        actions={
          <>
            <button className="dm-btn dm-btn-secondary" onClick={() => svg && download(`${base}.svg`, svg, 'image/svg+xml')} disabled={!svg}>
              Export SVG
            </button>
            <button
              className="dm-btn dm-btn-primary"
              disabled={!svg}
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
                  {m.items.filter(isQuestion).length} questions · {m.branches.length} branches
                </span>
              </button>
            );
          })}
        </nav>

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
            <span className="dm-hint dm-push-right">{blocks.length ? 'Click a block to fold or unfold it · ' : ''}scroll or drag to move · Ctrl + scroll to zoom</span>
          </div>
          {drawn ? <Canvas svg={drawn.svg} fitKey={drawn.key} blocks={blocks} onToggleBlock={toggleBlock} /> : <p className="dm-empty">Drawing…</p>}
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
      </div>
    </>
  );
}

/** Pan/zoom canvas with a clickable minimap; clicks on block clusters fold them. */
/** `fitKey` changes when a different survey/layout is shown (refit); folding keeps the current view. */
function Canvas({ svg, fitKey, blocks, onToggleBlock }: { svg: string; fitKey: string; blocks: ReturnType<typeof flowchartBlocks>; onToggleBlock(itemId: string): void }) {
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
    // Make block clusters and folded nodes look clickable.
    for (const b of blocks) {
      for (const id of [b.clusterId, b.collapsedId]) {
        const g = findMermaidEl(svgEl, id);
        if (g) g.classList.add('dm-foldable');
      }
    }
  }, [svg, blocks, fitKey]);

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

  const onClick = (target: EventTarget | null) => {
    let el = target as Element | null;
    while (el && el !== host.current) {
      const id = el.getAttribute('id') ?? '';
      const dataId = el.getAttribute('data-id') ?? '';
      const block = blocks.find((b) => [b.clusterId, b.collapsedId].some((x) => id === x || dataId === x || id.includes(`-${x}-`) || id.endsWith(`-${x}`)));
      if (block) return onToggleBlock(block.itemId);
      el = el.parentElement;
    }
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

  return (
    <div
      ref={host}
      className="dm-canvas"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, .dm-minimap')) return;
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
        setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          // Pointer capture retargets the event; find what's under the pointer instead.
          onClick(document.elementFromPoint(e.clientX, e.clientY));
        }
      }}
    >
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
