import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveEditOptions } from '../useLiveDraft';
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
import { capturePreviewState, highlightOptions, restorePreviewState, revealItem } from '../codebookPreview';
import { Box, Field, Icon, PageTitle } from '../ui';
import { download, safeFileName } from '../util';
import { NoStudy } from './common';
import { CodebookMedia } from './CodebookMedia';
import { ConfirmDialog, DeleteDialog, Modal, QuestionDialog } from '../StudyEditDialogs';

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
  { label: 'Logo', key: 'logo' },
  { label: 'Table of Contents', key: 'toc' },
  {
    label: 'Title Page',
    children: [
      { label: 'Name of Study', key: 'nameOfStudy' },
      { label: 'Authors', key: 'authors' },
      { label: 'Study Metadata', key: 'studyMetadata' },
    ],
  },
  { label: 'Abstract', key: 'abstract' },
  { label: 'Executive Summary', key: 'executiveSummary' },
  { label: 'Funding', key: 'funding' },
  { label: 'Contact', key: 'contact' },
  { label: 'Your sections', key: 'customSections' },
  { label: 'Study Schedule', key: 'studySchedule' },
  {
    label: 'Study Adherence',
    key: 'participationPlots',
    needsData: true,
    children: [
      { label: 'Enrollment over time', key: 'partEnrollment', needsData: true },
      { label: 'Surveys by day since first survey', key: 'partTimeline', needsData: true },
      { label: 'Surveys by day of each burst', key: 'partBurstDensity', needsData: true },
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
  /** Save a change to the study (here: the Study details written into its metadata). */
  onSpecEdit?(spec: StudySpec, label?: string, opts?: LiveEditOptions): string | null;
  /** A variable to scroll to once the codebook is showing (codebookItemKey), e.g. from the flowchart. */
  focus?: string | null;
  onFocused?(): void;
  spec: StudySpec | null;
  settings: CodebookSettings;
  setSettings(s: CodebookSettings): void;
  codebook: GeneratedCodebook | null;
  onBuilt(c: GeneratedCodebook): void;
  go(id: PageId): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

/** The codebook: options on the left (folded away at first), the live codebook on the right, and its downloads. */
export function CodebookGeneratorPage({ spec, settings, setSettings, codebook, onBuilt, go, notify, focus, onFocused, onSpecEdit }: GenProps) {
  const [panel, setPanel] = useState<'look' | 'content' | 'variables' | 'media' | 'details'>('look');
  // Options start folded away so the preview gets the room; the rail on the left opens them.
  const [controlsOpen, setControlsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const hasData = useMemo(() => (spec ? hasResponseData(spec) : false), [spec]);
  const { building, error } = useCodebook(spec, settings, codebook, onBuilt);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const [hoverNote, setHoverNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Editing the study from the codebook: off until confirmed, since it changes the study itself.
  const [editOn, setEditOn] = useState(false);
  const [askUnlock, setAskUnlock] = useState(false);
  const [editing, setEditing] = useState<{ survey: string; item: string } | null>(null);
  const [deleting, setDeleting] = useState<{ survey: string; item: string } | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const actRef = useRef<(act: string, key: string) => void>(() => {});
  actRef.current = (act, key) => {
    if (act === 'details') return setDetails(key);
    const cut = key.indexOf('/');
    const target = { survey: key.slice(0, cut), item: key.slice(cut + 1) };
    if (act === 'edit') setEditing(target);
    else setDeleting(target);
  };
  useEffect(() => {
    const doc = previewRef.current?.contentDocument;
    if (doc?.body) injectEditControls(doc, editOn, actRef);
  }, [editOn, codebook]);
  // Rebuilds keep what was open in the preview, unless "show visuals expanded" itself was switched.
  const preserve = useMemo(
    () => ({ capture: capturePreviewState, restore: restorePreviewState, key: String(settings.theme.expandVisuals) }),
    [settings.theme.expandVisuals],
  );

  if (!spec) return (<><PageTitle>Codebook</PageTitle><NoStudy go={go} what="a codebook" /></>);
  const current = codebook && codebook.spec === spec ? codebook : null;
  const fileName = `${safeFileName(settings.text.title || spec['Study.Metadata']['Study.Name'])}_Codebook.html`;
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
          <>
            <button className="dm-btn dm-btn-secondary" disabled={!current} onClick={() => previewRef.current?.contentWindow?.print()} title="Opens the print dialog: choose “Save as PDF” as the printer. All visuals print expanded.">
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
        Codebook
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
                ['media', 'Media'],
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
                {colorField('Behind the page', 'background')}
                {colorField('Page', 'surface')}
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

          {panel === 'media' && <CodebookMedia spec={spec} extras={settings.extras} setExtras={(extras) => setSettings({ ...settings, extras })} notify={notify} />}

          {panel === 'details' && (
            <Box title="Study Metadata">
              <p className="dm-hint">What you type here is saved in this browser for this study, so it’s still here next time you load it.</p>
              <Field label="Title">
                <input className="dm-input" value={text.title} onChange={setText('title')} placeholder="Enter title" />
              </Field>
              <Field label="Authors">
                <input className="dm-input" value={text.authors} onChange={setText('authors')} placeholder="Enter authors" />
              </Field>
              <Field label="Funding">
                <textarea className="dm-input" rows={3} value={text.funding} onChange={setText('funding')} placeholder="Enter funding information" />
              </Field>
              <Field label="Contact" hint="Who to contact about the study or the data: names, emails, a lab website.">
                <textarea className="dm-input" rows={3} value={text.contact ?? ''} onChange={setText('contact')} placeholder="e.g. Jane Smith, jane@university.edu" />
              </Field>
              <Field label="Abstract">
                <textarea className="dm-input" rows={4} value={text.abstract} onChange={setText('abstract')} placeholder="Enter abstract" />
              </Field>
              <Field label="Summary" hint="Leave blank for an automatic summary of surveys and variables.">
                <textarea className="dm-input" rows={4} value={text.summary} onChange={setText('summary')} placeholder="Enter summary" />
              </Field>
              {onSpecEdit && (
                <>
                  <button
                    className="dm-btn dm-btn-secondary dm-btn-sm"
                    onClick={() => {
                      const md = { ...spec['Study.Metadata'] } as Record<string, unknown>;
                      const put = (k: string, v: string | undefined) => {
                        if (v?.trim()) md[k] = v.trim();
                      };
                      put('authors', text.authors);
                      put('funding', text.funding);
                      put('abstract', text.abstract);
                      const access = md['Data.Access'] as Record<string, unknown> | undefined;
                      if (text.contact?.trim() && access) md['Data.Access'] = { ...access, Contact: text.contact.trim() };
                      onSpecEdit({ ...spec, 'Study.Metadata': md as StudySpec['Study.Metadata'] });
                      notify('Saved the authors, funding and abstract into the study. Export it from Data Export to keep them with the study file.');
                    }}
                  >
                    Save into the study file
                  </button>
                  <p className="dm-hint">Writes the authors, funding and abstract into the study itself, so they go wherever the study file goes.</p>
                </>
              )}
            </Box>
          )}
        </div>

        <section className={`dm-gen-preview ${previewOpen ? '' : 'is-collapsed'}`}>
          <div className="dm-preview-bar">
            <button className="dm-preview-toggle" onClick={() => setPreviewOpen((o) => !o)} aria-expanded={previewOpen}>
              <span className="dm-caret">{previewOpen ? '▾' : '▸'}</span> Codebook
            </button>
            <span className="dm-hint">{error ? `Error: ${error}` : hoverNote ?? (building ? 'Updating…' : 'Up to date')}</span>
            {onSpecEdit && (
              <button
                className={`dm-btn dm-btn-sm dm-edit-toggle ${editOn ? 'is-on' : ''}`}
                aria-pressed={editOn}
                onClick={() => (editOn ? setEditOn(false) : setAskUnlock(true))}
                title={editOn ? 'Stop editing the study from the codebook' : 'Edit or delete questions right here in the codebook'}
              >
                {editOn ? '✎ Editing: done' : '✎ Edit'}
              </button>
            )}
          </div>
          {previewOpen &&
            (codebook && codebook.spec === spec ? <HtmlFrame
                ref={previewRef}
                html={codebook.html}
                title="Codebook"
                className="dm-preview-frame"
                preserve={preserve}
                onDocLoad={(doc) => {
                  injectEditControls(doc, editOn, actRef);
                  if (!focus) return;
                  if (!revealItem(doc, focus)) notify('That question isn’t in the codebook: it’s left out in the Variables or Content options.', 'warning', 8000);
                  onFocused?.();
                }}
              /> : <p className="dm-empty">Building preview…</p>)}
        </section>
      </div>
      {askUnlock && (
        <ConfirmDialog
          title="Edit the study from the codebook?"
          confirm="I understand, turn on editing"
          onClose={() => setAskUnlock(false)}
          onConfirm={() => {
            setEditOn(true);
            setAskUnlock(false);
          }}
        >
          <p>
            <strong>Be careful changing what the codebook describes</strong>, such as question text, response options or skip logic. A codebook documents the study <em>as it was
            actually run</em>. If the wording here no longer matches what participants saw, the codebook misdescribes the data.
          </p>
          <p>Edits change the study itself, so they also carry into the data dictionary, flowcharts, schedule and the exported study file.</p>
          <p className="dm-hint">Each question gets Edit and Delete buttons. Every change can be undone (Ctrl+Z or Undo at the top).</p>
        </ConfirmDialog>
      )}
      {editing && (
        <QuestionDialog
          spec={spec}
          surveyName={editing.survey}
          itemId={editing.item}
          onClose={() => setEditing(null)}
          onCommit={(next, label, opts) => onSpecEdit?.(next, label, opts) ?? null}
          onDelete={() => (setDeleting(editing), setEditing(null))}
        />
      )}
      {deleting && (
        <DeleteDialog
          spec={spec}
          surveyName={deleting.survey}
          itemIds={[deleting.item]}
          codebook
          onClose={() => setDeleting(null)}
          onLeaveOut={() => {
            const key = codebookItemKey(deleting.survey, deleting.item);
            setSettings({ ...settings, exclude: [...new Set([...settings.exclude, key])] });
            notify('Left out of this codebook. Bring it back on the Variables tab.');
          }}
          onDelete={(next, label) => {
            onSpecEdit?.(next, label);
            setDeleting(null);
          }}
        />
      )}
      {details && (
        <StudyDetailsDialog
          spec={spec}
          text={text}
          focus={details}
          onClose={() => setDetails(null)}
          onSave={(nextText, nextSpec) => {
            setSettings({ ...settings, text: nextText });
            if (nextSpec) onSpecEdit?.(nextSpec, 'Edited the study details');
            setDetails(null);
          }}
        />
      )}
    </>
  );
}

const EDIT_STYLE = `.dm-cb-edit{display:inline-flex;gap:6px;margin-left:10px;vertical-align:middle;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.dm-cb-edit button{font:600 12px system-ui,-apple-system,Segoe UI,sans-serif;border:1px solid var(--cb-accent);background:var(--cb-surface);color:var(--cb-accent);border-radius:5px;padding:2px 9px;cursor:pointer}
.dm-cb-edit button[data-dm-act="delete"]{border-color:#dc2626;color:#dc2626}
.dm-cb-edit button:hover{background:var(--cb-accent);color:var(--cb-surface)}
.dm-cb-edit button[data-dm-act="delete"]:hover{background:#dc2626;color:#fff}
@media print{.dm-cb-edit{display:none}}`;

/**
 * Edit and Delete buttons on each question of the live codebook (the app's view only; downloads never
 * have them). Clicks go to `act` with the question's codebook key.
 */
function injectEditControls(doc: Document, on: boolean, act: { current: (act: string, key: string) => void }) {
  doc.querySelectorAll('.dm-cb-edit').forEach((el) => el.remove());
  if (!doc.getElementById('dm-cb-edit-style')) {
    const st = doc.createElement('style');
    st.id = 'dm-cb-edit-style';
    st.textContent = EDIT_STYLE;
    doc.head.appendChild(st);
  }
  const marked = doc as Document & { __dmEdit?: boolean };
  if (!marked.__dmEdit) {
    marked.__dmEdit = true;
    // Capture phase, so the click doesn't also open or close the question.
    doc.addEventListener(
      'click',
      (e) => {
        const b = (e.target as Element | null)?.closest?.('[data-dm-act]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        act.current(b.getAttribute('data-dm-act')!, b.getAttribute('data-key')!);
      },
      true,
    );
  }
  if (!on) return;
  const detailsButton = (field: string, label = 'Edit') => {
    const box = doc.createElement('span');
    box.className = 'dm-cb-edit';
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('data-dm-act', 'details');
    b.setAttribute('data-key', field);
    box.appendChild(b);
    return box;
  };
  doc.querySelector('#header .title')?.appendChild(detailsButton('title', 'Edit study details'));
  for (const [opt, field] of [
    ['nameOfStudy', 'authors'],
    ['abstract', 'abstract'],
    ['executiveSummary', 'summary'],
    ['funding', 'funding'],
    ['contact', 'contact'],
  ] as const) {
    const h = doc.querySelector(`section.cb-page[data-cb-opt~="${opt}"] > h1`);
    if (h) h.insertBefore(detailsButton(field), h.querySelector('.cb-sec-toggle'));
  }
  doc.querySelectorAll('.cb-var[data-cb-opt]').forEach((v) => {
    const token = (v.getAttribute('data-cb-opt') ?? '').split(' ').find((t) => t.startsWith('item:'));
    const head = v.querySelector('.header-shading h4');
    if (!token || !head) return;
    const key = decodeURIComponent(token.slice(5));
    const box = doc.createElement('span');
    box.className = 'dm-cb-edit';
    for (const [a, label] of [
      ['edit', 'Edit'],
      ['delete', 'Delete'],
    ]) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label!;
      b.setAttribute('data-dm-act', a!);
      b.setAttribute('data-key', key);
      box.appendChild(b);
    }
    head.querySelector('.cb-q-sub')?.appendChild(box);
  });
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

const DETAIL_FIELDS: Array<{ key: keyof CodebookText; label: string; rows: number; hint?: string }> = [
  { key: 'title', label: 'Title', rows: 1 },
  { key: 'authors', label: 'Authors', rows: 1 },
  { key: 'abstract', label: 'Abstract', rows: 5 },
  { key: 'summary', label: 'Executive summary', rows: 4, hint: 'Leave blank for the automatic summary of surveys and variables.' },
  { key: 'funding', label: 'Funding', rows: 3 },
  { key: 'contact', label: 'Contact', rows: 3 },
];

/** The codebook's study details, edited from the codebook itself; optionally saved into the study too. */
function StudyDetailsDialog({ spec, text, focus, onSave, onClose }: { spec: StudySpec; text: CodebookText; focus: string; onSave(text: CodebookText, spec: StudySpec | null): void; onClose(): void }) {
  const [draft, setDraft] = useState<CodebookText>(text);
  const [intoStudy, setIntoStudy] = useState(true);
  return (
    <Modal title="Study details" onClose={onClose} wide>
      {DETAIL_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          {f.rows > 1 ? (
            <textarea className="dm-input" rows={f.rows} autoFocus={f.key === focus} value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          ) : (
            <input className="dm-input" autoFocus={f.key === focus} value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          )}
        </Field>
      ))}
      <label className="dm-check">
        <input type="checkbox" checked={intoStudy} onChange={(e) => setIntoStudy(e.target.checked)} /> Also save the authors, abstract, funding and contact into the study file
      </label>
      <div className="dm-modal-foot">
        <button className="dm-btn dm-btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="dm-btn dm-btn-primary"
          onClick={() => {
            let next: StudySpec | null = null;
            if (intoStudy) {
              const md = { ...spec['Study.Metadata'] } as Record<string, unknown>;
              for (const k of ['authors', 'funding', 'abstract'] as const) {
                const v = draft[k]?.trim();
                if (v) md[k] = v;
                else delete md[k];
              }
              const access = md['Data.Access'] as Record<string, unknown> | undefined;
              if (access && draft.contact !== undefined) md['Data.Access'] = { ...access, Contact: draft.contact.trim() };
              if (JSON.stringify(md) !== JSON.stringify(spec['Study.Metadata'])) next = { ...spec, 'Study.Metadata': md as StudySpec['Study.Metadata'] };
            }
            onSave(draft, next);
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
