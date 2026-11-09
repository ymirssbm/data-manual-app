import { useEffect, useRef, useState } from 'react';
import type { StudySpec } from '../../core';
import { generateFlowchart } from '../../generators';
import type { PageId } from '../App';
import { Box, Field, Icon, PageTitle } from '../ui';
import { download, renderMermaid, safeFileName, svgToPng } from '../util';
import { NoStudy } from './common';

interface Props {
  spec: StudySpec | null;
  go(id: PageId): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

export function FlowchartPage({ spec, go, notify }: Props) {
  const surveys = spec?.surveys ?? [];
  const [surveyName, setSurveyName] = useState(surveys[0]?.['Survey.Name'] ?? '');
  const [showIds, setShowIds] = useState(false);
  const [drawn, setDrawn] = useState<{ svg: string; code: string; survey: string } | null>(null);
  const [showCode, setShowCode] = useState(false);

  if (!spec) return (<><PageTitle>Flowchart Visualization</PageTitle><NoStudy go={go} what="a flowchart" /></>);

  const generate = async () => {
    const survey = surveys.find((s) => s['Survey.Name'] === surveyName) ?? surveys[0];
    if (!survey) return;
    try {
      const code = generateFlowchart(survey, { showIds });
      setDrawn({ svg: await renderMermaid(code), code, survey: survey['Survey.Name'] });
      notify('Flowchart generated successfully!');
    } catch (e) {
      notify(`Error generating flowchart: ${(e as Error).message}`, 'error', 10000);
    }
  };

  const exportPng = async () => {
    if (!drawn) return;
    try {
      download(safeFileName(`${drawn.survey}_flowchart`) + '.png', await svgToPng(drawn.svg, 2));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <>
      <PageTitle>Flowchart Visualization</PageTitle>
      <Box title="Generate Flow Chart">
        <div className="dm-grid-2 dm-align-end">
          <Field label="Select survey">
            <select className="dm-input" value={surveyName} onChange={(e) => setSurveyName(e.target.value)}>
              {surveys.map((s) => (
                <option key={s['Survey.Name']} value={s['Survey.Name']}>
                  {s['Survey.LongName'] || s['Survey.Name']}
                </option>
              ))}
            </select>
          </Field>
          <div className="dm-inline">
            <button className="dm-btn dm-btn-primary" onClick={() => void generate()}>
              Generate Flow Chart
            </button>
            <label className="dm-check">
              <input type="checkbox" checked={showIds} onChange={(e) => setShowIds(e.target.checked)} /> Show question IDs
            </label>
          </div>
        </div>
      </Box>
      <Box>
        <div className="dm-inline">
          <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={() => void exportPng()} disabled={!drawn}>
            <Icon name="download" /> Export PNG
          </button>
          <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => drawn && download(safeFileName(`${drawn.survey}_flowchart`) + '.svg', drawn.svg, 'image/svg+xml')} disabled={!drawn}>
            Export SVG
          </button>
          <small className="dm-hint">{drawn ? 'Drag to move, scroll to zoom.' : 'Generate a flowchart before exporting.'}</small>
          {drawn && (
            <label className="dm-check dm-push-right">
              <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} /> Show Mermaid code
            </label>
          )}
        </div>
        {drawn && <PanZoom svg={drawn.svg} />}
        {drawn && showCode && <pre className="dm-code">{drawn.code}</pre>}
      </Box>
    </>
  );
}

/** Drag to pan, wheel/buttons to zoom, Fit to reset. */
function PanZoom({ svg }: { svg: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const fit = () => {
    const el = host.current;
    const svgEl = el?.querySelector('svg');
    if (!el || !svgEl) return;
    const vb = svgEl.viewBox.baseVal;
    const w = vb?.width || svgEl.getBoundingClientRect().width;
    const h = vb?.height || svgEl.getBoundingClientRect().height;
    const k = Math.min(1.1, (el.clientWidth - 32) / w, Math.max((el.clientHeight - 32) / h, 0.7));
    setView({ k, x: (el.clientWidth - w * k) / 2, y: 16 });
  };

  useEffect(() => {
    const svgEl = host.current?.querySelector('svg');
    if (svgEl) {
      const vb = svgEl.viewBox.baseVal;
      if (vb?.width) {
        svgEl.setAttribute('width', String(vb.width));
        svgEl.setAttribute('height', String(vb.height));
      }
      svgEl.style.maxWidth = 'none';
    }
    fit();
  }, [svg]);

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.max(0.1, Math.min(4, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  const center = () => [(host.current?.clientWidth ?? 0) / 2, (host.current?.clientHeight ?? 0) / 2] as const;

  return (
    <div
      ref={host}
      className="dm-canvas"
      onWheel={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <div className="dm-canvas-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="dm-zoom">
        <button onClick={() => zoomAt(1.25, ...center())} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomAt(0.8, ...center())} aria-label="Zoom out">
          −
        </button>
        <button onClick={fit}>Fit</button>
      </div>
    </div>
  );
}
