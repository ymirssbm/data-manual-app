import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudySpec } from '../../core';
import {
  CODEBOOK_FONTS,
  CODEBOOK_PRESETS,
  hasResponseData,
  QUESTION_TYPES,
  type CodebookFont,
  type CodebookOptions,
  type CodebookText,
  type CodebookTheme,
} from '../../generators';
import type { PageId } from '../App';
import { buildCodebook, type CodebookSettings } from '../codebookBuild';
import { HtmlFrame } from '../HtmlFrame';
import { Box, Field, Icon, PageTitle } from '../ui';
import { download, safeFileName } from '../util';
import { NoStudy } from './common';

/** The codebook last built for a given spec + settings; shared by the generator preview and the viewer. */
export interface GeneratedCodebook {
  spec: StudySpec;
  settings: CodebookSettings;
  html: string;
}

type BoolKey = { [K in keyof CodebookOptions]: CodebookOptions[K] extends boolean ? K : never }[keyof CodebookOptions];
interface TreeNode {
  label: string;
  key?: BoolKey;
  type?: string;
  children?: TreeNode[];
  needsData?: boolean;
}

// The prior tool's option tree, plus the two new pages.
const TREE: TreeNode[] = [
  {
    label: 'Title Page',
    children: [
      { label: 'Name of Study', key: 'nameOfStudy' },
      { label: 'Authors', key: 'authors' },
      { label: 'Study Metadata', key: 'studyMetadata' },
      { label: 'Funding', key: 'funding' },
    ],
  },
  { label: 'Abstract', key: 'abstract' },
  { label: 'Effective Summary', key: 'effectiveSummary' },
  { label: 'Study Schedule', key: 'studySchedule' },
  { label: 'Survey Flowcharts', key: 'flowcharts' },
  { label: 'Data Types', children: QUESTION_TYPES.map((t) => ({ label: t, type: t })) },
  {
    label: 'Variable Pages',
    children: [
      { label: 'Way question was delivered', key: 'deliveryType' },
      { label: 'Type of data', key: 'typeOfData' },
      { label: 'Response options', key: 'responseOptions' },
      { label: 'Skip Logic', key: 'skipLogic' },
      { label: 'Frequency Table', key: 'frequencyTable', needsData: true },
      { label: 'Bar Plot', key: 'barPlot', needsData: true },
      { label: 'Histograms', key: 'histograms', needsData: true },
      { label: 'Missingness Page', key: 'missingness', needsData: true },
      { label: 'Screenshot', key: 'screenshots' },
    ],
  },
];

/** Builds (debounced) whenever spec or settings change, and reports the result upward. */
function useCodebook(spec: StudySpec | null, settings: CodebookSettings, cached: GeneratedCodebook | null, onBuilt: (c: GeneratedCodebook) => void, delay = 250) {
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = cached && cached.spec === spec && cached.settings === settings;
  useEffect(() => {
    if (!spec || fresh) return;
    let cancelled = false;
    setBuilding(true);
    const timer = setTimeout(() => {
      buildCodebook(spec, settings)
        .then((html) => !cancelled && (onBuilt({ spec, settings, html }), setError(null)))
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setBuilding(false));
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spec, settings, fresh, onBuilt, delay]);
  return { building: building || (!!spec && !fresh), error };
}

interface GenProps {
  spec: StudySpec | null;
  settings: CodebookSettings;
  setSettings(s: CodebookSettings): void;
  codebook: GeneratedCodebook | null;
  onBuilt(c: GeneratedCodebook): void;
  go(id: PageId): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

export function CodebookGeneratorPage({ spec, settings, setSettings, codebook, onBuilt, go, notify }: GenProps) {
  const [panel, setPanel] = useState<'look' | 'content' | 'details'>('look');
  const [controlsOpen, setControlsOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const hasData = useMemo(() => (spec ? hasResponseData(spec) : false), [spec]);
  const { building, error } = useCodebook(spec, settings, codebook, onBuilt);

  if (!spec) return (<><PageTitle>Codebook Generator</PageTitle><NoStudy go={go} what="a codebook" /></>);
  const { options: opts, theme, text } = settings;
  const setOpts = (o: CodebookOptions) => setSettings({ ...settings, options: o });
  const setTheme = (t: Partial<CodebookTheme>) => setSettings({ ...settings, theme: { ...theme, ...t } });
  const setText = (k: keyof CodebookText) => (e: { target: { value: string } }) => setSettings({ ...settings, text: { ...text, [k]: e.target.value } });
  const preset = Object.entries(CODEBOOK_PRESETS).find(([, p]) => (Object.keys(p.theme) as Array<keyof CodebookTheme>).every((k) => p.theme[k] === theme[k]))?.[0];

  const isOn = (n: TreeNode): boolean => (n.key ? (opts[n.key] as boolean) : n.type ? opts.dataTypes.includes(n.type) : (n.children ?? []).every(isOn));
  const setNode = (n: TreeNode, on: boolean, o: CodebookOptions): CodebookOptions => {
    if (n.key) return { ...o, [n.key]: on };
    if (n.type) return { ...o, dataTypes: on ? [...new Set([...o.dataTypes, n.type])] : o.dataTypes.filter((t) => t !== n.type) };
    return (n.children ?? []).reduce((acc, c) => setNode(c, on, acc), o);
  };
  const renderNode = (n: TreeNode) => {
    const disabled = n.needsData && !hasData;
    const on = isOn(n);
    const partial = !n.key && !n.type && !on && (n.children ?? []).some(isOn);
    return (
      <li key={n.label}>
        <label className={`dm-tree-item ${disabled ? 'is-disabled' : ''}`}>
          <input
            type="checkbox"
            checked={on && !disabled}
            disabled={disabled}
            ref={(el) => {
              if (el) el.indeterminate = partial;
            }}
            onChange={(e) => setOpts(setNode(n, e.target.checked, opts))}
          />
          <span>{n.label}</span>
          {disabled && <span className="dm-hint">(needs response data)</span>}
        </label>
        {n.children && <ul>{n.children.map(renderNode)}</ul>}
      </li>
    );
  };

  const colorField = (label: string, key: 'accent' | 'background' | 'surface' | 'headerBg' | 'text') => (
    <label className="dm-color">
      <input type="color" value={theme[key]} onChange={(e) => setTheme({ [key]: e.target.value })} />
      <span>{label}</span>
      <code>{theme[key]}</code>
    </label>
  );

  return (
    <>
      <PageTitle
        actions={
          <button
            className="dm-btn dm-btn-primary"
            disabled={building}
            onClick={() => {
              notify('Codebook Generation Complete!');
              go('codebook_view');
            }}
          >
            <Icon name="file" /> {building ? 'Building…' : 'Generate Codebook'}
          </button>
        }
      >
        Codebook Generator
      </PageTitle>
      <div className={`dm-gen-layout ${controlsOpen ? '' : 'is-controls-collapsed'} ${previewOpen ? '' : 'is-preview-collapsed'}`}>
        {!controlsOpen && (
          <button className="dm-collapsed-rail" onClick={() => setControlsOpen(true)} title="Show options">
            <span>›</span>
            <span className="dm-rail-label">Options</span>
          </button>
        )}
        <div className="dm-gen-controls" hidden={!controlsOpen}>
          <div className="dm-panel-head">
            <span>Options</span>
            <button className="dm-icon-btn" onClick={() => setControlsOpen(false)} title="Collapse options" aria-label="Collapse options">
              ‹
            </button>
          </div>
          <div className="dm-segmented" role="tablist">
            {(
              [
                ['look', 'Appearance'],
                ['content', 'Content'],
                ['details', 'Study details'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={panel === id} className={panel === id ? 'is-active' : ''} onClick={() => setPanel(id)}>
                {label}
              </button>
            ))}
          </div>

          {panel === 'look' && (
            <Box title="Appearance">
              <span className="dm-label">Theme</span>
              <div className="dm-presets">
                {Object.entries(CODEBOOK_PRESETS).map(([id, p]) => (
                  <button key={id} className={`dm-preset ${preset === id ? 'is-active' : ''}`} onClick={() => setSettings({ ...settings, theme: { ...p.theme } })}>
                    <span className="dm-preset-swatch" style={{ background: p.theme.background }}>
                      <span style={{ background: p.theme.surface, borderColor: p.theme.accent }}>
                        <i style={{ background: p.theme.accent }} />
                        <i style={{ background: p.theme.headerBg }} />
                      </span>
                    </span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>

              <span className="dm-label">Colors</span>
              <div className="dm-colors">
                {colorField('Accent', 'accent')}
                {colorField('Page background', 'background')}
                {colorField('Content card', 'surface')}
                {colorField('Question header', 'headerBg')}
                {colorField('Text', 'text')}
              </div>

              <div className="dm-grid-2 dm-gap-sm">
                <Field label="Body font">
                  <select className="dm-input" value={theme.bodyFont} onChange={(e) => setTheme({ bodyFont: e.target.value as CodebookFont })}>
                    {Object.entries(CODEBOOK_FONTS).map(([k, f]) => (
                      <option key={k} value={k}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Heading font">
                  <select className="dm-input" value={theme.headingFont} onChange={(e) => setTheme({ headingFont: e.target.value as CodebookFont })}>
                    {Object.entries(CODEBOOK_FONTS).map(([k, f]) => (
                      <option key={k} value={k}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Text size: ${theme.fontSize}px`}>
                  <input className="dm-range" type="range" min={13} max={22} value={theme.fontSize} onChange={(e) => setTheme({ fontSize: Number(e.target.value) })} />
                </Field>
                <Field label="Charts">
                  <select className="dm-input" value={theme.charts} onChange={(e) => setTheme({ charts: e.target.value as CodebookTheme['charts'] })}>
                    <option value="ggplot">ggplot grey</option>
                    <option value="accent">Accent color</option>
                  </select>
                </Field>
              </div>
              <label className="dm-check">
                <input type="checkbox" checked={theme.expandVisuals} onChange={(e) => setTheme({ expandVisuals: e.target.checked })} /> Show visuals expanded by default
              </label>
            </Box>
          )}

          {panel === 'content' && (
            <Box title="Codebook Options">
              <ul className="dm-tree">{TREE.map(renderNode)}</ul>
            </Box>
          )}

          {panel === 'details' && (
            <Box title="Study Metadata">
              <Field label="Title">
                <input className="dm-input" value={text.title} onChange={setText('title')} placeholder="Enter title" />
              </Field>
              <Field label="Authors">
                <input className="dm-input" value={text.authors} onChange={setText('authors')} placeholder="Enter authors" />
              </Field>
              <Field label="Funding">
                <textarea className="dm-input" rows={3} value={text.funding} onChange={setText('funding')} placeholder="Enter funding information" />
              </Field>
              <Field label="Abstract">
                <textarea className="dm-input" rows={4} value={text.abstract} onChange={setText('abstract')} placeholder="Enter abstract" />
              </Field>
              <Field label="Summary" hint="Leave blank for an automatic summary of surveys and variables.">
                <textarea className="dm-input" rows={4} value={text.summary} onChange={setText('summary')} placeholder="Enter summary" />
              </Field>
            </Box>
          )}
        </div>

        <section className={`dm-gen-preview ${previewOpen ? '' : 'is-collapsed'}`}>
          <div className="dm-preview-bar">
            <button className="dm-preview-toggle" onClick={() => setPreviewOpen((o) => !o)} aria-expanded={previewOpen}>
              <span className="dm-caret">{previewOpen ? '▾' : '▸'}</span> Live preview
            </button>
            <span className="dm-hint">{error ? `Error: ${error}` : building ? 'Updating…' : 'Up to date'}</span>
          </div>
          {previewOpen &&
            (codebook && codebook.spec === spec ? <HtmlFrame html={codebook.html} title="Codebook preview" className="dm-preview-frame" /> : <p className="dm-empty">Building preview…</p>)}
        </section>
      </div>
    </>
  );
}

interface ViewProps {
  spec: StudySpec | null;
  settings: CodebookSettings;
  codebook: GeneratedCodebook | null;
  onBuilt(c: GeneratedCodebook): void;
  go(id: PageId): void;
}

export function CodebookViewerPage({ spec, settings, codebook, onBuilt, go }: ViewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  // The viewer builds the codebook itself if there isn't a current one, so it's never blank.
  const { building } = useCodebook(spec, settings, codebook, onBuilt, 0);
  if (!spec) return (<><PageTitle>Codebook Viewer</PageTitle><NoStudy go={go} what="a codebook" /></>);
  const current = codebook && codebook.spec === spec ? codebook : null;
  const fileName = `${safeFileName(settings.text.title || spec['Study.Metadata']['Study.Name'])}_Codebook.html`;

  return (
    <>
      <PageTitle
        actions={
          <>
            <button className="dm-btn dm-btn-secondary" onClick={() => go('codebook_gen')}>
              <Icon name="cog" /> Customize
            </button>
            <button className="dm-btn dm-btn-secondary" disabled={!current} onClick={() => frame.current?.contentWindow?.print()}>
              <Icon name="print" /> Save as PDF
            </button>
            <button className="dm-btn dm-btn-primary" disabled={!current} onClick={() => current && download(fileName, current.html, 'text/html')}>
              <Icon name="download" /> Download HTML
            </button>
          </>
        }
      >
        Codebook Viewer
      </PageTitle>
      <section className="dm-viewer">
        {current ? <HtmlFrame ref={frame} html={current.html} title="Codebook" className="dm-viewer-frame" /> : <p className="dm-empty">{building ? 'Building codebook…' : 'Preparing…'}</p>}
      </section>
      <p className="dm-hint dm-viewer-hint">Save as PDF opens the print dialog: choose "Save as PDF" as the printer. All visuals print expanded.</p>
    </>
  );
}
