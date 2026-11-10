import { useEffect, useMemo, useRef, useState } from 'react';
import { isQuestion, itemLabel, stripHtml, surveyModels, type StudySpec } from '../../core';
import {
  CODEBOOK_FONTS,
  CODEBOOK_PRESETS,
  codebookItemKey,
  codebookTypeKey,
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
import { capturePreviewState, highlightOptions, restorePreviewState } from '../codebookPreview';
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
  { label: 'Table of Contents', key: 'toc' },
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
  { label: 'Executive Summary', key: 'executiveSummary' },
  { label: 'Study Schedule', key: 'studySchedule' },
  {
    label: 'Participation Plots',
    key: 'participationPlots',
    needsData: true,
    children: [
      { label: 'Enrollment over time', key: 'partEnrollment', needsData: true },
      { label: 'Surveys by day since first survey', key: 'partTimeline', needsData: true },
    ],
  },
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
      {
        label: 'Histograms',
        key: 'histograms',
        needsData: true,
        children: [
          { label: 'Summary statistics (N, mean, SD…)', key: 'histStats', needsData: true },
          { label: 'Histogram chart', key: 'histChart', needsData: true },
        ],
      },
      {
        label: 'Missingness Page',
        key: 'missingness',
        needsData: true,
        children: [
          { label: 'Answered / delivered', key: 'missAnswered', needsData: true },
          { label: 'Missing count', key: 'missMissing', needsData: true },
          { label: 'Participants delivered to', key: 'missParticipants', needsData: true },
          { label: 'Missingness ICC', key: 'missIcc', needsData: true },
          { label: 'Missing per participant table', key: 'missPerPerson', needsData: true },
          { label: 'ICC explanation note', key: 'missNote', needsData: true },
        ],
      },
      {
        label: 'Outlier Plots',
        key: 'outlierPlots',
        needsData: true,
        children: [
          { label: 'Outlier summary', key: 'outlierSummary', needsData: true },
          { label: 'Box plot', key: 'outlierPlot', needsData: true },
        ],
      },
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
  const [panel, setPanel] = useState<'look' | 'content' | 'variables' | 'details'>('look');
  const [controlsOpen, setControlsOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const hasData = useMemo(() => (spec ? hasResponseData(spec) : false), [spec]);
  const { building, error } = useCodebook(spec, settings, codebook, onBuilt);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const [hoverNote, setHoverNote] = useState<string | null>(null);
  // Rebuilds keep what was open in the preview, unless "show visuals expanded" itself was switched.
  const preserve = useMemo(
    () => ({ capture: capturePreviewState, restore: restorePreviewState, key: String(settings.theme.expandVisuals) }),
    [settings.theme.expandVisuals],
  );

  if (!spec) return (<><PageTitle>Codebook Generator</PageTitle><NoStudy go={go} what="a codebook" /></>);
  const { options: opts, theme, text } = settings;
  const setOpts = (o: CodebookOptions) => setSettings({ ...settings, options: o });
  const setTheme = (t: Partial<CodebookTheme>) => setSettings({ ...settings, theme: { ...theme, ...t } });
  const setText = (k: keyof CodebookText) => (e: { target: { value: string } }) => setSettings({ ...settings, text: { ...text, [k]: e.target.value } });
  const preset = Object.entries(CODEBOOK_PRESETS).find(([, p]) => (Object.keys(p.theme) as Array<keyof CodebookTheme>).every((k) => k === 'headingFont' || p.theme[k] === theme[k]))?.[0];

  // A section with parts (e.g. Missingness Page) has its own switch; it's on when the switch is on and any part is.
  const isOn = (n: TreeNode): boolean =>
    n.key ? (opts[n.key] as boolean) && (!n.children || n.children.some(isOn)) : n.type ? opts.dataTypes.includes(n.type) : (n.children ?? []).every(isOn);
  const setNode = (n: TreeNode, on: boolean, o: CodebookOptions): CodebookOptions => {
    const kids = (acc: CodebookOptions) => (n.children ?? []).reduce((a, c) => setNode(c, on, a), acc);
    if (n.key) return n.children ? kids({ ...o, [n.key]: on }) : { ...o, [n.key]: on };
    if (n.type) return { ...o, dataTypes: on ? [...new Set([...o.dataTypes, n.type])] : o.dataTypes.filter((t) => t !== n.type) };
    return kids(o);
  };
  /** Switching a part on also switches on the section it belongs to. */
  const setChild = (parent: TreeNode | null, n: TreeNode, on: boolean) => {
    let o = setNode(n, on, opts);
    if (on && parent?.key) o = { ...o, [parent.key]: true };
    setOpts(o);
  };
  // Hovering an option highlights what it controls in the live preview.
  const keysOf = (n: TreeNode): string[] => [...(n.key ? [n.key] : []), ...(n.type ? [codebookTypeKey(n.type)] : []), ...(n.children ?? []).flatMap(keysOf)];
  const hover = (n: TreeNode | null) => {
    const doc = previewRef.current?.contentDocument;
    if (!doc?.body) return;
    const { total, visible } = highlightOptions(doc, n ? keysOf(n) : []);
    if (!n) return setHoverNote(null);
    if (!isOn(n)) setHoverNote(`${n.label} is off: tick it to add it to the codebook.`);
    else if (!total) setHoverNote(`${n.label}: nothing in this study uses it.`);
    else if (!visible) setHoverNote(`${n.label} is highlighted, but not on screen: it may be folded away or further down.`);
    else setHoverNote(null);
  };
  const renderNode = (n: TreeNode, parent: TreeNode | null = null) => {
    const disabled = n.needsData && !hasData;
    const on = isOn(n);
    const anyChildOn = (n.children ?? []).some(isOn);
    const partial = n.children ? (on ? !n.children.every(isOn) : !n.key && anyChildOn) : false;
    return (
      <li key={n.label}>
        <label className={`dm-tree-item ${disabled ? 'is-disabled' : ''}`} onMouseEnter={() => hover(n)} onMouseLeave={() => hover(null)}>
          <input
            type="checkbox"
            checked={on && !disabled}
            disabled={disabled}
            ref={(el) => {
              if (el) el.indeterminate = partial;
            }}
            onChange={(e) => setChild(parent, n, e.target.checked)}
          />
          <span>{n.label}</span>
          {disabled && <span className="dm-hint">(needs response data)</span>}
        </label>
        {n.children && <ul>{n.children.map((c) => renderNode(c, n))}</ul>}
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
                ['variables', 'Variables'],
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
                <Field label="Font">
                  <select className="dm-input" value={theme.bodyFont} onChange={(e) => setTheme({ bodyFont: e.target.value as CodebookFont, headingFont: e.target.value as CodebookFont })}>
                    {(['System', 'Web'] as const).map((g) => (
                      <optgroup key={g} label={g === 'System' ? 'System fonts (work offline)' : 'Web fonts (load online)'}>
                        {Object.entries(CODEBOOK_FONTS)
                          .filter(([, f]) => f.group === g)
                          .map(([k, f]) => (
                            <option key={k} value={k}>
                              {f.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label={`Text size: ${theme.fontSize}px`}>
                  <input className="dm-range" type="range" min={13} max={22} value={theme.fontSize} onChange={(e) => setTheme({ fontSize: Number(e.target.value) })} />
                </Field>
                <Field label="Charts">
                  <select className="dm-input" value={theme.charts} onChange={(e) => setTheme({ charts: e.target.value as CodebookTheme['charts'] })}>
                    <option value="accent">Accent color</option>
                    <option value="ggplot">ggplot grey</option>
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
              <ul className="dm-tree">{TREE.map((n) => renderNode(n))}</ul>
            </Box>
          )}

          {panel === 'variables' && (
            <VariablePicker
              spec={spec}
              exclude={settings.exclude}
              setExclude={(exclude) => setSettings({ ...settings, exclude })}
              onHover={(keys) => {
                const doc = previewRef.current?.contentDocument;
                if (doc?.body) highlightOptions(doc, keys);
              }}
            />
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
            <span className="dm-hint">{error ? `Error: ${error}` : hoverNote ?? (building ? 'Updating…' : 'Up to date')}</span>
          </div>
          {previewOpen &&
            (codebook && codebook.spec === spec ? <HtmlFrame ref={previewRef} html={codebook.html} title="Codebook preview" className="dm-preview-frame" preserve={preserve} /> : <p className="dm-empty">Building preview…</p>)}
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
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

export function CodebookViewerPage({ spec, settings, codebook, onBuilt, go, notify }: ViewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [exporting, setExporting] = useState(false);
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
            <button
              className="dm-btn dm-btn-secondary"
              disabled={!current || exporting}
              onClick={async () => {
                if (!current) return;
                setExporting(true);
                try {
                  const { codebookDocx } = await import('../codebookDocx');
                  const title = settings.text.title || spec['Study.Metadata']['Study.Name'];
                  download(fileName.replace(/\.html$/, '.docx'), await codebookDocx(current.html, current.settings.theme, title));
                } catch (e) {
                  notify(`Word export failed: ${(e as Error).message}`, 'error');
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Icon name="file" /> {exporting ? 'Making Word file…' : 'Download Word'}
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

/** Choose which variables go in the codebook: every survey's questions, with search and select all/none. */
function VariablePicker({ spec, exclude, setExclude, onHover }: { spec: StudySpec; exclude: string[]; setExclude(x: string[]): void; onHover(keys: string[]): void }) {
  const [query, setQuery] = useState('');
  const surveys = useMemo(
    () =>
      surveyModels(spec).map((m) => ({
        name: m.name,
        label: m.label,
        items: m.items.filter(isQuestion).map((q) => ({
          key: codebookItemKey(m.name, q['Item.ID']),
          id: q['Question.ID'] || q['Item.ID'],
          text: stripHtml(q['Question.Text'] ?? '') || itemLabel(q),
        })),
      })),
    [spec],
  );
  const out = useMemo(() => new Set(exclude), [exclude]);
  const q = query.trim().toLowerCase();
  const shown = surveys
    .map((s) => ({ ...s, items: q ? s.items.filter((i) => i.id.toLowerCase().includes(q) || i.text.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)) : s.items }))
    .filter((s) => s.items.length);
  const all = surveys.flatMap((s) => s.items);
  const keptCount = all.filter((i) => !out.has(i.key)).length;
  const setMany = (keys: string[], on: boolean) => {
    const next = new Set(out);
    keys.forEach((k) => (on ? next.delete(k) : next.add(k)));
    setExclude([...next]);
  };
  const hl = (keys: string[]) => onHover(keys.map((k) => `item:${encodeURIComponent(k)}`));
  const shownKeys = shown.flatMap((s) => s.items.map((i) => i.key));

  return (
    <Box title="Variables">
      <p className="dm-hint">
        {keptCount.toLocaleString()} of {all.length.toLocaleString()} variables included. Unticked variables are left out of the codebook; a survey with none left is left out too.
      </p>
      <input className="dm-input dm-search" type="search" placeholder="Search variable names or question text…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="dm-var-actions">
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setMany(shownKeys, true)}>
          {q ? 'Include matches' : 'Include all'}
        </button>
        <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => setMany(shownKeys, false)}>
          {q ? 'Leave out matches' : 'Leave out all'}
        </button>
      </div>
      {!shown.length && <p className="dm-empty">No variables match.</p>}
      <ul className="dm-tree dm-var-list">
        {shown.map((s) => {
          const keys = s.items.map((i) => i.key);
          const on = keys.filter((k) => !out.has(k)).length;
          return (
            <li key={s.name}>
              <details open={!!q || surveys.length === 1}>
                <summary>
                  <label className="dm-tree-item" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={on === keys.length}
                      ref={(el) => {
                        if (el) el.indeterminate = on > 0 && on < keys.length;
                      }}
                      onChange={(e) => setMany(keys, e.target.checked)}
                    />
                    <span>{s.label}</span>
                    <span className="dm-hint">
                      ({on}/{keys.length})
                    </span>
                  </label>
                </summary>
                <ul>
                  {s.items.map((i) => (
                    <li key={i.key}>
                      <label className="dm-tree-item dm-var-item" title={i.text} onMouseEnter={() => hl([i.key])} onMouseLeave={() => hl([])}>
                        <input type="checkbox" checked={!out.has(i.key)} onChange={(e) => setMany([i.key], e.target.checked)} />
                        <code>{i.id}</code>
                        <span className="dm-var-text">{i.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </Box>
  );
}
