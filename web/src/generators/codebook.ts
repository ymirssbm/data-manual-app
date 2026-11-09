// Spec -> self-contained codebook HTML, laid out like the prior R Markdown
// codebook: title block, table of contents, then <hr>-ruled pages (Title Page,
// Abstract Page, Executive Summary, Variable List) and, per survey, a shaded
// header per variable with indented field lines and a "Click to view visuals"
// panel (Frequency Table / Barplot / Missingness / Screenshots tabs).
// Additions: a sticky "Sections" menu, a collapsible TOC (every node folds),
// collapsible pages/surveys/blocks, and colour/font themes. One file with
// inline CSS + a little inline JS; prints to PDF with everything expanded.
import {
  blockPath,
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
import { buildStudySchedule } from './schedule';
import { generateFlowchart } from './flowchart';
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
  nameOfStudy: boolean;
  authors: boolean;
  studyMetadata: boolean;
  funding: boolean;
  abstract: boolean;
  executiveSummary: boolean;
  studySchedule: boolean;
  /** Enrollment over time and surveys by day since first survey (needs response data). */
  participationPlots: boolean;
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
  missingness: boolean;
  /** Response-rate plots (by participant, over time) on the Missingness tab. */
  missingnessPlots: boolean;
  /** Outlier screen (box plot + flagged values) for numeric items. */
  outlierPlots: boolean;
  screenshots: boolean;
}

export const DEFAULT_CODEBOOK_OPTIONS: CodebookOptions = {
  // Title page off by default; switch it on in the generator's Content tab.
  nameOfStudy: false,
  authors: false,
  studyMetadata: false,
  funding: false,
  abstract: true,
  executiveSummary: true,
  studySchedule: true,
  participationPlots: true,
  flowcharts: true,
  dataTypes: [...QUESTION_TYPES],
  deliveryType: true,
  typeOfData: true,
  responseOptions: true,
  skipLogic: true,
  frequencyTable: true,
  barPlot: true,
  histograms: true,
  missingness: true,
  missingnessPlots: true,
  outlierPlots: true,
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
  const fams = [...new Set([t.bodyFont, t.headingFont].map((f) => CODEBOOK_FONTS[f]?.google).filter((g): g is string => !!g))];
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
    theme: { accent: '#2f7d5b', background: '#1f3d31', surface: '#ffffff', headerBg: '#eef5f0', text: '#1d2a23', bodyFont: 'serif', headingFont: 'sans', fontSize: 17, charts: 'accent', expandVisuals: false },
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
  abstract?: string;
  summary?: string;
}

export interface CodebookExtras {
  /** Pre-rendered flowchart SVG markup keyed by Survey.Name (rendering needs a DOM). */
  flowchartSvgs?: Record<string, string>;
  /**
   * Without a DOM (the MCP server), embed each flowchart's Mermaid code and let the codebook draw it
   * when opened, with Mermaid loaded from a CDN. Needs internet when the codebook is viewed.
   */
  flowchartsInBrowser?: boolean;
  generatedAt?: Date;
  theme?: Partial<CodebookTheme>;
}

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
  const page = (label: string, body: string, cls = '') => {
    const id = entry(label, 1);
    return `<section class="cb-page ${cls}"><hr><h1 id="${id}">${esc(label)}${caret(label)}</h1><hr><div class="cb-sec-body">${body}</div></section>`;
  };
  const out: string[] = [];

  // ---- Title page (heading registered first so its subsections nest under it in the TOC)
  const overview = dataOverview(spec);
  const tocMark = toc.length;
  const titleId = entry('Title Page', 1);
  const titleParts: string[] = [];
  const h2 = (label: string) => `<h2 id="${entry(label, 2)}">${esc(label)}</h2>`;
  if (o.nameOfStudy) titleParts.push(h2('Name of study'), `<p>${esc(meta['Study.Name'])}</p>`);
  if (o.authors && authors) titleParts.push(h2('Authors'), `<p>${esc(authors)}</p>`);
  if (o.studyMetadata) {
    const block = studyMetadataHtml(spec, overview);
    if (block) titleParts.push(h2('Study Metadata'), block);
  }
  if (o.funding && funding) titleParts.push(h2('Funding source'), `<p>${esc(funding)}</p>`);
  if (titleParts.length) {
    out.push(`<section class="cb-page"><hr><h1 id="${titleId}">Title Page${caret('Title Page')}</h1><hr><div class="cb-sec-body">${titleParts.join('\n')}</div></section>`);
  } else toc.splice(tocMark, 1);

  if (o.abstract && abstract) out.push(page('Abstract Page', `<p class="cb-prose">${esc(abstract)}</p>`));
  if (o.executiveSummary) {
    const summary = text.summary?.trim();
    out.push(page('Executive Summary', summary ? `<p class="cb-prose">${esc(summary)}</p>` : autoSummary(models, overview)));
  }
  if (o.studySchedule && spec.schedules.length) out.push(page('Study Schedule', scheduleHtml(spec, models)));
  if (o.participationPlots && hasResponseData(spec)) {
    const enrolled = enrollment(spec);
    const tl = surveyTimeline(spec);
    if (enrolled.length && tl) {
      out.push(
        page(
          'Participation',
          `<h4 class="cb-chart-h">Enrollment over time</h4>${enrollmentSvg(enrolled)}<p class="cb-small">Cumulative participants by the date of their first completed survey (${enrolled.length} participants, ${esc(enrolled[0]!.date)} to ${esc(enrolled[enrolled.length - 1]!.date)}).</p>
<h4 class="cb-chart-h">Surveys by day since first survey</h4>${timelineSvg(tl)}<p class="cb-small">Each row is a participant (in enrollment order) and each dot a completed survey. The shaded curve shows how many surveys were completed on each day.${
            tl.bursts > 1 ? ' Colors mark measurement bursts: a gap of more than a week starts a new burst.' : ''
          }</p>`,
        ),
      );
    }
  }

  // ---- Variable list: survey > block > variable, each level collapsible
  const included = new Set(o.dataTypes);
  const responses = hasResponseData(spec) ? indexResponses(spec) : null;
  const varTocMark = toc.length;
  const varId = entry('Variable List', 1);
  const surveysHtml: string[] = [];
  for (const m of models) {
    const sid = entry(m.label, 2, m.label);
    const parts: string[] = [];
    const svg = extras.flowchartSvgs?.[m.name];
    const lazy = !svg && extras.flowchartsInBrowser ? `<pre class="cb-mermaid">${esc(generateFlowchart(m.survey))}</pre>` : '';
    if (o.flowcharts && (svg || lazy)) {
      const pid = `flow-${slug(m.name)}`;
      parts.push(`<div class="cb-anchor cb-flow">${toggleButton(pid, 'Click to view survey flowchart', t.expandVisuals)}<div id="${pid}" class="cb-visuals" ${t.expandVisuals ? '' : 'hidden'}><div class="cb-flowchart">${svg ?? lazy}</div></div></div>`);
    }
    type OpenBlock = { path: string; items: string[]; id: string; note: string };
    let openBlock = null as OpenBlock | null;
    // Read through a function: TypeScript otherwise narrows openBlock to null after closeBlock() calls.
    const current = (): OpenBlock | null => openBlock;
    const closeBlock = () => {
      if (!openBlock) return;
      parts.push(
        `<section class="cb-block"><h3 id="${openBlock.id}">Block: ${esc(openBlock.path)}${caret(`Block: ${openBlock.path}`)}</h3><div class="cb-sec-body">${openBlock.note}${openBlock.items.join('\n')}</div></section>`,
      );
      openBlock = null;
    };
    for (const q of m.survey.questions ?? []) {
      if (isEndBlock(q) || isBlock(q)) continue;
      if (!isQuestion(q) || !included.has(q['Question.Type.Display.Name'])) continue;
      const path = included.has('Block') ? blockPath(m, q).join(' › ') : '';
      if (path !== (current()?.path ?? '')) {
        closeBlock();
        if (path) {
          const blockItem = m.byId.get(q.Parent ?? '');
          openBlock = { path, items: [], id: entry(`Block: ${path}`, 3, `${m.label} block ${path}`), note: blockItem && o.skipLogic ? skipNote(m, blockItem['Item.ID']) : '' };
        }
      }
      const stats = responses ? describeItem(q, responses.get(q['Question.ID']), overview?.participants ?? 0) : null;
      const html = variablePage(m, q, o, t, stats, entry(stripHtml(q['Question.Text'] ?? '') || itemLabel(q), path ? 4 : 3, `${m.name} ${q['Item.ID']}`), spec.screenshotsURL);
      const ob = current();
      if (ob) ob.items.push(html);
      else parts.push(html);
    }
    closeBlock();
    surveysHtml.push(`<section class="cb-survey"><h2 id="${sid}" class="cb-survey-name">${esc(m.label)}${caret(m.label)}</h2><div class="cb-sec-body">${parts.join('\n')}</div></section>`);
  }
  if (models.length) out.push(`<section class="cb-page"><hr><h1 id="${varId}">Variable List${caret('Variable List')}</h1><hr><div class="cb-sec-body">${surveysHtml.join('\n')}</div></section>`);
  else toc.splice(varTocMark, 1);

  const menu = toc
    .filter((n) => n.level <= 2)
    .map((n) => `<a class="cb-menu-l${n.level}" href="#${n.id}">${esc(n.label)}</a>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${fontLinks(t)}<style>${themeCss(t)}${CODEBOOK_CSS}</style>
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
<h1 class="title">${esc(title)}</h1>
<h4 class="date">Codebook Generated ${esc(generated)}</h4>
</div>
<nav id="TOC" class="cb-toc" aria-label="Table of contents">
<div class="cb-toc-head">
<button class="cb-toc-toggle" type="button" aria-expanded="true" aria-controls="cb-toc-body">Table of Contents <span class="cb-twisty-icon">▲</span></button>
<span class="cb-toc-actions"><button type="button" data-toc="expand">Expand all</button><button type="button" data-toc="collapse">Collapse all</button></span>
</div>
<div id="cb-toc-body">${renderToc(toc)}</div>
</nav>
${out.join('\n')}
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

function toggleButton(targetId: string, label: string, open: boolean): string {
  return `<button class="cb-toggle" type="button" data-target="${targetId}" aria-expanded="${open}">${esc(label)} <span class="cb-arrow">${open ? '▲' : '▼'}</span></button>`;
}

function skipNote(m: SurveyModel, itemId: string): string {
  const branches = m.branchesTo.get(itemId) ?? [];
  if (!branches.length) return '';
  const parts = branches.map((b) => {
    const parent = m.byId.get(b.parentId);
    const ptext = parent ? itemLabel(parent) : b.parentId;
    const answer = b.definitions.length ? ` with ${b.definitions.map((d) => `<em>${esc(d)}</em>`).join(' or ')}` : b.condition ? ` (${esc(b.condition)})` : '';
    return `question <em>${esc(parent?.['Question.ID'] ?? b.parentId)}</em>: <em>${esc(ptext)}</em>${answer}`;
  });
  const what = m.byId.get(itemId) && isBlock(m.byId.get(itemId)!) ? 'block' : 'question';
  return `<div class="cb-note"><strong>Note:</strong> This ${what} is only delivered if participant answered ${parts.join('; or ')}.</div>`;
}

function variablePage(m: SurveyModel, q: Question, o: CodebookOptions, t: CodebookTheme, stats: ItemDescriptives | null, id: string, screenshotsURL: string | undefined): string {
  const text = stripHtml(q['Question.Text'] ?? '') || itemLabel(q);
  const lines: string[] = [];
  if (o.skipLogic) lines.push(skipNote(m, q['Item.ID']));
  // Delivery and data type sit in the question header as one quiet line ("Multiple Choice • Integer").
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const meta = [o.deliveryType ? q['Question.Type.Display.Name'] : '', o.typeOfData && q['Data.Type'] ? cap(q['Data.Type']) : ''].filter(Boolean);
  // Everything else opens by clicking the question header.
  const body: string[] = [];
  if (q['Question.Description']) body.push(`<p><strong>Description:</strong> ${esc(q['Question.Description'])}</p>`);
  const opts = responseOptions(q);
  if (o.responseOptions && opts.length && !stats?.frequencies) {
    body.push(
      `<table class="cb-table cb-options"><thead><tr><th>Value</th><th>Label</th></tr></thead><tbody>${opts
        .map((r) => `<tr><td>${esc(r.value)}</td><td>${esc(r.label)}</td></tr>`)
        .join('')}</tbody></table>`,
    );
  }

  const tabs: Array<{ name: string; html: string }> = [];
  if (stats?.frequencies && o.frequencyTable) tabs.push({ name: 'Frequency Table', html: frequencyTableHtml(stats) });
  if (stats?.frequencies && o.barPlot) tabs.push({ name: 'Barplot', html: barplotSvg(text, stats.frequencies) });
  if (stats?.numeric && o.histograms) tabs.push({ name: 'Histogram', html: histogramHtml(stats) });
  if (stats && o.missingness) tabs.push({ name: 'Missingness', html: missingnessHtml(q, stats, m, o.missingnessPlots) });
  if (stats?.outliers && o.outlierPlots) tabs.push({ name: 'Outliers', html: outliersHtml(stats) });
  if (o.screenshots && screenshotsURL) {
    const base = screenshotsURL.replace(/\/+$/, '');
    tabs.push({
      name: 'Screenshots',
      html: `<img class="cb-screenshot" alt="Screenshot of ${esc(q['Item.ID'])}" src="${esc(`${base}/${encodeURIComponent(q['Item.ID'])}.png`)}" onerror="this.replaceWith(Object.assign(document.createElement('p'),{textContent:'No screenshot available.'}))">`,
    });
  }
  const vid = `vis-${id}`;
  if (tabs.length) {
    body.push(`<h3 class="cb-visuals-title">Descriptives</h3>
<div class="cb-tabs" role="tablist">${tabs.map((tab, i) => `<button type="button" role="tab" class="cb-tab${i === 0 ? ' is-active' : ''}" data-tab="${vid}-${i}" aria-selected="${i === 0}">${esc(tab.name)}</button>`).join('')}</div>
${tabs.map((tab, i) => `<div class="cb-pane${i === 0 ? ' is-active' : ''}" id="${vid}-${i}" role="tabpanel"><h4 class="cb-print-only">${esc(tab.name)}</h4>${tab.html}</div>`).join('')}`);
  }
  const open = t.expandVisuals;
  const foldable = body.length > 0;
  if (foldable) lines.push(`<div id="${vid}" class="cb-visuals cb-q-body" ${open ? '' : 'hidden'}>${body.join('\n')}</div>`);

  const head = `<h4 id="${id}">${esc(text)}<span class="cb-q-sub"><span class="item-id">[${esc(q['Item.ID'])}]</span>${
    meta.length ? `<span class="cb-q-meta">${meta.map(esc).join(' • ')}</span>` : ''
  }</span></h4>${foldable ? `<span class="cb-arrow cb-q-arrow" aria-hidden="true">${open ? '▲' : '▼'}</span>` : ''}`;
  return `<div class="cb-var">
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

function missingnessHtml(q: Question, s: ItemDescriptives, m: SurveyModel, plots: boolean): string {
  const r2 = (x: number) => Number(x.toFixed(2));
  const pct = s.delivered ? (s.answered / s.delivered) * 100 : 0;
  const conditional = (m.branchesTo.get(q['Item.ID'])?.length ?? 0) > 0 || s.participants < s.totalParticipants;
  const mm = s.missingness;
  const tiles = [
    `<div class="cb-stat"><span class="cb-stat-l">Answered / Delivered</span><span class="cb-stat-n">${s.answered} / ${s.delivered}</span><span class="cb-meter"><span style="width:${pct.toFixed(1)}%"></span></span><span class="cb-stat-sub">${pct.toFixed(1)}% response rate</span></div>`,
    `<div class="cb-stat"><span class="cb-stat-l">Missing</span><span class="cb-stat-n">${s.missing}</span><span class="cb-stat-sub">${s.delivered ? ((s.missing / s.delivered) * 100).toFixed(1) : '0'}% of deliveries</span></div>`,
    `<div class="cb-stat"><span class="cb-stat-l">Participants</span><span class="cb-stat-n">${s.participants}${s.totalParticipants ? ` / ${s.totalParticipants}` : ''}</span><span class="cb-stat-sub">${conditional ? (s.participants >= s.totalParticipants ? 'all were delivered this item' : 'were delivered this item') : 'delivered this item'}</span></div>`,
    mm ? `<div class="cb-stat"><span class="cb-stat-l">Missingness ICC</span><span class="cb-stat-n">${mm.icc == null ? 'NA' : r2(mm.icc)}</span><span class="cb-stat-sub">share of missingness between people</span></div>` : '',
  ].join('');
  const perPerson = mm
    ? `<table class="cb-table cb-compact"><thead><tr><th>Missing per participant</th><th>Min</th><th>Max</th><th>Mean</th><th>SD</th></tr></thead><tbody><tr><td>Count of missed deliveries</td><td>${r2(mm.min)}</td><td>${r2(mm.max)}</td><td>${r2(mm.mean)}</td><td>${r2(mm.sd)}</td></tr></tbody></table>`
    : '';
  const charts = plots
    ? `${s.byParticipant.length > 1 ? `<h4 class="cb-chart-h">Response rate by participant</h4>${participantRateSvg(s.byParticipant)}` : ''}`
    : '';
  return `<p><strong>Missingness Descriptives</strong></p><div class="cb-stats">${tiles}</div>${perPerson}${charts}<p class="cb-small">ICC(1) of answered vs. missed across participants: near 0 means missed prompts are spread evenly; near 1 means a few participants account for most of them.</p>`;
}

function outliersHtml(s: ItemDescriptives): string {
  const o = s.outliers!;
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  // Summary only: no per-response listing, so the codebook never exposes individual records.
  return `<p><strong>Outlier screen</strong>: values below ${f(o.lower)} or above ${f(o.upper)} (1.5 × IQR beyond the quartiles) are flagged. ${o.flagged.length} of ${o.points.length} responses flagged.</p>${boxPlotSvg(o)}`;
}

function participantRateSvg(rows: Array<{ participant: string; delivered: number; answered: number }>): string {
  const shown = rows.slice(0, 40);
  const W = 760;
  const L = 110;
  const rowH = 16;
  const top = 8;
  const plotW = W - L - 60;
  const H = top + shown.length * rowH + 30;
  const x = (p: number) => L + p * plotW;
  const grid = [0, 0.25, 0.5, 0.75, 1];
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Response rate by participant">
<rect class="cb-panel" x="${L}" y="${top}" width="${plotW}" height="${shown.length * rowH}"/>
${grid.map((g) => `<line class="cb-grid" x1="${x(g)}" x2="${x(g)}" y1="${top}" y2="${top + shown.length * rowH}"/><text class="cb-axis" x="${x(g)}" y="${top + shown.length * rowH + 14}" text-anchor="middle">${g * 100}%</text>`).join('')}
${shown
  .map((r, i) => {
    const rate = r.delivered ? r.answered / r.delivered : 0;
    const y = top + i * rowH;
    return `<rect class="cb-bar" x="${L}" y="${y + 3}" width="${(rate * plotW).toFixed(1)}" height="${rowH - 6}"><title>${esc(r.participant)}: ${r.answered}/${r.delivered}</title></rect><text class="cb-axis" x="${L - 6}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(r.participant.length > 16 ? `${r.participant.slice(0, 15)}…` : r.participant)}</text><text class="cb-axis" x="${x(rate) + 4}" y="${y + rowH / 2 + 4}">${Math.round(rate * 100)}%</text>`;
  })
  .join('')}
</svg>${rows.length > 40 ? `<p class="cb-small">Showing the 40 participants with the lowest response rates of ${rows.length}.</p>` : ''}`;
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
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Box plot with outliers">
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

function histogramHtml(s: ItemDescriptives): string {
  const n = s.numeric!;
  const f = (x: number) => Number(x.toFixed(2));
  return `<p>N = ${n.n}, Mean = ${f(n.mean)}, SD = ${f(n.sd)}, Median = ${f(n.median)}, Min = ${f(n.min)}, Max = ${f(n.max)}</p>${histogramSvg(n.bins)}`;
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
${points.map((pt) => `<circle class="cb-dot-in" cx="${x(dayNum(pt.date)).toFixed(1)}" cy="${y(pt.n).toFixed(1)}" r="3"></circle>`).join('')}
<path class="cb-line" d="${path}"/>
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
      ? `<text class="cb-axis-title" x="${W - R + 14}" y="${T + 12}">Burst</text>${Array.from({ length: tl.bursts }, (_, i) => `<circle cx="${W - R + 20}" cy="${T + 30 + i * 18}" r="5" fill="${color(i + 1)}"></circle><text class="cb-axis" x="${W - R + 32}" y="${T + 34 + i * 18}">${i + 1}</text>`).join('')}`
      : '';
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Surveys by day since first survey">
<rect class="cb-panel" x="${L}" y="${T}" width="${plotW}" height="${plotH}"/>
${dTicks.map((d) => `<line class="cb-grid" x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${T + plotH}"/><text class="cb-axis" x="${x(d)}" y="${T + plotH + 16}" text-anchor="middle">${d}</text>`).join('')}
${rTicks.map((r) => `<text class="cb-axis" x="${L - 6}" y="${(T + plotH - r * rowH + 4).toFixed(1)}" text-anchor="end">${r}</text>`).join('')}
<path class="cb-density" d="${area}"/>
${tl.points.map((pt) => `<circle class="${tl.bursts > 1 ? 'cb-dot-burst' : 'cb-dot-in'}" cx="${x(pt.day).toFixed(1)}" cy="${y(pt.row).toFixed(1)}" r="${rDot.toFixed(1)}"${tl.bursts > 1 ? ` fill="${color(pt.burst)}"` : ''}></circle>`).join('')}
${legend}
<text class="cb-axis-title" x="${L + plotW / 2}" y="${H - 6}" text-anchor="middle">day since first survey</text>
<text class="cb-axis-title" transform="translate(12 ${T + plotH / 2}) rotate(-90)" text-anchor="middle">participant</text>
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

function autoSummary(models: SurveyModel[], overview: ReturnType<typeof dataOverview>): string {
  const n = models.reduce((a, m) => a + m.items.filter(isQuestion).length, 0);
  return `<p class="cb-prose">This codebook documents ${models.length} survey${models.length === 1 ? '' : 's'} with ${n} variable${n === 1 ? '' : 's'}${
    overview ? `, answered by ${overview.participants} participant${overview.participants === 1 ? '' : 's'}` : ''
  }.</p>
<table class="cb-table"><thead><tr><th>Survey</th><th>Questions</th><th>Blocks</th><th>Skip-logic branches</th></tr></thead><tbody>${models
    .map((m) => `<tr><td>${esc(m.label)}</td><td>${m.items.filter(isQuestion).length}</td><td>${m.items.filter(isBlock).length}</td><td>${m.branches.length}</td></tr>`)
    .join('')}</tbody></table>`;
}

function scheduleHtml(spec: StudySpec, models: SurveyModel[]): string {
  const s = buildStudySchedule(spec);
  const label = (name: string | null) => (name ? (models.find((m) => m.name === name)?.label ?? name) : 'NA');
  return `${s.firstDate ? `<p><strong>Study period:</strong> ${esc(s.firstDate)} to ${esc(s.lastDate)}</p>` : ''}
<table class="cb-table"><thead><tr><th>Schedule</th><th>Event</th><th>Survey</th><th>Window</th><th>Repeats</th><th>Timing</th></tr></thead><tbody>${s.events
    .map(
      (e) =>
        `<tr><td>${esc(e.scheduleName)}</td><td>${'&nbsp;&nbsp;'.repeat(e.depth)}${esc(e.title)}</td><td>${esc(label(e.surveyName))}</td><td>${esc(e.windowText)}</td><td>${esc(e.recurrenceText)}</td><td>${esc(
          [e.timingType, e.userSpecified ? 'participant-set' : null, e.trigger ? `trigger: ${e.trigger}` : null].filter(Boolean).join(', ') || 'NA',
        )}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

/** Nested TOC: every node with children folds; surveys and blocks start folded and show how many entries they hold. */
function renderToc(nodes: TocNode[]): string {
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
            const open = !kids || depth < 2;
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
--cb-font:${(CODEBOOK_FONTS[t.bodyFont] ?? CODEBOOK_FONTS.times!).stack};--cb-heading-font:${(CODEBOOK_FONTS[t.headingFont] ?? CODEBOOK_FONTS.times!).stack};--cb-size:${size}px;
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
    if (open) drawFlowcharts(panel);
    if (btn) { btn.setAttribute('aria-expanded', open); btn.querySelector('.cb-arrow').textContent = open ? '\\u25B2' : '\\u25BC'; }
  }
  // Flowcharts embedded as Mermaid code are drawn the first time their panel opens.
  function drawFlowcharts(root) {
    var pending = root.querySelectorAll('pre.cb-mermaid:not([data-drawn])');
    if (!pending.length || !window.mermaid) return;
    pending.forEach(function (el) { el.setAttribute('data-drawn', ''); el.classList.add('mermaid'); });
    window.mermaid.run({ nodes: pending });
  }
  function setSection(sec, open) {
    sec.classList.toggle('is-collapsed', !open);
    var b = sec.querySelector(':scope > h1 .cb-sec-toggle, :scope > h2 .cb-sec-toggle, :scope > h3 .cb-sec-toggle');
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
  var top = document.getElementById('backToTopBtn');
  function onScroll() { top.classList.toggle('is-visible', window.scrollY > 400); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
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
.cb-menu-l1{font-weight:600}
.cb-menu-l2{padding-left:24px!important;color:var(--cb-muted)!important}

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

.cb-survey-name{padding-bottom:6px;border-bottom:2px solid var(--cb-accent)}
.cb-prose{max-width:72ch}
.cb-small{font-size:.82em;color:var(--cb-muted)}

/* Variable pages */
.cb-var{margin:0 0 6px}
.header-shading{background:var(--cb-header);padding:10px 14px 12px;margin:18px 0 12px;border-radius:5px}
.header-shading h4{margin:0;font-size:1.05em;line-height:1.35}
.item-id{display:block;margin-top:3px;font-weight:bold;color:var(--cb-accent)}
.cb-anchor{margin-left:2em}
.cb-anchor > p{margin:0 0 .45em}
.cb-note{font-size:.88em;line-height:1.5;margin:.4em 0 .8em;padding:.5em 1em;border-left:4px solid var(--cb-accent);background:var(--cb-accent-soft);color:var(--cb-text)}
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
.cb-screenshot{max-width:320px;border:1px solid var(--cb-border)}

/* Tabs (Bootstrap-style, like the prior codebook) */
.cb-tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--cb-border);margin-bottom:12px}
.cb-tab{font:inherit;font-size:.9em;color:var(--cb-accent);background:none;border:1px solid transparent;border-radius:4px 4px 0 0;padding:8px 14px;margin-bottom:-1px;cursor:pointer}
.cb-tab:hover{background:var(--cb-faint)}
.cb-tab.is-active{color:var(--cb-text);background:var(--cb-surface);border-color:var(--cb-border) var(--cb-border) var(--cb-surface)}
.cb-pane{display:none}
.cb-pane.is-active{display:block}
.cb-print-only{display:none}

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
  body{background:#fff;font-size:11pt}
  .cb-topbar,#backToTopBtn,.cb-toggle,.cb-q-arrow,.cb-tabs,.cb-sec-toggle,.cb-twisty,.cb-toc-actions{display:none}
  .content{margin:0;max-width:none;padding:0;box-shadow:none;border-radius:0}
  .cb-toc{border:0;background:none;padding:0}
  #cb-toc-body[hidden],.cb-visuals[hidden]{display:block}
  .cb-toc li.is-collapsed > ul,section.is-collapsed > .cb-sec-body{display:block}
  .cb-pane{display:block}
  .cb-print-only{display:block;font-size:1em;margin:10px 0 6px}
  .cb-page{page-break-before:always}
  .header-shading{break-after:avoid}
  .cb-table tr,.cb-chart,.cb-flowchart{break-inside:avoid}
  a{color:inherit}
}`;
