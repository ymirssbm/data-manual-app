// Spec -> self-contained codebook HTML, laid out like the prior R Markdown
// codebook: title block, table of contents, then <hr>-ruled pages (Title Page,
// Abstract, Executive Summary, Variable List) and, per survey, a shaded
// header per variable with indented field lines and a "Click to view visuals"
// panel (Frequency Table / Barplot / Missingness / Screenshots tabs).
// Additions: a sticky "Sections" menu, a collapsible TOC (every node folds),
// collapsible pages/surveys/blocks, and colour/font themes. One file with
// inline CSS + a little inline JS; prints to PDF with everything expanded.
import {
  blockNotes,
  blockPath,
  flowKnown,
  isBlock,
  isEndBlock,
  isQuestion,
  itemLabel,
  responseOptions,
  stripHtml,
  surveyModels,
  type Question,
  type StudySpec,
  type SurveyModel,
} from '../core';
import { buildStudySchedule, dayIndex } from './schedule';
import { generateStudyMap, studyBursts } from './studyMap';
import { flowchartBlocks, flowchartContext, generateFlowchart } from './flowchart';
import { dataOverview, describeItem, enrollment, hasResponseData, indexResponses, surveyTimeline, type EnrollmentPoint, type ItemDescriptives, type SurveyTimeline } from './descriptives';

export const QUESTION_TYPES = [
  'Free Response',
  'Informational Fullscreen',
  'Multiple Choice',
  'Multiple Select',
  'Multiple Slider',
  'Slider',
  'Time Picker',
  'Time Scale Slider',
  'Block',
] as const;

export interface CodebookOptions {
  /** The table of contents after the title. */
  toc: boolean;
  /** The study logo above the title (when one was added). */
  logo: boolean;
  /** Sections the researcher wrote (text, images, video). */
  customSections: boolean;
  /** Attached documents (IRB protocol, consent form...) at the end. */
  attachments: boolean;

  nameOfStudy: boolean;
  authors: boolean;
  studyMetadata: boolean;
  funding: boolean;
  /** Contact section (who to ask about the study or data). */
  contact: boolean;
  abstract: boolean;
  executiveSummary: boolean;
  studySchedule: boolean;
  /** Enrollment over time and surveys by day since first survey (needs response data). */
  participationPlots: boolean;
  /** Parts of the participation page. */
  partEnrollment: boolean;
  partTimeline: boolean;
  /** Overlapping survey density for each burst, by day within the burst. */
  partBurstDensity: boolean;
  flowcharts: boolean;
  /** Question types to include on variable pages ("Block" controls block headings). */
  dataTypes: string[];
  deliveryType: boolean;
  typeOfData: boolean;
  responseOptions: boolean;
  skipLogic: boolean;
  frequencyTable: boolean;
  barPlot: boolean;
  histograms: boolean;
  /** Parts of the histogram tab. */
  histStats: boolean;
  histChart: boolean;
  missingness: boolean;
  /** Parts of the missingness tab, each on its own. */
  missAnswered: boolean;
  missMissing: boolean;
  missParticipants: boolean;
  missIcc: boolean;
  missPerPerson: boolean;
  missNote: boolean;
  /** Outlier screen (box plot + flagged values) for numeric items. */
  outlierPlots: boolean;
  /** Parts of the outlier tab. */
  outlierSummary: boolean;
  outlierPlot: boolean;
  screenshots: boolean;
}

export const DEFAULT_CODEBOOK_OPTIONS: CodebookOptions = {
  toc: true,
  logo: true,
  customSections: true,
  attachments: true,
  // Title page off by default; switch it on in the generator's Content tab.
  nameOfStudy: true,
  authors: true,
  studyMetadata: false,
  funding: true,
  contact: true,
  abstract: true,
  executiveSummary: true,
  studySchedule: true,
  participationPlots: true,
  partEnrollment: true,
  partTimeline: true,
  partBurstDensity: true,
  flowcharts: true,
  dataTypes: [...QUESTION_TYPES],
  deliveryType: true,
  typeOfData: true,
  responseOptions: true,
  skipLogic: true,
  frequencyTable: true,
  barPlot: true,
  histograms: true,
  histStats: true,
  histChart: true,
  missingness: true,
  missAnswered: true,
  missMissing: true,
  missParticipants: true,
  missIcc: true,
  missPerPerson: true,
  missNote: true,
  outlierPlots: true,
  outlierSummary: true,
  outlierPlot: true,
  screenshots: true,
};

// ---------------------------------------------------------------- themes (colours and fonts only; layout is fixed)

/**
 * Fonts. "System" fonts ship with Windows/macOS and work offline; "Web" fonts load from Google Fonts
 * when the codebook is opened online, and fall back to a similar system font otherwise.
 */
export type CodebookFont = string;
export interface CodebookFontDef {
  label: string;
  stack: string;
  group: 'System' | 'Web';
  /** Google Fonts family spec (css2 `family=` value), for web fonts. */
  google?: string;
}
export const CODEBOOK_FONTS: Record<string, CodebookFontDef> = {
  times: { label: 'Times New Roman', group: 'System', stack: "'Times New Roman', Times, serif" },
  georgia: { label: 'Georgia', group: 'System', stack: "Georgia, 'Times New Roman', serif" },
  serif: { label: 'Book serif (Charter)', group: 'System', stack: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif" },
  cambria: { label: 'Cambria', group: 'System', stack: "Cambria, Georgia, serif" },
  palatino: { label: 'Palatino', group: 'System', stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  garamond: { label: 'Garamond', group: 'System', stack: "Garamond, 'EB Garamond', 'Times New Roman', serif" },
  sans: { label: 'Modern sans (system UI)', group: 'System', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  arial: { label: 'Arial / Helvetica', group: 'System', stack: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  calibri: { label: 'Calibri', group: 'System', stack: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" },
  verdana: { label: 'Verdana', group: 'System', stack: "Verdana, Geneva, Tahoma, sans-serif" },
  trebuchet: { label: 'Trebuchet MS', group: 'System', stack: "'Trebuchet MS', 'Lucida Grande', Arial, sans-serif" },
  mono: { label: 'Monospace', group: 'System', stack: "ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace" },
  inter: { label: 'Inter', group: 'Web', google: 'Inter:wght@400;600;700', stack: "Inter, 'Segoe UI', Arial, sans-serif" },
  lato: { label: 'Lato', group: 'Web', google: 'Lato:wght@400;700', stack: "Lato, 'Segoe UI', Arial, sans-serif" },
  opensans: { label: 'Open Sans', group: 'Web', google: 'Open+Sans:wght@400;600;700', stack: "'Open Sans', 'Segoe UI', Arial, sans-serif" },
  sourcesans: { label: 'Source Sans 3', group: 'Web', google: 'Source+Sans+3:wght@400;600;700', stack: "'Source Sans 3', 'Segoe UI', Arial, sans-serif" },
  ibmplex: { label: 'IBM Plex Sans', group: 'Web', google: 'IBM+Plex+Sans:wght@400;600;700', stack: "'IBM Plex Sans', 'Segoe UI', Arial, sans-serif" },
  merriweather: { label: 'Merriweather', group: 'Web', google: 'Merriweather:wght@400;700', stack: "Merriweather, Georgia, serif" },
  lora: { label: 'Lora', group: 'Web', google: 'Lora:wght@400;600;700', stack: "Lora, Georgia, serif" },
  sourceserif: { label: 'Source Serif 4', group: 'Web', google: 'Source+Serif+4:wght@400;600;700', stack: "'Source Serif 4', Georgia, serif" },
  ebgaramond: { label: 'EB Garamond', group: 'Web', google: 'EB+Garamond:wght@400;600;700', stack: "'EB Garamond', Garamond, Georgia, serif" },
  crimson: { label: 'Crimson Pro', group: 'Web', google: 'Crimson+Pro:wght@400;600;700', stack: "'Crimson Pro', Georgia, serif" },
  robotoslab: { label: 'Roboto Slab', group: 'Web', google: 'Roboto+Slab:wght@400;600;700', stack: "'Roboto Slab', Rockwell, Georgia, serif" },
  jetbrains: { label: 'JetBrains Mono', group: 'Web', google: 'JetBrains+Mono:wght@400;700', stack: "'JetBrains Mono', Consolas, monospace" },
};

/** <link> tags for any web fonts the theme uses (nothing for system fonts). */
function fontLinks(t: CodebookTheme): string {
  const fams = [...new Set([t.bodyFont].map((f) => CODEBOOK_FONTS[f]?.google).filter((g): g is string => !!g))];
  if (!fams.length) return '';
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join('&amp;')}&amp;display=swap">`;
}

export interface CodebookTheme {
  /** Links, item IDs, tabs, toggles, chart bars. */
  accent: string;
  /** Page background around the content box. */
  background: string;
  /** The content box. */
  surface: string;
  /** Shading behind each variable's header. */
  headerBg: string;
  text: string;
  bodyFont: CodebookFont;
  /** Unused: one font (bodyFont) covers the whole codebook. Kept so older saved settings still read. */
  headingFont: CodebookFont;
  /** Base font size in px. */
  fontSize: number;
  /** Chart look: ggplot2's grey panel, or bars in the accent colour. */
  charts: 'ggplot' | 'accent';
  /** Start with every "view visuals" panel open. */
  expandVisuals: boolean;
}

export const CODEBOOK_PRESETS: Record<string, { label: string; theme: CodebookTheme }> = {
  classic: {
    label: 'Classic',
    theme: { accent: '#2a5caa', background: '#003d7a', surface: '#ffffff', headerBg: '#f0f0f0', text: '#333333', bodyFont: 'times', headingFont: 'times', fontSize: 19, charts: 'accent', expandVisuals: false },
  },
  light: {
    label: 'Light',
    theme: { accent: '#2563eb', background: '#eef1f5', surface: '#ffffff', headerBg: '#f1f4f8', text: '#1f2937', bodyFont: 'sans', headingFont: 'sans', fontSize: 16, charts: 'accent', expandVisuals: false },
  },
  paper: {
    label: 'Paper',
    theme: { accent: '#b4532a', background: '#e9e1d3', surface: '#fffdf8', headerBg: '#f4ece0', text: '#2b2620', bodyFont: 'serif', headingFont: 'serif', fontSize: 17, charts: 'accent', expandVisuals: false },
  },
  forest: {
    label: 'Forest',
    theme: { accent: '#2f7d5b', background: '#1f3d31', surface: '#ffffff', headerBg: '#eef5f0', text: '#1d2a23', bodyFont: 'serif', headingFont: 'serif', fontSize: 17, charts: 'accent', expandVisuals: false },
  },
  slate: {
    label: 'Slate (dark)',
    theme: { accent: '#7aa2f7', background: '#0b1020', surface: '#131a2b', headerBg: '#1d2740', text: '#e3e8f2', bodyFont: 'sans', headingFont: 'sans', fontSize: 16, charts: 'accent', expandVisuals: false },
  },
};
export const DEFAULT_CODEBOOK_THEME: CodebookTheme = CODEBOOK_PRESETS.classic!.theme;

/** Text the user can set when generating (defaults come from the spec). */
export interface CodebookText {
  title?: string;
  authors?: string;
  funding?: string;
  contact?: string;
  abstract?: string;
  summary?: string;
}

export interface CodebookExtras {
  /** Pre-rendered flowchart SVG markup keyed by Survey.Name (rendering needs a DOM). */
  flowchartSvgs?: Record<string, string>;
  /** Pre-rendered study map(s): the whole study, then its bursts' surveys and links, with captions. */
  studyMapSvgs?: Array<{ caption: string; svg: string }>;
  /**
   * Interactive flowcharts (pan, zoom, minimap, folding blocks, zooming from the study into a
   * burst): every view pre-rendered, keyed by Survey.Name, plus STUDY_MAP_KEY for the study map.
   * Made from flowViewPlans(); without them the codebook shows plain pictures.
   */
  flowViews?: Record<string, RenderedFlowView[]>;
  /**
   * Without a DOM (the MCP server), embed each flowchart's Mermaid code and let the codebook draw it
   * when opened, with Mermaid loaded from a CDN. Needs internet when the codebook is viewed.
   */
  flowchartsInBrowser?: boolean;
  generatedAt?: Date;
  theme?: Partial<CodebookTheme>;
  /** Variables to leave out, as codebookItemKey(survey, item) keys. */
  excludeItems?: string[];
  /** Image src (data: URL or https) for the study logo. */
  logo?: string;
  /** The researcher's own sections, each placed after a built-in section (CODEBOOK_ANCHORS) or `section:<id>`. */
  customSections?: Array<{
    id: string;
    title: string;
    text: string;
    after: string;
    media: Array<{ kind: 'image' | 'video'; src: string; name: string; caption: string }>;
  }>;
  /** Documents carried inside the codebook; `href` is a data: URL. `text` is shown for text documents. */
  attachments?: Array<{ name: string; mediaType: string; size: number; href: string; text: string }>;
  /** Uploaded screenshots by codebookItemKey (data: URLs). */
  screenshots?: Record<string, string>;
  /** Screenshot keys that are made-up demonstrations (the example study's), captioned as such. */
  demoScreenshots?: string[];
}

/** The codebook's own sections, in order: what a researcher's section can be placed after. */
export const CODEBOOK_ANCHORS: Array<{ key: string; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'titlePage', label: 'Title Page' },
  { key: 'abstract', label: 'Abstract' },
  { key: 'executiveSummary', label: 'Executive Summary' },
  { key: 'funding', label: 'Funding' },
  { key: 'contact', label: 'Contact' },
  { key: 'studySchedule', label: 'Study Schedule' },
  { key: 'studyAdherence', label: 'Study Adherence' },
  { key: 'variableList', label: 'Variable List' },
  { key: 'attachments', label: 'Attached Documents' },
];

/** Identifies one variable of one survey, for choosing which variables go in a codebook. */
export const codebookItemKey = (surveyName: string, itemId: string) => `${surveyName}/${itemId}`;

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';

const color = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback);

interface TocNode {
  id: string;
  label: string;
  level: number;
}

export function generateCodebookHtml(
  spec: StudySpec,
  options: Partial<CodebookOptions> = {},
  extras: CodebookExtras = {},
  text: CodebookText = {},
): string {
  const o = { ...DEFAULT_CODEBOOK_OPTIONS, ...options };
  const t: CodebookTheme = { ...DEFAULT_CODEBOOK_THEME, ...extras.theme };
  const meta = spec['Study.Metadata'];
  const title = text.title?.trim() || meta['Study.Name'];
  const authors = text.authors?.trim() || meta.authors || '';
  const funding = text.funding?.trim() || meta.funding || '';
  const contact = text.contact?.trim() || String((meta as { 'Data.Access'?: { Contact?: string } })['Data.Access']?.Contact ?? '');
  const abstract = text.abstract?.trim() || meta.abstract || '';
  const models = surveyModels(spec);
  const generated = (extras.generatedAt ?? new Date()).toISOString().slice(0, 10);

  const toc: TocNode[] = [];
  const used = new Set<string>();
  const newId = (base: string) => {
    let id = slug(base);
    for (let n = 2; used.has(id); n++) id = `${slug(base)}-${n}`;
    used.add(id);
    return id;
  };
  /** Registers a TOC entry and returns its id. `level` is the TOC depth. */
  const entry = (label: string, level: number, base = label) => {
    const id = newId(base);
    toc.push({ id, label, level });
    return id;
  };
  const caret = (label: string) => `<button class="cb-sec-toggle" type="button" aria-expanded="true" aria-label="Collapse ${esc(label)}" title="Collapse / expand">▲</button>`;
  /** A collapsible top-level page between rules, as in the prior codebook. */
  const page = (label: string, body: string, keys: string[] = []) => {
    const id = entry(label, 1);
    return `<section class="cb-page"${keys.length ? optAttr(...keys) : ''}><hr><h1 id="${id}">${esc(label)}${caret(label)}</h1><hr><div class="cb-sec-body">${body}</div></section>`;
  };
  const out: string[] = [];

  // Surveys that will appear in the Variable List (a survey whose variables were all left out is
  // dropped), so the executive summary only links to sections that exist.
  const shownTypes = new Set(o.dataTypes);
  const leftOut = new Set(extras.excludeItems ?? []);
  const shownSurveys = new Set(
    models
      .filter((m) => {
        const qs = (m.survey.questions ?? []).filter((q) => isQuestion(q) && !isBlock(q) && shownTypes.has(q['Question.Type.Display.Name']));
        return !qs.length || qs.some((q) => !leftOut.has(codebookItemKey(m.name, q['Item.ID'])));
      })
      .map((m) => m.name),
  );
  const surveyAnchor = (m: SurveyModel) => (shownSurveys.has(m.name) ? `survey-${slug(m.name)}` : null);

  // The researcher's own sections: each goes after the anchor it names, and others can follow it.
  const ownSections = o.customSections ? (extras.customSections ?? []).filter((s) => s.title.trim() || s.text.trim() || s.media.length) : [];
  const placed = new Set<string>();
  const emitSection = (s: (typeof ownSections)[number]) => {
    placed.add(s.id);
    out.push(page(s.title.trim() || 'Untitled section', `${s.text.trim() ? multiline(s.text) : ''}${s.media.map(mediaHtml).join('')}`, ['customSections']));
    custom(`section:${s.id}`);
  };
  function custom(anchor: string) {
    for (const s of ownSections) if (!placed.has(s.id) && s.after === anchor) emitSection(s);
  }
  custom('title');

  // ---- Title page (heading registered first so its subsections nest under it in the TOC)
  const overview = dataOverview(spec);
  const tocMark = toc.length;
  const titleId = entry('Title Page', 1);
  const titleParts: string[] = [];
  const h2 = (label: string) => `<h2 id="${entry(label, 2)}">${esc(label)}</h2>`;
  const part = (key: string, html: string) => `<div${optAttr(key)}>${html}</div>`;
  if (o.nameOfStudy) titleParts.push(part('nameOfStudy', `<p class="cb-study-name">${esc(meta['Study.Name'])}</p>`));
  if (o.authors && authors) titleParts.push(part('authors', `${h2('Authors')}<p>${esc(authors)}</p>`));
  if (o.studyMetadata) {
    const block = studyMetadataHtml(spec, overview);
    if (block) titleParts.push(part('studyMetadata', `${h2('Study Metadata')}${block}`));
  }
  if (titleParts.length) {
    out.push(`<section class="cb-page"${optAttr('nameOfStudy', 'authors', 'studyMetadata')}><hr><h1 id="${titleId}">Title Page${caret('Title Page')}</h1><hr><div class="cb-sec-body">${titleParts.join('\n')}</div></section>`);
  } else toc.splice(tocMark, 1);

  custom('titlePage');
  if (o.abstract && abstract) out.push(page('Abstract', `<p class="cb-prose">${esc(abstract)}</p>`, ['abstract']));
  custom('abstract');
  if (o.executiveSummary) {
    const summary = text.summary?.trim();
    out.push(page('Executive Summary', summary ? `<p class="cb-prose">${esc(summary)}</p>` : autoSummary(models, overview, surveyAnchor), ['executiveSummary']));
  }
  custom('executiveSummary');
  if (o.funding && funding) out.push(page('Funding', multiline(funding), ['funding']));
  custom('funding');
  if (o.contact && contact) out.push(page('Contact', multiline(contact), ['contact']));
  custom('contact');
  if (o.studySchedule && spec.schedules.length) out.push(page('Study Schedule', scheduleHtml(spec, models, o.flowcharts ? studyMapFigures(spec, extras) : ''), ['studySchedule']));
  custom('studySchedule');
  if (o.participationPlots && hasResponseData(spec)) {
    const enrolled = enrollment(spec);
    const tl = surveyTimeline(spec);
    const parts: string[] = [];
    if (o.partEnrollment && enrolled.length)
      parts.push(
        `<div${optAttr('partEnrollment')}><h4 class="cb-chart-h">Enrollment over time</h4>${enrollmentSvg(enrolled)}<p class="cb-small">Cumulative participants by the date of their first completed survey (${enrolled.length} participants, ${esc(enrolled[0]!.date)} to ${esc(enrolled[enrolled.length - 1]!.date)}). Each bar runs from a participant’s first to last completed survey${
          enrolled[0]!.compliance != null ? ', colored by compliance: the share of their delivered prompts they answered' : ''
        }.</p></div>`,
      );
    if (o.partTimeline && tl)
      parts.push(
        `<div${optAttr('partTimeline')}><h4 class="cb-chart-h">Surveys by day since first survey</h4>${timelineSvg(tl)}<p class="cb-small">Each row is a participant (in enrollment order) and each dot a completed survey. The shaded curve shows how many surveys were completed on each day.${
          tl.bursts > 1 ? ' Colors mark measurement bursts: a gap of more than a week starts a new burst.' : ''
        }</p></div>`,
      );
    if (o.partBurstDensity && tl && tl.bursts > 1)
      parts.push(
        `<div${optAttr('partBurstDensity')}><h4 class="cb-chart-h">Surveys by day of each burst</h4>${burstDensitySvg(tl)}<p class="cb-small">Completed surveys on each day since the start of a burst, one curve per burst, so the bursts can be compared directly. Hover over a burst in the legend to pick it out.</p></div>`,
      );
    if (parts.length) out.push(page('Study Adherence', parts.join(''), ['participationPlots', 'partEnrollment', 'partTimeline', 'partBurstDensity']));
  }

  custom('studyAdherence');

  // ---- Variable list: survey > block > variable, each level collapsible
  const included = new Set(o.dataTypes);
  const excluded = new Set(extras.excludeItems ?? []);
  const demoShotSet = new Set(extras.demoScreenshots ?? []);
  const responses = hasResponseData(spec) ? indexResponses(spec) : null;
  const varTocMark = toc.length;
  const varId = entry('Variable List', 1);
  const surveysHtml: string[] = [];
  const surveyLabelOf = (n: string) => spec.surveys.find((s) => s['Survey.Name'] === n)?.['Survey.LongName'] || n;
  for (const m of models) {
    const surveyMark = toc.length;
    const sid = entry(m.label, 2, m.label);
    let kept = 0;
    let dropped = 0;
    const parts: string[] = [];
    const views = flowKnown(m.survey) ? extras.flowViews?.[m.name] : undefined;
    const svg = views?.length ? flowViewer(views) : flowKnown(m.survey) ? extras.flowchartSvgs?.[m.name] : undefined;
    const lazy = !svg && extras.flowchartsInBrowser && flowKnown(m.survey) ? `<pre class="cb-mermaid">${esc(generateFlowchart(m.survey, flowchartContext(spec, m.name)))}</pre>` : '';
    if (o.flowcharts && (svg || lazy)) {
      const pid = `flow-${slug(m.name)}`;
      parts.push(`<div class="cb-anchor cb-flow"${optAttr('flowcharts')}>${toggleButton(pid, 'Click to view survey flowchart', t.expandVisuals)}<div id="${pid}" class="cb-visuals" ${t.expandVisuals ? '' : 'hidden'}><div class="cb-flowchart">${svg ?? lazy}</div></div></div>`);
    }
    type OpenBlock = { path: string; items: string[]; id: string; note: string };
    let openBlock = null as OpenBlock | null;
    // Read through a function: TypeScript otherwise narrows openBlock to null after closeBlock() calls.
    const current = (): OpenBlock | null => openBlock;
    const closeBlock = () => {
      if (!openBlock) return;
      parts.push(
        `<section class="cb-block"><div class="cb-block-head"${optAttr(codebookTypeKey('Block'))}><span class="cb-block-tag">Block</span><h3 id="${openBlock.id}">${esc(openBlock.path)}${caret(`Block: ${openBlock.path}`)}</h3>${openBlock.note}</div><div class="cb-sec-body">${openBlock.items.join('\n')}</div></section>`,
      );
      openBlock = null;
    };
    for (const q of m.survey.questions ?? []) {
      if (isEndBlock(q) || isBlock(q)) continue;
      if (!isQuestion(q) || !included.has(q['Question.Type.Display.Name'])) continue;
      const itemKey = codebookItemKey(m.name, q['Item.ID']);
      if (excluded.has(itemKey)) {
        dropped++;
        continue;
      }
      kept++;
      const path = included.has('Block') ? blockPath(m, q).join(' › ') : '';
      if (path !== (current()?.path ?? '')) {
        closeBlock();
        if (path) {
          const blockItem = m.byId.get(q.Parent ?? '');
          const behaviour = blockItem ? blockNotes(m, blockItem['Item.ID'], surveyLabelOf, true) : [];
          const note = (blockItem && o.skipLogic ? skipNote(m, blockItem['Item.ID']) : '') + behaviour.map((b) => `<p class="cb-cond"><span class="cb-cond-tag">${b.startsWith('Floating') ? 'Floating' : 'Repeats'}</span> ${esc(b.replace(/^Floating: /, ''))}</p>`).join('');
          openBlock = { path, items: [], id: entry(`Block: ${path}`, 3, `${m.label} block ${path}`), note };
        }
      }
      const stats = responses ? describeItem(q, responses.get(q['Question.ID']), overview?.participants ?? 0) : null;
      const html = variablePage(m, q, o, t, stats, itemKey, extras.screenshots?.[itemKey], demoShotSet, entry(stripHtml(q['Question.Text'] ?? '') || itemLabel(q), path ? 4 : 3, `${m.name} ${q['Item.ID']}`), spec.screenshotsURL);
      const ob = current();
      if (ob) ob.items.push(html);
      else parts.push(html);
    }
    closeBlock();
    // A survey whose variables were all left out is left out too.
    if (dropped && !kept) {
      toc.splice(surveyMark);
      continue;
    }
    surveysHtml.push(`<section class="cb-survey" id="survey-${slug(m.name)}"><h2 id="${sid}" class="cb-survey-name">${esc(m.label)}${caret(m.label)}</h2><div class="cb-sec-body">${parts.join('\n')}</div></section>`);
  }
  if (surveysHtml.length) out.push(`<section class="cb-page"><hr><h1 id="${varId}">Variable List${caret('Variable List')}</h1><hr><div class="cb-sec-body">${surveysHtml.join('\n')}</div></section>`);
  else toc.splice(varTocMark, 1);
  custom('variableList');
  const docs = (extras.attachments ?? []).filter((a) => /^data:/.test(a.href));
  if (o.attachments && docs.length) out.push(page('Attached Documents', attachmentsHtml(docs), ['attachments']));
  custom('attachments');
  // Sections placed after a section that no longer exists (or in a loop) go at the end.
  for (const s of ownSections) if (!placed.has(s.id)) emitSection(s);

  // The Sections menu holds the whole contents tree, down to each question, folded below the top level.
  const menu = `<div class="cb-menu-tree">${renderToc(toc, 0)}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${fontLinks(t)}<style>${themeCss(t)}${CODEBOOK_CSS}${printPageCss(title)}</style>
</head>
<body class="cb charts-${t.charts}">
<header class="cb-topbar">
<a class="cb-topbar-title" href="#top">${esc(title)}</a>
<div class="cb-menu">
<button class="cb-menu-btn" type="button" aria-expanded="false" aria-controls="cb-menu-list">Sections <span aria-hidden="true">▾</span></button>
<nav class="cb-menu-list" id="cb-menu-list" hidden aria-label="Sections">${menu}</nav>
</div>
</header>
<div class="content" id="top">
<div id="header">
${o.logo && extras.logo && /^(data:image\/|https:\/\/)/.test(extras.logo) ? `<img class="cb-logo" src="${esc(extras.logo)}" alt="Study logo">` : ''}
<h1 class="title">${esc(title)}</h1>
<h4 class="date">Codebook Generated ${esc(generated)}</h4>
</div>
${
  o.toc
    ? `<nav id="TOC" class="cb-toc" aria-label="Table of contents"${optAttr('toc')}>
<div class="cb-toc-head">
<button class="cb-toc-toggle" type="button" aria-expanded="true" aria-controls="cb-toc-body">Table of Contents <span class="cb-twisty-icon">▲</span></button>
<span class="cb-toc-actions"><button type="button" data-toc="expand">Expand all</button><button type="button" data-toc="collapse">Collapse all</button></span>
</div>
<div id="cb-toc-body">${renderToc(toc)}</div>
</nav>
`
    : ''
}${out.join('\n')}
</div>
<a href="#top" id="backToTopBtn" title="Back to top" aria-label="Back to top">↑</a>
${
  extras.flowchartsInBrowser
    ? `<script src="https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.min.js"></script><script>window.mermaid && window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: false } });</script>`
    : ''
}<script>${CODEBOOK_JS}</script>
</body>
</html>`;
}

/**
 * Marks which Content-tab options an element belongs to (space-separated option keys, or "type-<slug>"
 * for question types), so the generator can highlight it while that option is hovered.
 */
const optAttr = (...keys: string[]) => ` data-cb-opt="${keys.join(' ')}"`;
/** Option key for a question type, as used in data-cb-opt. */
export const codebookTypeKey = (type: string) => `type-${slug(type)}`;

function toggleButton(targetId: string, label: string, open: boolean): string {
  return `<button class="cb-toggle" type="button" data-target="${targetId}" aria-expanded="${open}">${esc(label)} <span class="cb-arrow">${open ? '▲' : '▼'}</span></button>`;
}

/** "Shown only if <variable> (<question>) is/includes <answer>", or '' when always shown. */
function skipNote(m: SurveyModel, itemId: string): string {
  const branches = m.branchesTo.get(itemId) ?? [];
  if (!branches.length) return '';
  const parts = branches.map((b) => {
    const parent = m.byId.get(b.parentId);
    const multi = parent?.['Question.Type.Display.Name'] === 'Multiple Select';
    const answer = b.definitions.length
      ? ` ${multi ? 'includes' : 'is'} ${b.definitions.map((d) => `<em>${esc(d)}</em>`).join(' or ')}`
      : b.condition
        ? ` ${esc(b.condition)}`
        : '';
    const text = parent ? stripHtml(itemLabel(parent)) : '';
    return `<strong>${esc(parent?.['Question.ID'] ?? b.parentId)}</strong>${text ? ` <span class="cb-cond-q">(${esc(text.length > 70 ? `${text.slice(0, 69)}…` : text)})</span>` : ''}${answer}`;
  });
  return `<p class="cb-cond"${optAttr('skipLogic')}><span class="cb-cond-tag">Skip logic</span> Shown only if ${parts.join('; or ')}</p>`;
}

function variablePage(
  m: SurveyModel,
  q: Question,
  o: CodebookOptions,
  t: CodebookTheme,
  stats: ItemDescriptives | null,
  itemKey: string,
  uploadedShot: string | undefined,
  demoShots: Set<string>,
  id: string,
  screenshotsURL: string | undefined,
): string {
  const text = stripHtml(q['Question.Text'] ?? '') || itemLabel(q);
  const lines: string[] = [];
  const cond = o.skipLogic ? skipNote(m, q['Item.ID']) : '';
  // Delivery and data type sit in the question header as one quiet line ("Multiple Choice • Integer").
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const meta = [
    o.deliveryType ? `<span${optAttr('deliveryType')}>${esc(q['Question.Type.Display.Name'])}</span>` : '',
    o.typeOfData && q['Data.Type'] ? `<span${optAttr('typeOfData')}>${esc(cap(q['Data.Type']))}</span>` : '',
    cond ? `<span${optAttr('skipLogic')}>Conditional</span>` : '',
  ].filter(Boolean);
  // Everything else opens by clicking the question header.
  const body: string[] = [];
  if (cond) body.push(cond);
  if (q['Question.Description']) body.push(`<p><strong>Description:</strong> ${esc(q['Question.Description'])}</p>`);
  const opts = responseOptions(q);
  if (o.responseOptions && opts.length && !stats?.frequencies) {
    body.push(
      `<table class="cb-table cb-options"${optAttr('responseOptions')}><thead><tr><th>Value</th><th>Label</th></tr></thead><tbody>${opts
        .map((r) => `<tr><td>${esc(r.value)}</td><td>${esc(r.label)}</td></tr>`)
        .join('')}</tbody></table>`,
    );
  }

  const tabs: Array<{ name: string; html: string; keys: string[] }> = [];
  // A tab shows when its section is on and at least one of its parts is.
  const add = (name: string, html: string, ...keys: string[]) => html && tabs.push({ name, html, keys });
  if (stats?.frequencies && o.frequencyTable) add('Frequency Table', frequencyTableHtml(stats), 'frequencyTable');
  if (stats?.frequencies && o.barPlot) add('Barplot', barplotSvg(text, stats.frequencies), 'barPlot');
  if (stats?.numeric && o.histograms) add('Histogram', histogramHtml(stats, o), 'histograms', 'histStats', 'histChart');
  if (stats && o.missingness) add('Missingness', missingnessHtml(q, stats, m, o), 'missingness', 'missAnswered', 'missMissing', 'missParticipants', 'missIcc', 'missPerPerson', 'missNote');
  if (stats?.outliers && o.outlierPlots) add('Outliers', outliersHtml(stats, o), 'outlierPlots', 'outlierSummary', 'outlierPlot');
  // Screenshot: an uploaded one, else one at the study's screenshot URL, else (optionally) a drawing.
  if (o.screenshots) {
    const shot = uploadedShot && /^data:image\//.test(uploadedShot) ? uploadedShot : null;
    if (shot) {
      const demo = demoShots.has(itemKey);
      tabs.push({
        name: 'Screenshot',
        keys: ['screenshots'],
        html: `<img class="cb-screenshot" alt="${demo ? 'Made-up screenshot' : 'Screenshot'} of ${esc(q['Item.ID'])}" src="${esc(shot)}">${demo ? '<p class="cb-small">This is a made-up screenshot, shown as a demonstration.</p>' : ''}`,
      });
    } else if (screenshotsURL) {
      const base = screenshotsURL.replace(/\/+$/, '');
      tabs.push({
        name: 'Screenshot',
        keys: ['screenshots'],
        html: `<img class="cb-screenshot" alt="Screenshot of ${esc(q['Item.ID'])}" src="${esc(`${base}/${encodeURIComponent(q['Item.ID'])}.png`)}" onerror="this.replaceWith(Object.assign(document.createElement('p'),{textContent:'No screenshot available.'}))">`,
      });
    }
  }
  const vid = `vis-${id}`;
  if (tabs.length) {
    body.push(`<h3 class="cb-visuals-title">Descriptives</h3>
<div class="cb-tabs" role="tablist">${tabs.map((tab, i) => `<button type="button" role="tab" class="cb-tab${i === 0 ? ' is-active' : ''}" data-tab="${vid}-${slug(tab.name)}" aria-selected="${i === 0}"${optAttr(...tab.keys)}>${esc(tab.name)}</button>`).join('')}</div>
${tabs.map((tab, i) => `<div class="cb-pane${i === 0 ? ' is-active' : ''}" id="${vid}-${slug(tab.name)}" role="tabpanel"><h4 class="cb-print-only">${esc(tab.name)}</h4>${tab.html}</div>`).join('')}`);
  }
  const open = t.expandVisuals;
  const foldable = body.length > 0;
  if (foldable) lines.push(`<div id="${vid}" class="cb-visuals cb-q-body" ${open ? '' : 'hidden'}>${body.join('\n')}</div>`);

  const head = `<h4 id="${id}">${esc(text)}<span class="cb-q-sub"><span class="item-id">[${esc(q['Item.ID'])}]</span>${
    meta.length ? `<span class="cb-q-meta">${meta.join(' • ')}</span>` : ''
  }</span></h4>${foldable ? `<span class="cb-arrow cb-q-arrow" aria-hidden="true">${open ? '▲' : '▼'}</span>` : ''}`;
  return `<div class="cb-var"${optAttr(codebookTypeKey(q['Question.Type.Display.Name']), `item:${encodeURIComponent(itemKey)}`)}>
${
  foldable
    ? `<div class="header-shading cb-q-head" role="button" tabindex="0" data-target="${vid}" aria-expanded="${open}" title="Click to show or hide descriptives">${head}</div>`
    : `<div class="header-shading">${head}</div>`
}
<div class="cb-anchor">
${lines.join('\n')}
</div>
</div>`;
}

function frequencyTableHtml(s: ItemDescriptives): string {
  return `<table class="cb-table cb-freq"><thead><tr><th>Value</th><th>Label</th><th>Counts</th><th>Percentages</th></tr></thead><tbody>${s
    .frequencies!.map(
      (f) => `<tr><td>${esc(f.value)}</td><td>${esc(f.label)}</td><td class="cb-count">N = ${f.count}</td><td>${Number(f.percent.toFixed(1))}%</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function missingnessHtml(q: Question, s: ItemDescriptives, m: SurveyModel, o: CodebookOptions): string {
  const r2 = (x: number) => Number(x.toFixed(2));
  const pct = s.delivered ? (s.answered / s.delivered) * 100 : 0;
  const conditional = (m.branchesTo.get(q['Item.ID'])?.length ?? 0) > 0 || s.participants < s.totalParticipants;
  const mm = s.missingness;
  const tiles = [
    o.missAnswered && `<div class="cb-stat"${optAttr('missAnswered')}><span class="cb-stat-l">Answered / Delivered</span><span class="cb-stat-n">${s.answered} / ${s.delivered}</span><span class="cb-meter"><span style="width:${pct.toFixed(1)}%"></span></span><span class="cb-stat-sub">${pct.toFixed(1)}% response rate</span></div>`,
    o.missMissing && `<div class="cb-stat"${optAttr('missMissing')}><span class="cb-stat-l">Missing</span><span class="cb-stat-n">${s.missing}</span><span class="cb-stat-sub">${s.delivered ? ((s.missing / s.delivered) * 100).toFixed(1) : '0'}% of deliveries</span></div>`,
    o.missParticipants && `<div class="cb-stat"${optAttr('missParticipants')}><span class="cb-stat-l">Participants</span><span class="cb-stat-n">${s.participants}${s.totalParticipants ? ` / ${s.totalParticipants}` : ''}</span><span class="cb-stat-sub">${conditional ? (s.participants >= s.totalParticipants ? 'all were delivered this item' : 'were delivered this item') : 'delivered this item'}</span></div>`,
    o.missIcc && mm ? `<div class="cb-stat"${optAttr('missIcc')}><span class="cb-stat-l">Missingness ICC</span><span class="cb-stat-n">${mm.icc == null ? 'NA' : r2(mm.icc)}</span><span class="cb-stat-sub">share of missingness between people</span></div>` : '',
  ]
    .filter(Boolean)
    .join('');
  const perPerson = o.missPerPerson && mm
    ? `<table class="cb-table cb-compact"${optAttr('missPerPerson')}><thead><tr><th>Missing per participant</th><th>Min</th><th>Max</th><th>Mean</th><th>SD</th></tr></thead><tbody><tr><td>Count of missed deliveries</td><td>${r2(mm.min)}</td><td>${r2(mm.max)}</td><td>${r2(mm.mean)}</td><td>${r2(mm.sd)}</td></tr></tbody></table>`
    : '';
  // The note explains the ICC, so it goes with it.
  const note = o.missNote && (o.missIcc || o.missPerPerson) && mm
    ? `<p class="cb-small"${optAttr('missNote')}>ICC(1) of answered vs. missed across participants: near 0 means missed prompts are spread evenly; near 1 means a few participants account for most of them.</p>`
    : '';
  if (!tiles && !perPerson) return '';
  return `<p class="cb-miss-title"><strong>Missingness Descriptives</strong></p>${tiles ? `<div class="cb-stats">${tiles}</div>` : ''}${perPerson}${note}`;
}

function outliersHtml(s: ItemDescriptives, opts: CodebookOptions): string {
  const o = s.outliers!;
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  // Summary only: no per-response listing, so the codebook never exposes individual records.
  const summary = opts.outlierSummary
    ? `<p${optAttr('outlierSummary')}><strong>Outlier screen</strong>: values below ${f(o.lower)} or above ${f(o.upper)} (1.5 × IQR beyond the quartiles) are flagged. ${o.flagged.length} of ${o.points.length} responses flagged.</p>`
    : '';
  return summary + (opts.outlierPlot ? `<div${optAttr('outlierPlot')}>${boxPlotSvg(o)}</div>` : '');
}

function boxPlotSvg(o: NonNullable<ItemDescriptives['outliers']>): string {
  const W = 760;
  const H = 150;
  const L = 30;
  const R = 30;
  const lo = Math.min(o.min, o.lower);
  const hi = Math.max(o.max, o.upper);
  const span = hi - lo || 1;
  const x = (v: number) => L + ((v - lo) / span) * (W - L - R);
  const mid = 52;
  const whiskLo = Math.max(o.min, o.lower);
  const whiskHi = Math.min(o.max, o.upper);
  const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  // Deterministic jitter so the file is stable between builds.
  const jitter = (i: number) => (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * 34;
  const pts = o.points.slice(0, 1500);
  // Keep edge labels inside the chart.
  const anchor = (px: number) => (px < L + 70 ? 'start' : px > W - R - 70 ? 'end' : 'middle');
  return `<svg class="cb-chart cb-boxplot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Box plot with outliers">
<line class="cb-whisker" x1="${x(whiskLo)}" x2="${x(o.q1)}" y1="${mid}" y2="${mid}"/><line class="cb-whisker" x1="${x(o.q3)}" x2="${x(whiskHi)}" y1="${mid}" y2="${mid}"/>
<line class="cb-whisker" x1="${x(whiskLo)}" x2="${x(whiskLo)}" y1="${mid - 10}" y2="${mid + 10}"/><line class="cb-whisker" x1="${x(whiskHi)}" x2="${x(whiskHi)}" y1="${mid - 10}" y2="${mid + 10}"/>
<rect class="cb-box" x="${x(o.q1)}" y="${mid - 20}" width="${Math.max(1, x(o.q3) - x(o.q1))}" height="40"/>
<line class="cb-median" x1="${x(o.median)}" x2="${x(o.median)}" y1="${mid - 20}" y2="${mid + 20}"/>
<line class="cb-fence" x1="${x(o.lower)}" x2="${x(o.lower)}" y1="12" y2="${H - 28}"/><line class="cb-fence" x1="${x(o.upper)}" x2="${x(o.upper)}" y1="12" y2="${H - 28}"/>
${pts
  .map((p, i) => {
    const out = p.value < o.lower || p.value > o.upper;
    return `<circle class="${out ? 'cb-dot-out' : 'cb-dot-in'}" cx="${x(p.value).toFixed(1)}" cy="${(mid + 48 + jitter(i) * 0.5).toFixed(1)}" r="${out ? 3.5 : 2.2}"></circle>`;
  })
  .join('')}
<text class="cb-axis" x="${x(o.lower)}" y="${H - 14}" text-anchor="${anchor(x(o.lower))}">lower fence ${f(o.lower)}</text>
<text class="cb-axis" x="${x(o.upper)}" y="${H - 14}" text-anchor="${anchor(x(o.upper))}">upper fence ${f(o.upper)}</text>
<text class="cb-axis" x="${x(o.median)}" y="${mid - 26}" text-anchor="middle">median ${f(o.median)}</text>
</svg>`;
}

function histogramHtml(s: ItemDescriptives, o: CodebookOptions): string {
  const n = s.numeric!;
  const f = (x: number) => Number(x.toFixed(2));
  const cells: Array<[string, number]> = [['N', n.n], ['Mean', f(n.mean)], ['SD', f(n.sd)], ['Median', f(n.median)], ['Min', f(n.min)], ['Max', f(n.max)]];
  return (o.histStats ? `<dl class="cb-numstats"${optAttr('histStats')}>${cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : '') + (o.histChart ? `<div${optAttr('histChart')}>${histogramSvg(n.bins)}</div>` : '');
}

// Charts take their colours from CSS (ggplot2 grey, or the theme accent).
function barplotSvg(title: string, freqs: Array<{ label: string; count: number }>): string {
  const n = Math.max(1, freqs.length);
  const L = 54;
  const T = 34;
  const W = 760;
  const plotW = W - L - 16;
  const slot = plotW / n;
  const charW = 6.2;
  // Labels wrap onto up to three lines under their column.
  const perLine = Math.max(4, Math.floor((slot - 6) / charW));
  const wrap = (label: string): string[] => {
    const words = label.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > perLine) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    if (lines.length > 3) lines.splice(2, lines.length, `${lines.slice(2).join(' ').slice(0, perLine - 1)}…`);
    return lines.map((l) => (l.length > perLine ? `${l.slice(0, perLine - 1)}…` : l));
  };
  const labels = freqs.map((f) => wrap(f.label));
  const labelLines = Math.max(1, ...labels.map((l) => l.length));
  const plotH = 240;
  const H = T + plotH + 16 + labelLines * 13 + 22;
  const max = Math.max(1, ...freqs.map((r) => r.count));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step || 1;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step * 0.01; v += step) ticks.push(v);
  const y = (v: number) => T + plotH - (v / top) * plotH;
  const barW = Math.min(90, slot * 0.7);
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Barplot">
<text class="cb-chart-title" x="${L}" y="18">${esc(title.length > 90 ? `${title.slice(0, 89)}…` : title)}</text>
<rect class="cb-panel" x="${L}" y="${T}" width="${plotW}" height="${plotH}"/>
${ticks.map((v) => `<line class="cb-grid" x1="${L}" x2="${L + plotW}" y1="${y(v)}" y2="${y(v)}"/><text class="cb-axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
${freqs
  .map((r, i) => {
    const cx = L + slot * i + slot / 2;
    const lab = labels[i]!.map((l, k) => `<tspan x="${cx}" dy="${k ? 13 : 0}">${esc(l)}</tspan>`).join('');
    return `<rect class="cb-bar" x="${cx - barW / 2}" y="${y(r.count)}" width="${barW}" height="${Math.max(0, T + plotH - y(r.count))}"><title>${esc(r.label)}: ${r.count}</title></rect><text class="cb-axis" x="${cx}" y="${T + plotH + 15}" text-anchor="middle">${lab}</text>`;
  })
  .join('')}
<text class="cb-axis-title" transform="translate(14 ${T + plotH / 2}) rotate(-90)" text-anchor="middle">count</text>
</svg>`;
}

function histogramSvg(bins: Array<{ from: number; to: number; count: number }>): string {
  const W = 640;
  const H = 300;
  const L = 50;
  const B = 40;
  const T = 12;
  const plotW = W - L - 16;
  const plotH = H - B - T;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => T + plotH - (v / top) * plotH;
  const bw = plotW / bins.length;
  const fmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1));
  const yt: number[] = [];
  for (let v = 0; v <= top; v += step) yt.push(v);
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram">
<rect class="cb-panel" x="${L}" y="${T}" width="${plotW}" height="${plotH}"/>
${yt.map((v) => `<line class="cb-grid" x1="${L}" x2="${L + plotW}" y1="${y(v)}" y2="${y(v)}"/><text class="cb-axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
${bins.map((b, i) => `<rect class="cb-bar" x="${L + i * bw + 0.5}" y="${y(b.count)}" width="${bw - 1}" height="${T + plotH - y(b.count)}"><title>${fmt(b.from)}–${fmt(b.to)}: ${b.count}</title></rect>`).join('')}
${[0, Math.floor(bins.length / 2), bins.length].map((i) => `<text class="cb-axis" x="${L + i * bw}" y="${T + plotH + 15}" text-anchor="middle">${fmt(i === bins.length ? bins[bins.length - 1]!.to : bins[i]!.from)}</text>`).join('')}
<text class="cb-axis-title" x="${L + plotW / 2}" y="${H - 6}" text-anchor="middle">response</text>
<text class="cb-axis-title" transform="translate(14 ${T + plotH / 2}) rotate(-90)" text-anchor="middle">count</text>
</svg>`;
}

const BURST_COLORS = ['#E69F00', '#56B4E9', '#009E73', '#CC79A7', '#0072B2', '#D55E00', '#B8A200', '#7F7F7F'];
const dayNum = (date: string) => Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Cumulative enrollment as a step line (a "Sisyphus" plot). */
function enrollmentSvg(points: EnrollmentPoint[]): string {
  const W = 760;
  const H = 320;
  const L = 52;
  const R = 16;
  const T = 14;
  const B = 44;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const d0 = dayNum(points[0]!.date);
  const d1 = Math.max(d0 + 1, dayNum(points[points.length - 1]!.date));
  const n = points.length;
  const step = niceStep(n);
  const top = Math.ceil(n / step) * step || 1;
  const x = (d: number) => L + ((d - d0) / (d1 - d0)) * plotW;
  const y = (v: number) => T + plotH - (v / top) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step * 0.01; v += step) ticks.push(v);
  // Month ticks, thinned to at most about 8 labels.
  const months: Array<{ d: number; label: string }> = [];
  const start = new Date(d0 * 86_400_000);
  for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); m.getTime() / 86_400_000 <= d1; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const d = m.getTime() / 86_400_000;
    if (d >= d0) months.push({ d, label: `${MONTHS[m.getUTCMonth()]} ${m.getUTCFullYear()}` });
  }
  const every = Math.max(1, Math.ceil(months.length / 8));
  let path = `M${x(d0).toFixed(1)},${y(0).toFixed(1)}`;
  for (const pt of points) path += `H${x(dayNum(pt.date)).toFixed(1)}V${y(pt.n).toFixed(1)}`;
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Enrollment over time">
<rect class="cb-panel" x="${L}" y="${T}" width="${plotW}" height="${plotH}"/>
${ticks.map((v) => `<line class="cb-grid" x1="${L}" x2="${L + plotW}" y1="${y(v)}" y2="${y(v)}"/><text class="cb-axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
${months
  .filter((_, i) => i % every === 0)
  .map((m) => `<line class="cb-grid" x1="${x(m.d)}" x2="${x(m.d)}" y1="${T}" y2="${T + plotH}"/><text class="cb-axis" x="${x(m.d)}" y="${T + plotH + 16}" text-anchor="middle">${m.label}</text>`)
  .join('')}
${(() => {
    // One bar per participant, from first to last completed survey, at their place in the enrollment order.
    const bh = Math.max(1.5, Math.min(6, (plotH / top) * 0.7));
    return points
      .map((pt) => {
        const x0 = x(dayNum(pt.date));
        const w = Math.max(2, x(dayNum(pt.last)) - x0);
        const fill = pt.compliance == null ? 'var(--cb-accent)' : complianceColor(pt.compliance);
        const tip = `${pt.participant}: ${pt.date} to ${pt.last}${pt.compliance == null ? '' : `, ${Math.round(pt.compliance * 100)}% of prompts answered`}`;
        return `<rect class="cb-span" x="${x0.toFixed(1)}" y="${(y(pt.n) - bh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" fill="${fill}"><title>${esc(tip)}</title></rect>`;
      })
      .join('');
  })()}
${points.map((pt) => `<circle class="cb-dot-in" cx="${x(dayNum(pt.date)).toFixed(1)}" cy="${y(pt.n).toFixed(1)}" r="3"></circle>`).join('')}
<path class="cb-line" d="${path}"/>
${points[0]?.compliance != null ? complianceLegend(L + 12, T + 12) : ''}
<text class="cb-axis-title" x="${L + plotW / 2}" y="${H - 6}" text-anchor="middle">enrollment date (first survey)</text>
<text class="cb-axis-title" transform="translate(13 ${T + plotH / 2}) rotate(-90)" text-anchor="middle"># of participants</text>
</svg>`;
}

/** Every completed survey by day since each participant's first survey, colored by burst. */
function timelineSvg(tl: SurveyTimeline): string {
  const W = 760;
  const rows = Math.max(1, tl.participants);
  const L = 44;
  const R = tl.bursts > 1 ? 96 : 16;
  const T = 12;
  const B = 44;
  const plotH = Math.min(560, Math.max(240, rows * 3));
  const H = T + plotH + B;
  const plotW = W - L - R;
  const maxDay = Math.max(1, tl.maxDay);
  const x = (d: number) => L + (d / maxDay) * plotW;
  const rowH = plotH / rows;
  const y = (r: number) => T + plotH - (r + 0.5) * rowH;
  const rDot = Math.max(1.2, Math.min(3, rowH * 0.45));
  // Smoothed surveys-per-day curve (Gaussian kernel, sd 1.5 days), scaled to 90% of the plot height.
  const sd = 1.5;
  const smooth = tl.perDay.map((_, d) => tl.perDay.reduce((acc, c, k) => acc + c * Math.exp(-((k - d) ** 2) / (2 * sd * sd)), 0));
  const peak = Math.max(1, ...smooth);
  const area = `M${x(0)},${T + plotH}${smooth.map((v, d) => `L${x(d).toFixed(1)},${(T + plotH - (v / peak) * plotH * 0.9).toFixed(1)}`).join('')}L${x(maxDay)},${T + plotH}Z`;
  const dStep = niceStep(maxDay);
  const dTicks: number[] = [];
  for (let d = 0; d <= maxDay; d += dStep) dTicks.push(d);
  const rStep = niceStep(rows);
  const rTicks: number[] = [];
  for (let r = 0; r <= rows; r += rStep) rTicks.push(r);
  const color = (b: number) => BURST_COLORS[(b - 1) % BURST_COLORS.length];
  const legend =
    tl.bursts > 1
      ? `<text class="cb-axis-title" x="${W - R + 14}" y="${T + 12}">Burst</text>${burstKeys(tl.bursts, W - R + 14, T + 22)}`
      : '';
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Surveys by day since first survey">
<rect class="cb-panel" x="${L}" y="${T}" width="${plotW}" height="${plotH}"/>
${dTicks.map((d) => `<line class="cb-grid" x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${T + plotH}"/><text class="cb-axis" x="${x(d)}" y="${T + plotH + 16}" text-anchor="middle">${d}</text>`).join('')}
${rTicks.map((r) => `<text class="cb-axis" x="${L - 6}" y="${(T + plotH - r * rowH + 4).toFixed(1)}" text-anchor="end">${r}</text>`).join('')}
<path class="cb-density" d="${area}"/>
${tl.points.map((pt) => `<circle class="${tl.bursts > 1 ? 'cb-dot-burst' : 'cb-dot-in'}" cx="${x(pt.day).toFixed(1)}" cy="${y(pt.row).toFixed(1)}" r="${rDot.toFixed(1)}"${tl.bursts > 1 ? ` fill="${color(pt.burst)}" data-burst="${pt.burst}"` : ''}></circle>`).join('')}
${legend}
<text class="cb-axis-title" x="${L + plotW / 2}" y="${H - 6}" text-anchor="middle">day since first survey</text>
<text class="cb-axis-title" transform="translate(12 ${T + plotH / 2}) rotate(-90)" text-anchor="middle">participant</text>
</svg>`;
}

/** Compliance (0–1) to a color: orange-red at 0, amber at 50%, blue at 100% (color-blind safe ends). */
function complianceColor(v: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [213, 94, 0]],
    [0.5, [230, 159, 0]],
    [1, [0, 114, 178]],
  ];
  const t = Math.max(0, Math.min(1, v));
  const i = t <= 0.5 ? 0 : 1;
  const [a, ca] = stops[i]!;
  const [b, cb] = stops[i + 1]!;
  const f = (t - a) / (b - a);
  const c = ca.map((x, k) => Math.round(x + (cb[k]! - x) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function complianceLegend(x: number, y: number): string {
  const w = 120;
  const id = `cbcomp${Math.round(x)}${Math.round(y)}`;
  return `<g class="cb-comp-key"><defs><linearGradient id="${id}"><stop offset="0" stop-color="${complianceColor(0)}"/><stop offset=".5" stop-color="${complianceColor(0.5)}"/><stop offset="1" stop-color="${complianceColor(1)}"/></linearGradient></defs>
<text class="cb-axis-title" x="${x}" y="${y + 4}">Compliance</text>
<rect x="${x}" y="${y + 10}" width="${w}" height="8" rx="2" fill="url(#${id})"/>
<text class="cb-axis" x="${x}" y="${y + 32}">0%</text><text class="cb-axis" x="${x + w}" y="${y + 32}" text-anchor="end">100%</text></g>`;
}

/** Burst legend entries; hovering or focusing one highlights that burst in the chart (see CODEBOOK_JS). */
function burstKeys(n: number, x: number, y: number): string {
  return Array.from(
    { length: n },
    (_, i) =>
      `<g class="cb-burst-key" data-key="${i + 1}" tabindex="0" role="button" aria-label="Highlight burst ${i + 1}"><rect x="${x - 4}" y="${y + i * 20 - 2}" width="70" height="18" fill="transparent"/><circle cx="${x + 6}" cy="${y + 7 + i * 20}" r="5" fill="${BURST_COLORS[i % BURST_COLORS.length]}"></circle><text class="cb-axis" x="${x + 18}" y="${y + 11 + i * 20}">Burst ${i + 1}</text></g>`,
  ).join('');
}

/** Each burst's surveys per day since the burst began, as overlapping smoothed curves. */
function burstDensitySvg(tl: SurveyTimeline): string {
  const W = 760;
  const L = 44;
  const R = 104;
  const T = 14;
  const B = 44;
  const plotH = 240;
  const H = T + plotH + B;
  const plotW = W - L - R;
  const maxDay = Math.max(1, ...tl.perBurstDay.map((a) => a.length - 1));
  const sd = 1.2;
  const curves = tl.perBurstDay.map((counts) =>
    Array.from({ length: maxDay + 1 }, (_, d) => counts.reduce((acc, c, k) => acc + c * Math.exp(-((k - d) ** 2) / (2 * sd * sd)), 0)),
  );
  const peak = Math.max(1, ...curves.flat());
  const x = (d: number) => L + (d / maxDay) * plotW;
  const y = (v: number) => T + plotH - (v / peak) * plotH * 0.92;
  const dStep = niceStep(maxDay);
  const dTicks: number[] = [];
  for (let d = 0; d <= maxDay; d += dStep) dTicks.push(d);
  const paths = curves
    .map((c, i) => {
      const color = BURST_COLORS[i % BURST_COLORS.length];
      const line = c.map((v, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('');
      return `<g data-burst="${i + 1}"><path d="${line}L${x(maxDay)},${T + plotH}L${x(0)},${T + plotH}Z" fill="${color}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.2"/></g>`;
    })
    .join('');
  return `<svg class="cb-chart cb-burst-density" viewBox="0 0 ${W} ${H}" role="img" aria-label="Surveys by day of each burst">
<rect class="cb-panel" x="${L}" y="${T}" width="${plotW}" height="${plotH}"/>
${dTicks.map((d) => `<line class="cb-grid" x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${T + plotH}"/><text class="cb-axis" x="${x(d)}" y="${T + plotH + 16}" text-anchor="middle">${d + 1}</text>`).join('')}
${paths}
<text class="cb-axis-title" x="${W - R + 14}" y="${T + 12}">Burst</text>${burstKeys(tl.bursts, W - R + 14, T + 22)}
<text class="cb-axis-title" x="${L + plotW / 2}" y="${H - 6}" text-anchor="middle">day of burst</text>
<text class="cb-axis-title" transform="translate(14 ${T + plotH / 2}) rotate(-90)" text-anchor="middle">surveys (smoothed)</text>
</svg>`;
}

function niceStep(max: number): number {
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
}

function studyMetadataHtml(spec: StudySpec, overview: ReturnType<typeof dataOverview>): string {
  const parts: string[] = [];
  if (overview?.firstDate) {
    const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: '2-digit', year: 'numeric' });
    parts.push(`<p><strong>Data Collection Period:</strong> ${esc(d(overview.firstDate))} to ${esc(d(overview.lastDate!))}</p>`);
  }
  if (overview?.participants) parts.push(`<p><strong>Participants:</strong> ${overview.participants}</p>`);
  if (overview?.devices.length) parts.push(`<p><strong>Devices Used:</strong></p><ul>${overview.devices.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
  if (overview?.timezones.length) parts.push(`<p><strong>Regions / Timezones:</strong></p><ul>${overview.timezones.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
  const skip = new Set(['Study.Name', 'authors', 'funding', 'abstract']);
  for (const [k, v] of Object.entries(spec['Study.Metadata'])) {
    if (skip.has(k) || isEmpty(v)) continue;
    parts.push(`<p><strong>${esc(humanize(k))}:</strong> ${typeof v === 'object' ? '' : renderInline(v)}</p>${typeof v === 'object' ? renderValue(v) : ''}`);
  }
  const ai = spec['AI.Information'];
  if (ai && !isEmpty(ai)) parts.push(`<p><strong>AI Disclosure:</strong></p>${renderValue(ai)}`);
  return parts.join('\n');
}

/** An image or video in a researcher's section. Videos also get a plain line for print and Word. */
function mediaHtml(md: { kind: 'image' | 'video'; src: string; name: string; caption: string }): string {
  const cap = md.caption.trim() ? `<p class="cb-small">${esc(md.caption)}</p>` : '';
  const src = md.src.trim();
  if (md.kind === 'image') {
    if (!/^(data:image\/|https:\/\/)/.test(src)) return '';
    return `<div class="cb-figure"><img class="cb-figure-img" src="${esc(src)}" alt="${esc(md.caption || md.name)}">${cap}</div>`;
  }
  const yt = src.match(/^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  const vimeo = src.match(/^https:\/\/(?:www\.)?vimeo\.com\/(\d+)/);
  const label = md.caption.trim() || md.name || 'Video';
  const printLine = /^https:/.test(src)
    ? `<p class="cb-print-line cb-small">Video: ${esc(label)} (<a href="${esc(src)}">${esc(src)}</a>)</p>`
    : `<p class="cb-print-line cb-small">Video: ${esc(label)} (plays in the HTML codebook)</p>`;
  let player = '';
  if (yt) player = `<iframe class="cb-video" src="https://www.youtube-nocookie.com/embed/${esc(yt[1]!)}" title="${esc(label)}" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  else if (vimeo) player = `<iframe class="cb-video" src="https://player.vimeo.com/video/${esc(vimeo[1]!)}" title="${esc(label)}" allow="picture-in-picture" allowfullscreen></iframe>`;
  else if (/^(data:video\/|https:\/\/)/.test(src)) player = `<video class="cb-video" controls preload="metadata" src="${esc(src)}"></video>`;
  if (!player) return '';
  return `<div class="cb-figure"><div class="cb-screen-only">${player}</div>${printLine}${cap}</div>`;
}

/** Attached documents: each one downloadable from the HTML codebook; text documents shown in full. */
function attachmentsHtml(docs: NonNullable<CodebookExtras['attachments']>): string {
  const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
  const kind = (d: { name: string; mediaType: string }) => (d.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? d.mediaType.split('/').pop() ?? 'file').toUpperCase();
  const MAX = 60000;
  return `<p>These documents travel inside this codebook file. Download one to open it.</p>${docs
    .map(
      (d) => `<div class="cb-attach"><p><strong>${esc(d.name)}</strong> <span class="cb-small">(${esc(kind(d))}, ${size(d.size)})</span> <a class="cb-screen-only cb-attach-dl" href="${esc(d.href)}" download="${esc(d.name)}">Download</a></p>${
        d.text.trim() ? `<pre class="cb-attach-text">${esc(d.text.length > MAX ? `${d.text.slice(0, MAX)}\n…` : d.text)}</pre>` : ''
      }</div>`,
    )
    .join('')}`;
}

/** Multi-line text as paragraphs (blank lines) and line breaks. */
function multiline(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((para) => `<p class="cb-prose">${esc(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function autoSummary(models: SurveyModel[], overview: ReturnType<typeof dataOverview>, anchor: (m: SurveyModel) => string | null = () => null): string {
  const n = models.reduce((a, m) => a + m.items.filter(isQuestion).length, 0);
  return `<p class="cb-prose">This codebook documents ${models.length} survey${models.length === 1 ? '' : 's'} with ${n} variable${n === 1 ? '' : 's'}${
    overview ? `, answered by ${overview.participants} participant${overview.participants === 1 ? '' : 's'}` : ''
  }.</p>
<table class="cb-table"><thead><tr><th>Survey</th><th>Questions</th><th>Blocks</th><th>Skip-logic branches</th></tr></thead><tbody>${models
    .map((m) => {
      const id = anchor(m);
      return `<tr><td>${id ? `<a href="#${id}">${esc(m.label)}</a>` : esc(m.label)}</td><td>${m.items.filter(isQuestion).length}</td><td>${m.items.filter(isBlock).length}</td><td>${m.branches.length}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

/** The study map figures: pre-rendered, or (without a DOM) Mermaid code drawn when the codebook opens. */
function studyMapFigures(spec: StudySpec, extras: CodebookExtras): string {
  const views = extras.flowViews?.[STUDY_MAP_KEY];
  if (views?.length) return `<figure class="cb-study-map"${optAttr('flowcharts')}>${flowViewer(views, 'Whole study')}</figure>`;
  const figs = extras.studyMapSvgs?.length
    ? extras.studyMapSvgs
    : extras.flowchartsInBrowser
      ? studyMapCodes(spec).map((m) => ({ caption: m.caption, svg: `<pre class="cb-mermaid">${esc(m.code)}</pre>` }))
      : [];
  return figs.map((f) => `<figure class="cb-study-map"${optAttr('flowcharts')}><div class="cb-flowchart">${f.svg}</div><figcaption>${esc(f.caption)}</figcaption></figure>`).join('');
}

export const STUDY_MAP_KEY = '\u0000study';

/** One view of an interactive flowchart, before rendering: its Mermaid code and what its nodes open. */
export interface FlowViewPlan {
  key: string;
  caption?: string;
  code: string;
  /** Mermaid node/cluster id -> another view's key, or "go:<anchor id>" to jump in the codebook. */
  links: Record<string, string>;
}
export type RenderedFlowView = Omit<FlowViewPlan, 'code'> & { svg: string };

/**
 * Every view an interactive flowchart needs, pre-rendered because the codebook has no drawing
 * library: a survey's flowchart unfolded, with each block folded on its own, and with all folded;
 * the study map's whole-study view and each burst.
 */
export function flowViewPlans(spec: StudySpec): Record<string, FlowViewPlan[]> {
  const out: Record<string, FlowViewPlan[]> = {};
  for (const survey of spec.surveys.filter(flowKnown)) {
    const ctx = flowchartContext(spec, survey['Survey.Name']);
    const blocks = flowchartBlocks(survey);
    const plans: FlowViewPlan[] = [{ key: 'base', code: generateFlowchart(survey, ctx), links: Object.fromEntries(blocks.map((b) => [b.clusterId, `fold:${b.itemId}`])) }];
    for (const b of blocks)
      plans.push({
        key: `fold:${b.itemId}`,
        code: generateFlowchart(survey, { ...ctx, collapsed: [b.itemId] }),
        links: { [b.collapsedId]: 'base', ...Object.fromEntries(blocks.filter((o) => o !== b).map((o) => [o.clusterId, `fold:${o.itemId}`])) },
      });
    if (blocks.length > 1) plans.push({ key: 'all', code: generateFlowchart(survey, { ...ctx, collapsed: blocks.map((b) => b.itemId) }), links: Object.fromEntries(blocks.map((b) => [b.collapsedId, 'base'])) });
    out[survey['Survey.Name']] = plans;
  }
  if (spec.schedules.length) {
    const bursts = studyBursts(spec);
    const target = (id: string) => (id.startsWith('burst:') ? id : `go:survey-${slug(id.slice(7))}`);
    const plans: FlowViewPlan[] = [];
    const linksOf = (m: ReturnType<typeof generateStudyMap>) => Object.fromEntries(m.nodes.map((n) => [n.nodeId, target(n.itemId)]));
    if (bursts.length > 1) {
      const m = generateStudyMap(spec);
      plans.push({ key: 'study', caption: 'The study: its bursts and the gaps between them. Click a burst to see its surveys.', code: m.code, links: linksOf(m) });
    }
    for (const b of bursts.length ? bursts : [null]) {
      const m = generateStudyMap(spec, b?.index ?? null);
      plans.push({ key: b ? `burst:${b.index}` : 'burst', caption: `${b && bursts.length > 1 ? `Burst ${b.index}: its` : 'The'} surveys and what links them. Click a survey to go to its questions.`, code: m.code, links: linksOf(m) });
    }
    if (plans.length) out[STUDY_MAP_KEY] = plans;
  }
  return out;
}

/** An interactive flowchart: the first view shown (and printed), the others switched to by clicking. */
function flowViewer(views: RenderedFlowView[], backLabel?: string): string {
  const links = Object.fromEntries(views.map((v) => [v.key, v.links]));
  const foldable = views.some((v) => v.key.startsWith('fold:'));
  return `<div class="cb-fv" data-fv-start="${esc(views[0]!.key)}" data-fv-links="${esc(JSON.stringify(links))}"><div class="cb-fv-bar cb-screen-only">${backLabel ? `<button type="button" data-fv-act="back" hidden>‹ ${esc(backLabel)}</button>` : ''}${foldable ? `<button type="button" data-fv-act="all"${views.some((v) => v.key === 'all') ? '' : ' hidden'}>Collapse all blocks</button><button type="button" data-fv-act="base" hidden>Expand all</button>` : ''}<span class="cb-fv-hint">Drag to move · Ctrl + scroll to zoom${foldable ? ' · click a block to fold it' : ''}</span><span class="cb-fv-zoom"><button type="button" data-fv-act="in" aria-label="Zoom in">+</button><button type="button" data-fv-act="out" aria-label="Zoom out">−</button><button type="button" data-fv-act="fit">Fit</button></span></div><div class="cb-fv-port">${views
    .map((v, i) => `<div class="cb-fv-stage${i ? ' cb-screen-only' : ''}" data-fv-view="${esc(v.key)}"${v.caption ? ` data-fv-caption="${esc(v.caption)}"` : ''}${i ? ' hidden' : ' data-fv-base'}>${v.svg}</div>`)
    .join('')}<div class="cb-fv-mini cb-screen-only" aria-hidden="true"><img alt=""><span class="cb-fv-mini-box"></span></div></div>${views[0]!.caption ? `<p class="cb-fv-caption">${esc(views[0]!.caption)}</p>` : ''}</div>`;
}

/** Which study maps a codebook shows: the whole study, then one burst (or each, when they differ). */
export function studyMapCodes(spec: StudySpec): Array<{ caption: string; code: string }> {
  const bursts = studyBursts(spec);
  const out: Array<{ caption: string; code: string }> = [];
  if (bursts.length > 1) out.push({ caption: 'The study: its bursts and the gaps between them.', code: generateStudyMap(spec).code });
  const same = bursts.every((b) => b.surveys.slice().sort().join() === bursts[0]!.surveys.slice().sort().join());
  const shown = bursts.length > 1 && same ? bursts.slice(0, 1) : bursts;
  for (const b of shown)
    out.push({
      caption: bursts.length > 1 && same ? `Each burst’s surveys and what links them (burst ${b.index} shown; the others are the same).` : bursts.length > 1 ? `Burst ${b.index}: its surveys and what links them.` : 'The surveys and what links them.',
      code: generateStudyMap(spec, b.index).code,
    });
  return out;
}

function scheduleHtml(spec: StudySpec, models: SurveyModel[], maps = ''): string {
  const s = buildStudySchedule(spec);
  const label = (name: string | null) => (name ? (models.find((m) => m.name === name)?.label ?? name) : 'NA');
  const bursts = studyBursts(spec);
  const days = s.firstDate && s.lastDate ? dayIndex(s.firstDate, s.lastDate) + 1 : 0;
  // Dates in a schedule are only an example, so the period is given in study days.
  return `${days ? `<p><strong>Study period:</strong> ${days} study days${bursts.length > 1 ? ` in ${bursts.length} bursts` : ''}${s.day1Weekday ? `, starting on a ${({ MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' } as const)[s.day1Weekday]}` : ''}</p>` : ''}${maps}
<table class="cb-table"><thead><tr><th>Schedule</th><th>Event</th><th>Survey</th><th>Window</th><th>Repeats</th><th>Timing</th></tr></thead><tbody>${s.events
    .map(
      (e) =>
        `<tr><td>${esc(e.scheduleName)}</td><td>${'&nbsp;&nbsp;'.repeat(e.depth)}${esc(e.title)}</td><td>${esc(label(e.surveyName))}</td><td>${esc(e.windowText)}</td><td>${esc(e.recurrenceText)}</td><td>${esc(
          [e.timingType, e.userSpecified ? 'participant-set' : null, e.trigger ? `trigger: ${e.trigger}` : null, e.intervention ? `decision point: ${e.intervention}` : null].filter(Boolean).join(', ') || 'NA',
        )}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

/** Nested TOC: every node with children folds; surveys and blocks start folded and show how many entries they hold. */
/** `openDepth`: levels shallower than this start unfolded (the table of contents shows two; the Sections menu none). */
function renderToc(nodes: TocNode[], openDepth = 2): string {
  interface T {
    node: TocNode;
    children: T[];
  }
  const root: T[] = [];
  const stack: Array<{ level: number; children: T[] }> = [{ level: 0, children: root }];
  for (const node of nodes) {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= node.level) stack.pop();
    const t: T = { node, children: [] };
    stack[stack.length - 1]!.children.push(t);
    stack.push({ level: node.level, children: t.children });
  }
  const leaves = (t: T): number => (t.children.length ? t.children.reduce((n, c) => n + leaves(c), 0) : 1);
  const render = (ts: T[], depth: number): string =>
    ts.length
      ? `<ul class="cb-toc-d${depth}">${ts
          .map((t) => {
            const kids = t.children.length > 0;
            const open = !kids || depth < openDepth;
            const count = kids && depth >= 2 ? `<span class="cb-toc-count">(${leaves(t)})</span>` : '';
            return `<li class="${kids ? 'has-children' : ''}${open ? '' : ' is-collapsed'}"><div class="cb-toc-row"><a href="#${t.node.id}">${esc(t.node.label)}</a>${count}${
              kids ? `<button class="cb-twisty" type="button" aria-expanded="${open}" aria-label="Show or hide ${esc(t.node.label)}">${open ? '▲' : '▼'}</button>` : ''
            }</div>${render(t.children, depth + 1)}</li>`;
          })
          .join('')}</ul>`
      : '';
  return render(root, 1);
}

function isEmpty(v: unknown): boolean {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0 || v.every(isEmpty);
  if (typeof v === 'object') return Object.values(v as object).every(isEmpty);
  return false;
}

function humanize(k: string): string {
  return k.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function renderValue(v: unknown): string {
  if (isEmpty(v)) return '';
  if (Array.isArray(v)) {
    if (v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const keys = [...new Set(v.flatMap((x) => Object.keys(x as object)))];
      return `<table class="cb-table"><thead><tr>${keys.map((k) => `<th>${esc(humanize(k))}</th>`).join('')}</tr></thead><tbody>${v
        .map((row) => `<tr>${keys.map((k) => `<td>${renderInline((row as Record<string, unknown>)[k])}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
    }
    return `<ul>${v.map((x) => `<li>${renderInline(x)}</li>`).join('')}</ul>`;
  }
  if (typeof v === 'object') {
    return `<ul>${Object.entries(v as object)
      .filter(([, x]) => !isEmpty(x))
      .map(([k, x]) => `<li><strong>${esc(humanize(k))}:</strong> ${typeof x === 'object' ? renderValue(x) : renderInline(x)}</li>`)
      .join('')}</ul>`;
  }
  return renderInline(v);
}

function renderInline(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(renderInline).join(', ');
  if (typeof v === 'object') return renderValue(v);
  const s = String(v);
  if (/^https?:\/\//.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>`;
  return esc(s);
}

/** @page rules: margins, running study title and page numbers. */
function printPageCss(title: string): string {
  const cssString = JSON.stringify(title.length > 80 ? `${title.slice(0, 79)}…` : title).replace(/</g, '\\3c ');
  return `@page{size:letter;margin:.75in .7in .8in;@top-left{content:${cssString};font:8.5pt Helvetica,Arial,sans-serif;color:#777}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8.5pt Helvetica,Arial,sans-serif;color:#777}}@page:first{@top-left{content:none}}`;
}

/** Theme -> CSS custom properties (hex colours only, so nothing else can reach the stylesheet). */
function themeCss(t: CodebookTheme): string {
  const accent = color(t.accent, '#2a5caa');
  const surface = color(t.surface, '#ffffff');
  const text = color(t.text, '#333333');
  const size = Math.min(24, Math.max(12, Number(t.fontSize) || 19));
  const ggplot = t.charts !== 'accent';
  const mix = (pct: number, a: string, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  return `:root{
--cb-accent:${accent};--cb-bg:${color(t.background, '#003d7a')};--cb-surface:${surface};--cb-header:${color(t.headerBg, '#f0f0f0')};--cb-text:${text};
--cb-muted:${mix(62, text, surface)};--cb-border:${mix(16, text, surface)};--cb-faint:${mix(6, text, surface)};--cb-accent-soft:${mix(10, accent, surface)};
--cb-font:${(CODEBOOK_FONTS[t.bodyFont] ?? CODEBOOK_FONTS.times!).stack};--cb-heading-font:${(CODEBOOK_FONTS[t.bodyFont] ?? CODEBOOK_FONTS.times!).stack};--cb-size:${size}px;
--cb-bar:${ggplot ? '#595959' : accent};--cb-panel:${ggplot ? '#EBEBEB' : 'transparent'};--cb-grid:${ggplot ? '#FFFFFF' : mix(12, text, surface)};--cb-axis:${ggplot ? '#4D4D4D' : mix(62, text, surface)};
--cb-count:${ggplot ? '#1e7b34' : accent};
}
`;
}

const CODEBOOK_JS = `
(function () {
  function setVisuals(id, open) {
    var panel = document.getElementById(id);
    if (!panel) return;
    if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    var btn = document.querySelector('[data-target="' + id + '"]');
    if (open) { drawFlowcharts(panel); setTimeout(function () { fvInitIn(panel); }, 0); }
    if (btn) { btn.setAttribute('aria-expanded', open); btn.querySelector('.cb-arrow').textContent = open ? '\\u25B2' : '\\u25BC'; }
  }
  // Flowcharts embedded as Mermaid code are drawn the first time their panel opens.
  function drawFlowcharts(root) {
    var pending = root.querySelectorAll('pre.cb-mermaid:not([data-drawn])');
    if (!pending.length || !window.mermaid) return;
    pending.forEach(function (el) { el.setAttribute('data-drawn', ''); el.classList.add('mermaid'); });
    window.mermaid.run({ nodes: pending });
  }

  // Interactive flowcharts (.cb-fv): drag to move, Ctrl+scroll or the buttons to zoom, a minimap,
  // and clickable blocks (fold/unfold), bursts (zoom in) and surveys (jump to their questions).
  // Every view is pre-rendered; clicking swaps which one is shown.
  function fvMatch(el, ids) {
    for (var n = el; n && n.tagName !== 'svg'; n = n.parentNode) {
      if (!n.getAttribute) continue;
      var id = n.getAttribute('id') || '', did = n.getAttribute('data-id') || '';
      for (var k in ids) if (id === k || did === k || id.indexOf('-' + k + '-') >= 0 || id.slice(-k.length - 1) === '-' + k) return ids[k];
    }
    return null;
  }
  function fvApply(st) {
    st.stage.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.k + ')';
    var mini = st.fv.querySelector('.cb-fv-mini img'), box = st.fv.querySelector('.cb-fv-mini-box');
    if (!mini || !mini.clientWidth || !st.w) return;
    var m = mini.clientWidth / st.w, pw = st.port.clientWidth, ph = st.port.clientHeight;
    box.style.left = (mini.offsetLeft + Math.max(0, -st.x / st.k * m)) + 'px';
    box.style.top = (mini.offsetTop + Math.max(0, -st.y / st.k * m)) + 'px';
    box.style.width = Math.min(mini.clientWidth, pw / st.k * m) + 'px';
    box.style.height = Math.min(mini.clientHeight, ph / st.k * m) + 'px';
  }
  function fvFit(st) {
    var pw = st.port.clientWidth, ph = st.port.clientHeight;
    st.k = Math.max(0.15, Math.min(1.1, (pw - 30) / st.w, (ph - 30) / st.h));
    if (st.h * st.k > ph - 30 && (pw - 30) / st.w > st.k) st.k = Math.min(1.1, (pw - 30) / st.w, 1);
    st.x = (pw - st.w * st.k) / 2;
    st.y = st.h * st.k < ph ? (ph - st.h * st.k) / 2 : 15;
    fvApply(st);
  }
  function fvShow(st, key) {
    var stages = st.fv.querySelectorAll('.cb-fv-stage'), next = null;
    stages.forEach(function (sg) { var on = sg.getAttribute('data-fv-view') === key; if (on) next = sg; if (on) sg.removeAttribute('hidden'); else sg.setAttribute('hidden', ''); });
    if (!next) return;
    st.view = key; st.stage = next;
    var svg = next.querySelector('svg');
    var vb = svg && svg.viewBox && svg.viewBox.baseVal;
    st.w = (vb && vb.width) || svg.getBoundingClientRect().width || 600;
    st.h = (vb && vb.height) || svg.getBoundingClientRect().height || 400;
    svg.setAttribute('width', st.w); svg.setAttribute('height', st.h); svg.style.maxWidth = 'none';
    var ids = st.links[key] || {};
    svg.querySelectorAll('g.node, g.cluster').forEach(function (g) { if (fvMatch(g, ids)) g.classList.add('cb-fv-link'); });
    var mini = st.fv.querySelector('.cb-fv-mini img');
    if (mini) mini.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    var cap = st.fv.querySelector('.cb-fv-caption'), c = next.getAttribute('data-fv-caption');
    if (cap && c) cap.textContent = c;
    var back = st.fv.querySelector('[data-fv-act="back"]'); if (back) back.hidden = key === st.start;
    var all = st.fv.querySelector('[data-fv-act="all"]'); if (all) all.hidden = key === 'all' || !st.links.all;
    var base = st.fv.querySelector('[data-fv-act="base"]'); if (base) base.hidden = key === 'base';
    fvFit(st);
  }
  function fvZoom(st, f, cx, cy) {
    var k = Math.max(0.1, Math.min(4, st.k * f)); f = k / st.k;
    st.x = cx - (cx - st.x) * f; st.y = cy - (cy - st.y) * f; st.k = k; fvApply(st);
  }
  function fvInit(fv) {
    var port = fv.querySelector('.cb-fv-port');
    if (!port || !port.clientWidth) return;
    if (fv._fv) { fvFit(fv._fv); return; }
    var st = { fv: fv, port: port, links: JSON.parse(fv.getAttribute('data-fv-links') || '{}'), start: fv.getAttribute('data-fv-start'), x: 0, y: 0, k: 1 };
    fv._fv = st;
    fvShow(st, st.start);
    var drag = null;
    port.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.cb-fv-mini')) { fvMini(st, e); return; }
      drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y, moved: false };
      port.setPointerCapture(e.pointerId);
    });
    port.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) { drag.moved = true; port.classList.add('is-dragging'); }
      st.x = drag.sx + e.clientX - drag.x; st.y = drag.sy + e.clientY - drag.y; fvApply(st);
    });
    port.addEventListener('pointerup', function (e) {
      var d = drag; drag = null; port.classList.remove('is-dragging');
      if (!d || d.moved) return;
      var target = fvMatch(document.elementFromPoint(e.clientX, e.clientY), st.links[st.view] || {});
      if (!target) return;
      if (target.indexOf('go:') === 0) go(target.slice(3)); else fvShow(st, target);
    });
    port.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return; // plain scrolling still scrolls the page
      e.preventDefault();
      var r = port.getBoundingClientRect();
      fvZoom(st, Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.002), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    fv.querySelector('.cb-fv-bar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fv-act]'); if (!b) return;
      var a = b.getAttribute('data-fv-act'), pw = port.clientWidth / 2, ph = port.clientHeight / 2;
      if (a === 'in') fvZoom(st, 1.25, pw, ph); else if (a === 'out') fvZoom(st, 0.8, pw, ph); else if (a === 'fit') fvFit(st);
      else if (a === 'back') fvShow(st, st.start); else fvShow(st, a);
    });
  }
  function fvMini(st, e) {
    var img = st.fv.querySelector('.cb-fv-mini img'), r = img.getBoundingClientRect(), m = img.clientWidth / st.w;
    var mx = (e.clientX - r.left) / m, my = (e.clientY - r.top) / m;
    st.x = st.port.clientWidth / 2 - mx * st.k; st.y = st.port.clientHeight / 2 - my * st.k; fvApply(st);
  }
  function fvInitIn(root) { (root || document).querySelectorAll('.cb-fv').forEach(fvInit); }
  function setSection(sec, open) {
    sec.classList.toggle('is-collapsed', !open);
    if (open) setTimeout(function () { fvInitIn(sec); }, 0);
    var b = sec.querySelector(':scope > h1 .cb-sec-toggle, :scope > h2 .cb-sec-toggle, :scope > h3 .cb-sec-toggle, :scope > .cb-block-head .cb-sec-toggle');
    if (b) { b.setAttribute('aria-expanded', open); b.textContent = open ? '\\u25B2' : '\\u25BC'; }
  }
  function setTocNode(li, open) {
    li.classList.toggle('is-collapsed', !open);
    var b = li.querySelector(':scope > .cb-toc-row > .cb-twisty');
    if (b) { b.setAttribute('aria-expanded', open); b.textContent = open ? '\\u25B2' : '\\u25BC'; }
  }
  // In-page links: reveal the target (open folded sections and panels), then scroll this window only,
  // so a page that embeds the codebook in a frame never moves.
  function go(id) {
    if (!id || id === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var el = document.getElementById(id);
    if (!el) return;
    for (var p = el.parentElement; p; p = p.parentElement) {
      if (p.classList && p.classList.contains('is-collapsed') && p.tagName === 'SECTION') setSection(p, true);
      if (p.hasAttribute && p.hasAttribute('hidden') && p.classList.contains('cb-visuals')) setVisuals(p.id, true);
    }
    var bar = document.querySelector('.cb-topbar');
    var offset = (bar ? bar.offsetHeight : 0) + 12;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
  }
  var menuBtn = document.querySelector('.cb-menu-btn'), menu = document.getElementById('cb-menu-list');
  function setMenu(open) { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', open); }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (menu && !t.closest('.cb-menu')) setMenu(false);
    var a = t.closest('a[href^="#"]');
    if (a) { e.preventDefault(); if (a.closest('.cb-menu-list')) setMenu(false); go(decodeURIComponent(a.getAttribute('href').slice(1))); return; }
    if (t.closest('.cb-menu-btn')) { setMenu(menu.hidden); return; }
    var sec = t.closest('.cb-sec-toggle');
    if (sec) { var s = sec.closest('section'); setSection(s, s.classList.contains('is-collapsed')); return; }
    var tw = t.closest('.cb-twisty');
    if (tw) { var li = tw.closest('li'); setTocNode(li, li.classList.contains('is-collapsed')); return; }
    var tt = t.closest('.cb-toc-toggle');
    if (tt) { var body = document.getElementById('cb-toc-body'); body.hidden = !body.hidden; tt.setAttribute('aria-expanded', !body.hidden); tt.querySelector('.cb-twisty-icon').textContent = body.hidden ? '\\u25BC' : '\\u25B2'; return; }
    var ta = t.closest('[data-toc]');
    if (ta) {
      var open = ta.getAttribute('data-toc') === 'expand';
      document.getElementById('cb-toc-body').hidden = false;
      document.querySelectorAll('.cb-toc li.has-children').forEach(function (li) { setTocNode(li, open || !li.parentNode.parentNode.closest('li')); });
      return;
    }
    var qh = t.closest('.cb-q-head');
    if (qh) { var qid = qh.getAttribute('data-target'); setVisuals(qid, document.getElementById(qid).hasAttribute('hidden')); return; }
    var vt = t.closest('.cb-toggle');
    if (vt) { var id = vt.getAttribute('data-target'); setVisuals(id, document.getElementById(id).hasAttribute('hidden')); return; }
    var tab = t.closest('.cb-tab');
    if (tab) {
      tab.parentNode.querySelectorAll('.cb-tab').forEach(function (b) { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
      tab.classList.add('is-active'); tab.setAttribute('aria-selected', 'true');
      var pane = document.getElementById(tab.getAttribute('data-tab'));
      pane.parentNode.querySelectorAll('.cb-pane').forEach(function (p) { p.classList.remove('is-active'); });
      pane.classList.add('is-active');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu) setMenu(false);
    var qh = (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.cb-q-head');
    if (qh) { e.preventDefault(); qh.click(); }
  });
  function focusBurst(key, on) {
    var svg = key.closest('svg');
    if (!svg) return;
    var k = on ? key.getAttribute('data-key') : null;
    svg.querySelectorAll('[data-burst]').forEach(function (el) { el.classList.toggle('is-dim', !!k && el.getAttribute('data-burst') !== k); });
    svg.querySelectorAll('.cb-burst-key').forEach(function (el) { el.classList.toggle('is-on', !!k && el === key); });
  }
  ['mouseover', 'focusin'].forEach(function (type) {
    document.addEventListener(type, function (e) { var key = e.target.closest && e.target.closest('.cb-burst-key'); if (key) focusBurst(key, true); });
  });
  ['mouseout', 'focusout'].forEach(function (type) {
    document.addEventListener(type, function (e) { var key = e.target.closest && e.target.closest('.cb-burst-key'); if (key && !key.contains(e.relatedTarget)) focusBurst(key, false); });
  });
  var top = document.getElementById('backToTopBtn');
  function onScroll() { top.classList.toggle('is-visible', window.scrollY > 400); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  fvInitIn(document);
  window.addEventListener('load', function () { fvInitIn(document); });
})();
`;

const CODEBOOK_CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cb-bg);color:var(--cb-text);font-family:var(--cb-font);font-size:var(--cb-size);line-height:1.5}
h1,h2,h3,h4,h5,h6{font-family:var(--cb-heading-font);font-weight:bold;line-height:1.2;color:var(--cb-text)}
p{margin:0 0 .6em}
a{color:var(--cb-accent);text-decoration:none}
a:hover{text-decoration:underline}
ul{margin:0 0 .8em}
code{font-size:.9em}

/* Sticky bar with the Sections menu */
.cb-topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 20px;background:var(--cb-surface);border-bottom:1px solid var(--cb-border);box-shadow:0 2px 6px rgba(0,0,0,.08);font-family:${"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"};font-size:14px}
.cb-topbar-title{color:var(--cb-text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.cb-menu{position:relative;flex-shrink:0}
.cb-menu-btn{font:inherit;font-weight:600;color:var(--cb-surface);background:var(--cb-accent);border:0;border-radius:6px;padding:6px 14px;cursor:pointer}
.cb-menu-list{position:absolute;right:0;top:calc(100% + 6px);width:min(340px,80vw);max-height:70vh;overflow:auto;background:var(--cb-surface);border:1px solid var(--cb-border);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:6px}
.cb-menu-list[hidden]{display:none}
.cb-menu-list a{display:block;padding:7px 10px;border-radius:5px;color:var(--cb-text)}
.cb-menu-list a:hover{background:var(--cb-accent-soft);text-decoration:none}
.cb-menu-tree ul{list-style:none;margin:0;padding:0}
.cb-menu-tree ul ul{padding-left:1em;margin:0 0 .2em;border-left:1px solid var(--cb-border);margin-left:.7em}
.cb-menu-tree li.is-collapsed > ul{display:none}
.cb-menu-tree .cb-toc-row{display:flex;align-items:center;gap:.2em}
.cb-menu-tree .cb-toc-row a{flex:1;min-width:0;padding:5px 8px}
.cb-menu-tree .cb-toc-d1 > li > .cb-toc-row a{font-weight:600}
.cb-menu-tree .cb-toc-count{flex:none}
.cb-menu-tree .cb-twisty{padding:4px 8px}

/* Content box */
.content{background:var(--cb-surface);max-width:960px;margin:24px auto 40px;padding:28px 44px 48px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.15)}
#header{text-align:center;margin-bottom:24px}
#header .title{font-size:2em;margin:8px 0 10px}
#header .author,#header .date{font-weight:normal;font-style:italic;font-size:1em;margin:4px 0;color:var(--cb-muted)}

/* Table of contents: part of the document (same font and link colour), arrows like "Click to view visuals" */
.cb-toc{margin:4px 0 32px}
.cb-toc-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid var(--cb-border)}
.cb-toc-toggle{font:inherit;font-family:var(--cb-heading-font);font-size:1.15em;font-weight:bold;color:var(--cb-text);background:none;border:0;padding:0;cursor:pointer}
.cb-toc-toggle .cb-twisty-icon{font-size:calc(var(--cb-size) * .8);color:var(--cb-accent);vertical-align:.2em;margin-left:.3em}
.cb-toc-actions{display:flex;gap:14px;font-size:.8em}
.cb-toc-actions button{font:inherit;color:var(--cb-accent);background:none;border:0;padding:0;cursor:pointer}
.cb-toc-actions button:hover{text-decoration:underline}
#cb-toc-body[hidden]{display:none}
.cb-toc ul{list-style:none;margin:0;padding:0}
.cb-toc ul ul{padding-left:1.5em;margin:.15em 0 .35em}
.cb-toc li.is-collapsed > ul{display:none}
.cb-toc-d1 > li{margin:.45em 0}
.cb-toc-row{display:flex;align-items:baseline;gap:.4em;padding:.08em 0}
.cb-toc-row a{color:var(--cb-accent);text-decoration:none}
.cb-toc-row a:hover{text-decoration:underline}
.cb-toc-d1 > li > .cb-toc-row a{font-weight:bold}
.cb-toc-d3 .cb-toc-row,.cb-toc-d4 .cb-toc-row,.cb-toc-d5 .cb-toc-row{font-size:.92em}
.cb-toc-count{font-size:.8em;color:var(--cb-muted)}
.cb-twisty{font:inherit;font-size:calc(var(--cb-size) * .8);line-height:1;color:var(--cb-accent);background:none;border:0;padding:0 .2em;cursor:pointer;align-self:center}
.cb-twisty:hover{opacity:.7}

/* Pages: rules + centred title, collapsible */
.cb-page{margin-top:8px}
hr{border:0;border-top:1px solid var(--cb-border);margin:18px 0}
.cb-page > h1{text-align:center;font-size:1.75em;margin:0}
.cb-page h2{font-size:1.4em;margin:26px 0 10px}
.cb-page h3{font-size:1.15em;margin:24px 0 10px}
.cb-sec-toggle{font:inherit;font-size:calc(var(--cb-size) * .8);font-weight:normal;vertical-align:.2em;margin-left:.5em;padding:0 .2em;border:0;background:none;color:var(--cb-accent);cursor:pointer}
.cb-sec-toggle:hover{opacity:.7}
section.is-collapsed > .cb-sec-body{display:none}
.cb-block-head .cb-sec-toggle{font-size:calc(var(--cb-size) * .7)}

.cb-survey-name{padding-bottom:6px;border-bottom:2px solid var(--cb-accent)}
.cb-prose{max-width:72ch}
.cb-logo{display:block;max-height:96px;max-width:260px;margin:0 auto 10px;object-fit:contain}
.cb-figure{margin:14px 0 18px}
.cb-figure-img{display:block;max-width:100%;height:auto;border-radius:6px;border:1px solid var(--cb-border)}
.cb-video{display:block;width:100%;max-width:760px;aspect-ratio:16/9;border:0;border-radius:6px;background:#000}
.cb-attach{margin:10px 0 18px}
.cb-attach-dl{margin-left:8px;font-size:.85em}
.cb-attach-text{white-space:pre-wrap;max-height:420px;overflow:auto;font-size:.82em;background:var(--cb-header);border:1px solid var(--cb-border);border-radius:6px;padding:10px 12px}
.cb-mock-wrap{display:flex;justify-content:center;padding:6px 0}
.cb-mock-wrap svg{width:min(300px,100%);height:auto}
.cb-study-name{font-family:var(--cb-heading-font);font-size:1.7em;font-weight:700;line-height:1.2;margin:.3em 0 .5em}
.cb-small{font-size:.82em;color:var(--cb-muted)}

/* Variable pages */
.cb-var{margin:0 0 6px}
.header-shading{background:var(--cb-header);padding:10px 14px 12px;margin:18px 0 12px;border-radius:5px}
.header-shading h4{margin:0;font-size:1.05em;line-height:1.35}
.item-id{display:block;margin-top:3px;font-weight:bold;color:var(--cb-accent)}
.cb-anchor{margin-left:2em}
.cb-anchor > p{margin:0 0 .45em}
.cb-cond{font-size:.86em;line-height:1.5;margin:.2em 0 .9em;color:var(--cb-text)}
.cb-cond-tag{display:inline-block;font-size:.78em;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;color:var(--cb-accent);background:var(--cb-accent-soft);border-radius:3px;padding:.05em .45em;margin-right:.35em;vertical-align:.08em}
.cb-cond-q{color:var(--cb-muted)}
.cb-block{margin:26px 0 18px;border:1px solid var(--cb-border);border-left:4px solid var(--cb-accent);border-radius:6px;background:color-mix(in srgb,var(--cb-accent) 3%,var(--cb-surface))}
.cb-block-head{padding:10px 16px 8px;border-bottom:1px solid var(--cb-border);background:var(--cb-accent-soft);border-radius:0 5px 0 0}
.cb-block-head h3{margin:0;font-size:1.12em}
.cb-block-tag{display:block;font-size:.68em;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:var(--cb-accent);margin-bottom:1px}
.cb-block-head .cb-cond{margin:.35em 0 0}
.cb-block > .cb-sec-body{padding:2px 16px 10px}
.cb-block .cb-block{margin:18px 0 12px}
.cb-block.is-collapsed .cb-block-head{border-bottom:0}
.cb-numstats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;margin:6px 0 14px;max-width:560px;border:1px solid var(--cb-border);border-radius:6px;overflow:hidden}
.cb-numstats div{padding:6px 10px;border-right:1px solid var(--cb-border)}
.cb-numstats div:last-child{border-right:0}
.cb-numstats dt{font-size:.68em;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:var(--cb-muted)}
.cb-numstats dd{margin:0;font-size:1.05em;font-variant-numeric:tabular-nums}
.cb-toggle{font:inherit;font-weight:bold;font-size:.92em;color:var(--cb-accent);background:none;border:0;padding:0;margin:.3em 0 .6em;cursor:pointer}
.cb-toggle:hover{text-decoration:underline}
.cb-arrow{font-size:calc(var(--cb-size) * .8)}
.cb-visuals{margin:0 0 1em}
.cb-q-sub{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25em 1em;margin-top:3px}
.cb-q-sub .item-id{display:inline;margin-top:0}
.cb-q-meta{font-size:.85em;font-weight:normal;color:var(--cb-muted)}
.cb-q-head{display:flex;align-items:flex-start;gap:12px;cursor:pointer;user-select:none;transition:box-shadow .15s}
.cb-q-head h4{flex:1;min-width:0}
.cb-q-head:hover{box-shadow:inset 0 0 0 1px var(--cb-border)}
.cb-q-head:focus-visible{outline:2px solid var(--cb-accent);outline-offset:2px}
.cb-q-arrow{font-size:.75em;color:var(--cb-accent);padding-top:.25em}
.cb-q-body{margin-top:.4em}
.cb-visuals[hidden]{display:none}
.cb-visuals-title{font-size:1.1em;margin:.4em 0 .6em}
.cb-flow{margin:4px 0 12px}
.cb-flowchart{border:1px solid var(--cb-border);border-radius:6px;padding:10px;background:#fff;overflow:auto}
.cb-flowchart svg{max-width:100%;height:auto}
.cb-study-map{margin:1em 0 1.4em}
.cb-fv{border:1px solid var(--cb-border);border-radius:6px;background:#fff;color:#1e293b}
.cb-fv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--cb-border);font-size:.85em}
.cb-fv-bar button{font:inherit;border:1px solid #cbd5e1;background:#fff;color:#1e293b;border-radius:5px;padding:2px 9px;cursor:pointer}
.cb-fv-bar button:hover{background:#f1f5f9}
.cb-fv-hint{color:#64748b}
.cb-fv-zoom{margin-left:auto;display:inline-flex;gap:4px}
.cb-fv-port{position:relative;height:min(70vh,620px);overflow:hidden;cursor:grab;touch-action:none;user-select:none}
.cb-fv-port.is-dragging{cursor:grabbing}
.cb-fv-stage{position:absolute;left:0;top:0;transform-origin:0 0}
.cb-fv-stage[hidden]{display:none}
.cb-fv-stage svg{max-width:none!important;display:block}
.cb-fv .cb-fv-link{cursor:pointer}
.cb-fv .cb-fv-link:hover rect,.cb-fv .cb-fv-link:hover polygon,.cb-fv .cb-fv-link:hover path.basic{stroke:#2563eb!important;stroke-width:2.5px!important}
.cb-fv-mini{position:absolute;right:8px;bottom:8px;width:150px;background:rgba(255,255,255,.92);border:1px solid #cbd5e1;border-radius:5px;padding:4px;cursor:pointer}
.cb-fv-mini img{display:block;width:100%;height:auto;max-height:180px;object-fit:contain}
.cb-fv-mini-box{position:absolute;border:1.5px solid #2563eb;background:rgba(37,99,235,.08);pointer-events:none}
.cb-fv-caption{font-size:.85em;color:var(--cb-muted);margin:.4em .6em .5em}
.cb-study-map figcaption{font-size:.85em;color:var(--cb-muted);margin-top:.4em}
.cb-screenshot{max-width:320px;border:1px solid var(--cb-border)}

/* Tabs (Bootstrap-style, like the prior codebook) */
.cb-tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--cb-border);margin-bottom:12px}
.cb-tab{font:inherit;font-size:.9em;color:var(--cb-accent);background:none;border:1px solid transparent;border-radius:4px 4px 0 0;padding:8px 14px;margin-bottom:-1px;cursor:pointer}
.cb-tab:hover{background:var(--cb-faint)}
.cb-tab.is-active{color:var(--cb-text);background:var(--cb-surface);border-color:var(--cb-border) var(--cb-border) var(--cb-surface)}
.cb-pane{display:none}
.cb-pane.is-active{display:block}
.cb-print-only{display:none}
.cb-print-line{display:none}

/* Tables */
.cb-table{width:100%;border-collapse:collapse;margin:4px 0 16px;font-size:.92em}
.cb-table th{text-align:left;border-bottom:2px solid var(--cb-border);padding:7px 10px;vertical-align:bottom}
.cb-table td{border-top:1px solid var(--cb-border);padding:7px 10px;vertical-align:top}
.cb-table tbody tr:nth-child(even) td{background:var(--cb-faint)}
.cb-options{max-width:560px}
.cb-count{color:var(--cb-count);white-space:nowrap}

/* Charts */
.cb-chart{width:100%;max-width:760px;height:auto;display:block;font-family:Helvetica,Arial,sans-serif}
.cb-chart .cb-bar{fill:var(--cb-bar)}
.cb-chart .cb-panel{fill:var(--cb-panel)}
.cb-chart .cb-grid{stroke:var(--cb-grid)}
.cb-chart .cb-axis{fill:var(--cb-axis);font-size:11px}
.cb-chart .cb-axis-title{fill:var(--cb-text);font-size:12px}
.cb-chart .cb-chart-title{fill:var(--cb-text);font-size:13px}
.cb-chart .cb-line{fill:none;stroke:var(--cb-bar);stroke-width:2}
.cb-chart .cb-dot{fill:var(--cb-bar)}
.cb-chart .cb-box{fill:var(--cb-accent-soft);stroke:var(--cb-bar);stroke-width:1.5}
.cb-chart .cb-median{stroke:var(--cb-text);stroke-width:2.5}
.cb-chart .cb-whisker{stroke:var(--cb-muted);stroke-width:1.5}
.cb-chart .cb-fence{stroke:#c0392b;stroke-width:1;stroke-dasharray:4 3}
.cb-chart .cb-dot-in{fill:var(--cb-bar);opacity:.45}
.cb-chart .cb-dot-out{fill:#c0392b}
.cb-chart .cb-dot-burst{opacity:.85}
.cb-chart .cb-span{opacity:.85}
.cb-chart [data-burst]{transition:opacity .15s}
.cb-chart [data-burst].is-dim{opacity:.08}
.cb-burst-key{cursor:pointer;outline:none}
.cb-burst-key.is-on text{font-weight:700}
.cb-burst-key:focus-visible circle{stroke:var(--cb-text);stroke-width:2}
.cb-chart .cb-density{fill:var(--cb-accent);opacity:.14;stroke:var(--cb-accent);stroke-opacity:.5}
.cb-chart-h{font-size:.95em;margin:16px 0 6px}
/* Missingness summary tiles */
.cb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:8px 0 14px}
.cb-stat{display:grid;gap:3px;padding:10px 12px;border:1px solid var(--cb-border);border-radius:6px;background:var(--cb-faint)}
.cb-stat-l{font-size:.72em;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:var(--cb-muted)}
.cb-stat-n{font-size:1.35em;font-weight:bold;font-variant-numeric:tabular-nums;line-height:1.2}
.cb-stat-sub{font-size:.78em;color:var(--cb-muted)}
.cb-meter{display:block;height:6px;border-radius:3px;background:var(--cb-border);overflow:hidden;margin:2px 0}
.cb-meter > span{display:block;height:100%;background:var(--cb-bar)}
.cb-compact{font-size:.85em;max-width:620px}
.cb-compact th,.cb-compact td{padding:5px 8px}

/* Back to top */
#backToTopBtn{position:fixed;bottom:20px;right:20px;z-index:30;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-size:20px;background:var(--cb-surface);color:var(--cb-text);border:1px solid var(--cb-border);box-shadow:0 2px 6px rgba(0,0,0,.25);text-decoration:none;opacity:0;pointer-events:none;transition:opacity .2s}
#backToTopBtn.is-visible{opacity:1;pointer-events:auto}
#backToTopBtn:hover{background:var(--cb-accent);color:#fff;text-decoration:none}

@media (max-width:760px){
  .content{margin:0;border-radius:0;padding:18px 16px 40px}
  .cb-anchor{margin-left:.6em}
  .cb-topbar{padding:8px 12px}
}
@media print{
  .cb-fv{border:0}.cb-fv-port{height:auto;overflow:visible;cursor:auto}.cb-fv-stage{position:static;transform:none!important}
  .cb-fv-stage:not([data-fv-base]){display:none!important}.cb-fv-stage[data-fv-base]{display:block!important}.cb-fv-stage svg{max-width:100%!important;height:auto}
  /* A light, compact document whatever the screen theme. */
  :root{--cb-bg:#fff;--cb-surface:#fff;--cb-text:#1f1f1f;--cb-muted:#5f5f5f;--cb-border:#cfcfcf;--cb-faint:#f6f6f6;--cb-header:#eeeeee;--cb-size:10.5pt}
  html,body{background:#fff !important;font-size:10.5pt;line-height:1.4}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cb-topbar,#backToTopBtn,.cb-toggle,.cb-q-arrow,.cb-tabs,.cb-sec-toggle,.cb-twisty,.cb-twisty-icon,.cb-toc-actions,.cb-screen-only,.cb-visuals-title,.cb-miss-title{display:none !important}
  .content{margin:0;max-width:none;padding:0;box-shadow:none;border-radius:0;background:#fff}
  #header{margin-bottom:18pt}
  #header .title{font-size:20pt}
  /* Everything that folds on screen is open on paper. */
  #cb-toc-body[hidden],.cb-visuals[hidden]{display:block}
  .cb-toc li.is-collapsed > ul,section.is-collapsed > .cb-sec-body{display:block}
  .cb-pane{display:block}
  /* Contents in two columns. */
  .cb-toc{border:0;background:none;padding:0;font-size:9.5pt}
  .cb-toc-head{border-bottom:1px solid var(--cb-border)}
  #cb-toc-body > ul{columns:2;column-gap:28pt}
  .cb-toc-row{break-inside:avoid}
  .cb-toc-row a{color:var(--cb-text)}
  /* Pages and surveys start on a new sheet. */
  .cb-page{break-before:page}
  .cb-page > h1{font-size:16pt}
  .cb-page h2{font-size:13pt;margin:14pt 0 6pt}
  .cb-survey{break-before:page}
  .cb-page > .cb-sec-body > .cb-survey:first-child{break-before:auto}
  .cb-survey-name{font-size:14pt}
  /* Blocks: a thin rule on the left instead of a framed panel. */
  .cb-block{border:0;border-left:3pt solid var(--cb-accent);border-radius:0;background:none;margin:14pt 0 10pt}
  .cb-block-head{background:none;border-bottom:1px solid var(--cb-border);padding:2pt 0 4pt 10pt;break-after:avoid}
  .cb-block > .cb-sec-body{padding:0 0 0 10pt}
  .cb-block-head h3{font-size:12pt}
  /* Variables: compact header that stays with its content. */
  .cb-var{margin:0 0 8pt}
  .header-shading{padding:5pt 8pt;margin:10pt 0 5pt;border-radius:3pt;break-after:avoid;break-inside:avoid}
  .header-shading h4{font-size:11pt}
  .cb-anchor{margin-left:10pt}
  .cb-q-body{margin-top:2pt}
  .cb-print-line{display:block}
  .cb-print-only{display:block;font-size:9.5pt;text-transform:uppercase;letter-spacing:.05em;color:var(--cb-muted);margin:8pt 0 3pt;break-after:avoid}
  .cb-cond{margin:0 0 4pt}
  /* Charts and tables at a readable size, never split across pages. */
  .cb-chart{max-width:4.6in;max-height:2.6in;break-inside:avoid}
  /* Charts are drawn 760 units wide and shrink to about 4.6in on paper: enlarge their text to match. */
  .cb-chart .cb-axis{font-size:16px}
  .cb-chart .cb-axis-title{font-size:17px}
  .cb-chart .cb-chart-title{font-size:18px}
  /* Box plots: the box, whiskers and flagged points carry the information; thousands of in-range dots only add file size. */
  .cb-boxplot .cb-dot-in{display:none}
  .cb-chart[aria-label="Surveys by day since first survey"]{max-width:6.6in;max-height:5in}
  .cb-flowchart svg{max-width:100% !important;max-height:8.5in}
  .cb-table{font-size:9.5pt;width:auto;min-width:60%}
  .cb-table th,.cb-table td{padding:3pt 10pt 3pt 6pt}
  .cb-table tr,.cb-stats,.cb-numstats,.cb-flowchart{break-inside:avoid}
  .cb-stats{grid-template-columns:repeat(4,1fr);gap:5pt;margin:4pt 0 6pt}
  .cb-stat{padding:4pt 6pt}
  .cb-stat-n{font-size:12pt}
  .cb-numstats{margin:3pt 0 6pt;max-width:4.6in}
  .cb-numstats div{padding:3pt 6pt}
  .cb-small{font-size:8.5pt}
  a{color:inherit;text-decoration:none}
}`;
