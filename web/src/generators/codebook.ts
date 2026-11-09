// Spec -> self-contained codebook HTML, laid out like the prior R Markdown
// codebook: title block, table of contents, then <hr>-ruled pages (Title Page,
// Abstract Page, Effective Summary, Variable List) and, per survey, a shaded
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
import { dataOverview, describeItem, hasResponseData, indexResponses, type ItemDescriptives } from './descriptives';

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
  effectiveSummary: boolean;
  studySchedule: boolean;
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
  screenshots: boolean;
}

export const DEFAULT_CODEBOOK_OPTIONS: CodebookOptions = {
  nameOfStudy: true,
  authors: true,
  studyMetadata: true,
  funding: true,
  abstract: true,
  effectiveSummary: true,
  studySchedule: true,
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
  screenshots: true,
};

// ---------------------------------------------------------------- themes (colours and fonts only; layout is fixed)

export type CodebookFont = 'sans' | 'serif' | 'times' | 'mono';
export const CODEBOOK_FONTS: Record<CodebookFont, { label: string; stack: string }> = {
  times: { label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  serif: { label: 'Book serif', stack: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif" },
  sans: { label: 'Modern sans', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  mono: { label: 'Monospace', stack: "ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace" },
};

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
    theme: { accent: '#2a5caa', background: '#003d7a', surface: '#ffffff', headerBg: '#f0f0f0', text: '#333333', bodyFont: 'times', headingFont: 'times', fontSize: 19, charts: 'ggplot', expandVisuals: false },
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
  const caret = (label: string) => `<button class="cb-sec-toggle" type="button" aria-expanded="true" aria-label="Collapse ${esc(label)}" title="Collapse / expand">▾</button>`;
  /** A collapsible top-level page between rules, as in the prior codebook. */
  const page = (label: string, body: string, cls = '') => {
    const id = entry(label, 1);
    return `<section class="cb-page ${cls}"><hr><h1 id="${id}">${caret(label)}${esc(label)}</h1><hr><div class="cb-sec-body">${body}</div></section>`;
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
    out.push(`<section class="cb-page"><hr><h1 id="${titleId}">${caret('Title Page')}Title Page</h1><hr><div class="cb-sec-body">${titleParts.join('\n')}</div></section>`);
  } else toc.splice(tocMark, 1);

  if (o.abstract && abstract) out.push(page('Abstract Page', `<p class="cb-prose">${esc(abstract)}</p>`));
  if (o.effectiveSummary) {
    const summary = text.summary?.trim();
    out.push(page('Effective Summary', summary ? `<p class="cb-prose">${esc(summary)}</p>` : autoSummary(models, overview)));
  }
  if (o.studySchedule && spec.schedules.length) out.push(page('Study Schedule', scheduleHtml(spec, models)));

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
    if (o.flowcharts && svg) {
      const pid = `flow-${slug(m.name)}`;
      parts.push(`<div class="cb-anchor cb-flow">${toggleButton(pid, 'Click to view survey flowchart', t.expandVisuals)}<div id="${pid}" class="cb-visuals" ${t.expandVisuals ? '' : 'hidden'}><div class="cb-flowchart">${svg}</div></div></div>`);
    }
    type OpenBlock = { path: string; items: string[]; id: string; note: string };
    let openBlock = null as OpenBlock | null;
    // Read through a function: TypeScript otherwise narrows openBlock to null after closeBlock() calls.
    const current = (): OpenBlock | null => openBlock;
    const closeBlock = () => {
      if (!openBlock) return;
      parts.push(
        `<section class="cb-block"><h3 id="${openBlock.id}">${caret(`Block: ${openBlock.path}`)}Block: ${esc(openBlock.path)}</h3><div class="cb-sec-body">${openBlock.note}${openBlock.items.join('\n')}</div></section>`,
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
    surveysHtml.push(`<section class="cb-survey"><h2 id="${sid}" class="cb-survey-name">${caret(m.label)}${esc(m.label)}</h2><div class="cb-sec-body">${parts.join('\n')}</div></section>`);
  }
  if (models.length) out.push(`<section class="cb-page"><hr><h1 id="${varId}">${caret('Variable List')}Variable List</h1><hr><div class="cb-sec-body">${surveysHtml.join('\n')}</div></section>`);
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
<style>${themeCss(t)}${CODEBOOK_CSS}</style>
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
${authors ? `<h4 class="author">${esc(authors)}</h4>` : ''}
<h4 class="date">Codebook Generated ${esc(generated)}</h4>
</div>
<nav id="TOC" class="cb-toc" aria-label="Table of contents">
<div class="cb-toc-head">
<button class="cb-toc-toggle" type="button" aria-expanded="true" aria-controls="cb-toc-body"><span class="cb-twisty-icon">▾</span> Table of Contents</button>
<span class="cb-toc-actions"><button type="button" data-toc="expand">Expand all</button><button type="button" data-toc="collapse">Collapse all</button></span>
</div>
<div id="cb-toc-body">${renderToc(toc)}</div>
</nav>
${out.join('\n')}
</div>
<a href="#top" id="backToTopBtn" title="Back to top" aria-label="Back to top">↑</a>
<script>${CODEBOOK_JS}</script>
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
  lines.push(`<p><strong>Question ID:</strong> ${esc(q['Question.ID'])}</p>`);
  if (o.deliveryType) lines.push(`<p><strong>Way the question was delivered:</strong> ${esc(q['Question.Type.Display.Name'])}</p>`);
  if (o.typeOfData) lines.push(`<p><strong>Type of data:</strong> ${esc(q['Data.Type'] ?? 'NA')}</p>`);
  if (q['Question.Description']) lines.push(`<p><strong>Description:</strong> ${esc(q['Question.Description'])}</p>`);
  const opts = responseOptions(q);
  if (o.responseOptions && opts.length && !stats?.frequencies) {
    lines.push(
      `<table class="cb-table cb-options"><thead><tr><th>Value</th><th>Label</th></tr></thead><tbody>${opts
        .map((r) => `<tr><td>${esc(r.value)}</td><td>${esc(r.label)}</td></tr>`)
        .join('')}</tbody></table>`,
    );
  }

  const tabs: Array<{ name: string; html: string }> = [];
  if (stats?.frequencies && o.frequencyTable) tabs.push({ name: 'Frequency Table', html: frequencyTableHtml(stats) });
  if (stats?.frequencies && o.barPlot) tabs.push({ name: 'Barplot', html: barplotSvg(text, stats.frequencies) });
  if (stats?.numeric && o.histograms) tabs.push({ name: 'Histogram', html: histogramHtml(stats) });
  if (stats && o.missingness) tabs.push({ name: 'Missingness', html: missingnessHtml(q, stats, m) });
  if (o.screenshots && screenshotsURL) {
    const base = screenshotsURL.replace(/\/+$/, '');
    tabs.push({
      name: 'Screenshots',
      html: `<img class="cb-screenshot" alt="Screenshot of ${esc(q['Item.ID'])}" src="${esc(`${base}/${encodeURIComponent(q['Item.ID'])}.png`)}" onerror="this.replaceWith(Object.assign(document.createElement('p'),{textContent:'No screenshot available.'}))">`,
    });
  }
  if (tabs.length) {
    const vid = `vis-${id}`;
    lines.push(
      toggleButton(vid, 'Click to view visuals', t.expandVisuals),
      `<div id="${vid}" class="cb-visuals" ${t.expandVisuals ? '' : 'hidden'}><h3 class="cb-visuals-title">Descriptives</h3>
<div class="cb-tabs" role="tablist">${tabs.map((tab, i) => `<button type="button" role="tab" class="cb-tab${i === 0 ? ' is-active' : ''}" data-tab="${vid}-${i}" aria-selected="${i === 0}">${esc(tab.name)}</button>`).join('')}</div>
${tabs.map((tab, i) => `<div class="cb-pane${i === 0 ? ' is-active' : ''}" id="${vid}-${i}" role="tabpanel"><h4 class="cb-print-only">${esc(tab.name)}</h4>${tab.html}</div>`).join('')}</div>`,
    );
  }

  return `<div class="cb-var">
<div class="header-shading"><h4 id="${id}">${esc(text)}<span class="item-id">[${esc(q['Item.ID'])}]</span></h4></div>
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

function missingnessHtml(q: Question, s: ItemDescriptives, m: SurveyModel): string {
  const r = (x: number) => Number(x.toFixed(2));
  const parts: string[] = ['<p><strong>Missingness Descriptives</strong></p>'];
  if ((m.branchesTo.get(q['Item.ID'])?.length ?? 0) > 0 || s.participants < s.totalParticipants) {
    parts.push(
      `<p>${s.totalParticipants && s.participants >= s.totalParticipants ? `This question/item was delivered to all ${s.totalParticipants} participants` : `This question/item was delivered only to ${s.participants} out of ${s.totalParticipants || s.participants} participants`}</p>`,
    );
  }
  parts.push(`<p>Answered / Delivered = ${s.answered} / ${s.delivered}</p>`);
  const mm = s.missingness;
  parts.push(
    `<p>Missing = ${s.missing}${mm ? `<br>Min = ${r(mm.min)}, Max = ${r(mm.max)}, Mean = ${r(mm.mean)}, SD = ${r(mm.sd)}<br><span class="cb-small">(Missing responses per participant; descriptives are rounded to 2 decimals)</span>` : ''}</p>`,
  );
  if (mm) parts.push(`<p>Missingness Intraclass Correlation (ICC) = ${mm.icc == null ? 'NA' : r(mm.icc)}</p>`);
  return parts.join('\n');
}

function histogramHtml(s: ItemDescriptives): string {
  const n = s.numeric!;
  const f = (x: number) => Number(x.toFixed(2));
  return `<p>N = ${n.n}, Mean = ${f(n.mean)}, SD = ${f(n.sd)}, Median = ${f(n.median)}, Min = ${f(n.min)}, Max = ${f(n.max)}</p>${histogramSvg(n.bins)}`;
}

// Charts take their colours from CSS (ggplot2 grey, or the theme accent).
function barplotSvg(title: string, freqs: Array<{ label: string; count: number }>): string {
  const rows = freqs;
  const labelW = Math.min(280, Math.max(60, ...rows.map((r) => r.label.length * 6.2)));
  const rowH = 26;
  const W = 760;
  const plotW = W - labelW - 30;
  const top = 34;
  const H = top + rows.length * rowH + 40;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const step = niceStep(max);
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.01; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  const x = (v: number) => labelW + 10 + (v / (ticks[ticks.length - 1] || 1)) * plotW;
  const trunc = (s: string) => (s.length * 6.2 > labelW ? `${s.slice(0, Math.floor(labelW / 6.2) - 1)}…` : s);
  return `<svg class="cb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Barplot">
<text class="cb-chart-title" x="${labelW + 10}" y="18">${esc(title.length > 90 ? `${title.slice(0, 89)}…` : title)}</text>
<rect class="cb-panel" x="${labelW + 10}" y="${top}" width="${plotW}" height="${rows.length * rowH}"/>
${ticks.map((v) => `<line class="cb-grid" x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${top + rows.length * rowH}"/>`).join('')}
${rows
  .map((r, i) => {
    const y = top + i * rowH;
    return `<rect class="cb-bar" x="${labelW + 10}" y="${y + 5}" width="${Math.max(0, x(r.count) - labelW - 10)}" height="${rowH - 10}"><title>${esc(r.label)}: ${r.count}</title></rect><text class="cb-axis" x="${labelW + 4}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(trunc(r.label))}</text>`;
  })
  .join('')}
${ticks.map((v) => `<text class="cb-axis" x="${x(v)}" y="${top + rows.length * rowH + 15}" text-anchor="middle">${v}</text>`).join('')}
<text class="cb-axis-title" x="${labelW + 10 + plotW / 2}" y="${H - 6}" text-anchor="middle">count</text>
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

/** Nested TOC; every node with children gets a twisty so it can fold. */
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
  const render = (ts: T[]): string =>
    ts.length
      ? `<ul>${ts
          .map(
            (t) =>
              `<li${t.children.length ? ' class="has-children"' : ''}>${t.children.length ? `<button class="cb-twisty" type="button" aria-expanded="true" aria-label="Collapse ${esc(t.node.label)}">▾</button>` : '<span class="cb-twisty-spacer"></span>'}<a href="#${t.node.id}">${esc(t.node.label)}</a>${render(t.children)}</li>`,
          )
          .join('')}</ul>`
      : '';
  return render(root);
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
--cb-font:${(CODEBOOK_FONTS[t.bodyFont] ?? CODEBOOK_FONTS.times).stack};--cb-heading-font:${(CODEBOOK_FONTS[t.headingFont] ?? CODEBOOK_FONTS.times).stack};--cb-size:${size}px;
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
    if (btn) { btn.setAttribute('aria-expanded', open); btn.querySelector('.cb-arrow').textContent = open ? '\\u25B2' : '\\u25BC'; }
  }
  function setSection(sec, open) {
    sec.classList.toggle('is-collapsed', !open);
    var b = sec.querySelector(':scope > h1 .cb-sec-toggle, :scope > h2 .cb-sec-toggle, :scope > h3 .cb-sec-toggle');
    if (b) b.setAttribute('aria-expanded', open);
  }
  function setTocNode(li, open) {
    li.classList.toggle('is-collapsed', !open);
    var b = li.querySelector(':scope > .cb-twisty');
    if (b) b.setAttribute('aria-expanded', open);
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
    if (tw) { var li = tw.parentNode; setTocNode(li, li.classList.contains('is-collapsed')); return; }
    var tt = t.closest('.cb-toc-toggle');
    if (tt) { var body = document.getElementById('cb-toc-body'); body.hidden = !body.hidden; tt.setAttribute('aria-expanded', !body.hidden); tt.querySelector('.cb-twisty-icon').textContent = body.hidden ? '\\u25B8' : '\\u25BE'; return; }
    var ta = t.closest('[data-toc]');
    if (ta) {
      var open = ta.getAttribute('data-toc') === 'expand';
      document.getElementById('cb-toc-body').hidden = false;
      document.querySelectorAll('.cb-toc li.has-children').forEach(function (li) { setTocNode(li, open || !li.parentNode.parentNode.closest('li')); });
      return;
    }
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu) setMenu(false); });
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

/* Table of contents: collapsible as a whole and per node */
.cb-toc{border:1px solid var(--cb-border);border-radius:6px;padding:12px 16px 14px;margin:0 0 28px;background:var(--cb-faint)}
.cb-toc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cb-toc-toggle{font:inherit;font-weight:bold;font-size:1.05em;color:var(--cb-text);background:none;border:0;padding:0;cursor:pointer}
.cb-toc-actions{display:flex;gap:6px}
.cb-toc-actions button{font:inherit;font-size:.72em;color:var(--cb-accent);background:var(--cb-surface);border:1px solid var(--cb-border);border-radius:4px;padding:2px 9px;cursor:pointer}
#cb-toc-body{margin-top:10px}
#cb-toc-body[hidden]{display:none}
.cb-toc ul{list-style:none;margin:0;padding:0}
.cb-toc ul ul{padding-left:22px}
.cb-toc li{margin:2px 0}
.cb-toc li.is-collapsed > ul{display:none}
.cb-toc > div > ul > li > a{font-weight:bold}
.cb-twisty,.cb-twisty-spacer{display:inline-block;width:1.2em;text-align:center}
.cb-twisty{font:inherit;font-size:.85em;color:var(--cb-muted);background:none;border:0;padding:0;cursor:pointer;transition:transform .15s}
.cb-toc li.is-collapsed > .cb-twisty{transform:rotate(-90deg)}

/* Pages: rules + centred title, collapsible */
.cb-page{margin-top:8px}
hr{border:0;border-top:1px solid var(--cb-border);margin:18px 0}
.cb-page > h1{text-align:center;font-size:1.75em;margin:0}
.cb-page h2{font-size:1.4em;margin:26px 0 10px}
.cb-page h3{font-size:1.15em;margin:24px 0 10px}
.cb-sec-toggle{font:inherit;font-size:.6em;vertical-align:.25em;width:1.6em;height:1.6em;margin-right:.35em;border-radius:4px;border:1px solid var(--cb-border);background:var(--cb-surface);color:var(--cb-muted);cursor:pointer;transition:transform .15s}
.cb-sec-toggle:hover{color:var(--cb-accent);border-color:var(--cb-accent)}
section.is-collapsed > .cb-sec-body{display:none}
section.is-collapsed > h1 .cb-sec-toggle,section.is-collapsed > h2 .cb-sec-toggle,section.is-collapsed > h3 .cb-sec-toggle{transform:rotate(-90deg)}
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
.cb-visuals{margin:0 0 1em}
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
  .cb-topbar,#backToTopBtn,.cb-toggle,.cb-tabs,.cb-sec-toggle,.cb-twisty,.cb-toc-actions{display:none}
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
