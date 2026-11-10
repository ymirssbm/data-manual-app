// Codebook → Word (.docx). Reads the same HTML the viewer shows and the PDF prints, so the Word file
// has the same content and order: headings, paragraphs, lists and tables become Word's own, and
// charts and flowcharts become images. Runs in the browser (it needs a DOM and a canvas); the docx
// library is loaded only when someone exports.
import type * as Docx from 'docx';
import { CODEBOOK_FONTS, type CodebookTheme } from '../generators';

type D = typeof Docx;
type Block = Docx.Paragraph | Docx.Table | Docx.TableOfContents;

/** Content width on a Letter page with 1-inch side margins. */
const PAGE_W_TWIPS = 9360;
const PAGE_W_PX = 624;
/** Content height (11in less the top and bottom margins), less room for the running header. */
const PAGE_H_PX = 880;

/** Print colours: the PDF is always a light document, whatever the screen theme, and so is this. */
const LIGHT = { text: '1F1F1F', muted: '5F5F5F', border: 'CFCFCF', faint: 'F6F6F6', header: 'EEEEEE' };

const hex = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : fallback);

/** First real family in a CSS font stack, as Word knows it. */
function wordFont(key: string): string {
  const first = (CODEBOOK_FONTS[key]?.stack ?? 'Times New Roman').split(',')[0]!.replace(/['"]/g, '').trim();
  return first.startsWith('-apple') || first === 'system-ui' ? 'Calibri' : first === 'ui-monospace' ? 'Consolas' : first;
}

export async function codebookDocx(html: string, theme: CodebookTheme, title: string): Promise<Blob> {
  const d = await import('docx');
  const frame = await loadFrame(html);
  try {
    const accent = hex(theme.accent, '2A5CAA');
    const body = frame.contentDocument!.body;
    const w = new Walker(d, frame.contentWindow!, accent);
    const children = await w.blocks(body.querySelector('.content') ?? body, { indent: 0 });
    const font = wordFont(theme.bodyFont);
    const headFont = wordFont(theme.headingFont);
    const heading = (size: number, extra: Record<string, unknown> = {}) => ({
      run: { font: headFont, size, bold: true, color: LIGHT.text },
      paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true },
      ...extra,
    });
    const small = { font: 'Arial', size: 17, color: '777777' };
    const doc = new d.Document({
      creator: 'Data Manual',
      title,
      features: { updateFields: true },
      styles: {
        default: {
          document: { run: { font, size: 21, color: LIGHT.text }, paragraph: { spacing: { after: 100, line: 276 } } },
          title: { run: { font: headFont, size: 40, bold: true, color: LIGHT.text }, paragraph: { alignment: d.AlignmentType.CENTER, spacing: { after: 80 } } },
          heading1: heading(32),
          heading2: heading(26),
          heading3: heading(24),
          heading4: heading(22),
          hyperlink: { run: { color: accent, underline: {} } },
        },
      },
      sections: [
        {
          // US Letter, like the PDF (the library's default is A4).
          properties: { titlePage: true, page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1150, left: 1440, right: 1440 } } },
          headers: { default: new d.Header({ children: [new d.Paragraph({ children: [new d.TextRun({ text: title.length > 80 ? `${title.slice(0, 79)}…` : title, ...small })] })] }) },
          footers: {
            default: new d.Footer({
              children: [
                new d.Paragraph({
                  alignment: d.AlignmentType.RIGHT,
                  children: [new d.TextRun({ children: ['Page ', d.PageNumber.CURRENT, ' of ', d.PageNumber.TOTAL_PAGES], ...small })],
                }),
              ],
            }),
            first: new d.Footer({ children: [new d.Paragraph({})] }),
          },
          children,
        },
      ],
    });
    return await d.Packer.toBlob(doc);
  } finally {
    frame.remove();
  }
}

/** The codebook in an off-screen frame, styled for print, so charts can be measured and drawn. */
async function loadFrame(html: string): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', left: '-12000px', top: '0', width: '1000px', height: '800px', border: '0' });
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Could not read the codebook.'));
      frame.src = url;
      document.body.appendChild(frame);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  const doc = frame.contentDocument!;
  const style = doc.createElement('style');
  // The print stylesheet's colours and chart sizes, applied on screen so computed styles match the PDF.
  style.textContent = `:root{--cb-bg:#fff;--cb-surface:#fff;--cb-text:#1f1f1f;--cb-muted:#5f5f5f;--cb-border:#cfcfcf;--cb-faint:#f6f6f6;--cb-header:#eeeeee}
.cb-chart .cb-axis{font-size:16px}.cb-chart .cb-axis-title{font-size:17px}.cb-chart .cb-chart-title{font-size:18px}.cb-boxplot .cb-dot-in{display:none}
.cb-pane,.cb-visuals[hidden],section.is-collapsed>.cb-sec-body{display:block}`;
  doc.head.appendChild(style);
  await doc.fonts?.ready;
  return frame;
}

interface Ctx {
  /** Left indent in twips. */
  indent: number;
}

/** An inline run before it becomes a docx TextRun. */
interface Inline {
  text: string;
  bold?: boolean;
  italics?: boolean;
  color?: string;
  size?: number;
  font?: string;
  caps?: boolean;
  link?: string;
  br?: boolean;
}

const SKIP = 'script,style,button,.cb-topbar,#backToTopBtn,.cb-tabs,.cb-visuals-title,.cb-miss-title,.cb-meter,.cb-q-arrow,.cb-arrow,.cb-sec-toggle,pre.cb-mermaid,.cb-screen-only';
const BLOCK_TAGS = new Set(['DIV', 'SECTION', 'P', 'UL', 'OL', 'LI', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DL', 'NAV', 'HR', 'PRE', 'svg', 'IMG', 'HEADER']);

class Walker {
  private breakNext = false;
  constructor(
    private d: D,
    private win: Window,
    private accent: string,
  ) {}

  async blocks(el: Element, ctx: Ctx): Promise<Block[]> {
    const out: Block[] = [];
    let loose: Node[] = [];
    const flush = () => {
      if (loose.some((n) => n.textContent?.trim())) out.push(this.para(this.inlines(loose), ctx));
      loose = [];
    };
    for (const node of [...el.childNodes]) {
      if (node.nodeType === 3) {
        loose.push(node);
        continue;
      }
      if (node.nodeType !== 1) continue;
      const c = node as Element;
      if (!BLOCK_TAGS.has(c.tagName) && !c.matches('.cb-stats,.cb-stat')) {
        loose.push(c);
        continue;
      }
      flush();
      out.push(...(await this.block(c, ctx)));
    }
    flush();
    return out;
  }

  private async block(el: Element, ctx: Ctx): Promise<Block[]> {
    const d = this.d;
    if (el.matches(SKIP) || el.tagName === 'HR') return [];
    if (el.id === 'header') {
      const t = el.querySelector('.title')?.textContent?.trim() ?? '';
      const date = el.querySelector('.date')?.textContent?.trim() ?? '';
      return [
        new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(t)] }),
        new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 360 }, children: [new d.TextRun({ text: date, italics: true, color: LIGHT.muted })] }),
      ];
    }
    if (el.id === 'TOC') {
      return [
        new d.Paragraph({ spacing: { before: 120, after: 120 }, border: { bottom: this.rule() }, children: [new d.TextRun({ text: 'Table of Contents', bold: true, size: 26 })] }),
        new d.TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-4' }),
      ];
    }
    if (el.matches('section.cb-page')) this.breakNext = true;
    if (el.matches('section.cb-survey') && el.previousElementSibling) this.breakNext = true;

    switch (el.tagName) {
      case 'H1':
        return [this.heading(el, d.HeadingLevel.HEADING_1, ctx, { alignment: d.AlignmentType.CENTER, border: { top: this.rule(), bottom: this.rule() } })];
      case 'H2':
        return [this.heading(el, d.HeadingLevel.HEADING_2, ctx, el.classList.contains('cb-survey-name') ? { border: { bottom: this.rule(this.accent, 12) } } : {})];
      case 'H3':
        return [this.heading(el, d.HeadingLevel.HEADING_3, ctx)];
      case 'H4':
      case 'H5':
      case 'H6':
        if (el.classList.contains('cb-print-only'))
          return [this.para([{ text: el.textContent?.trim() ?? '', size: 18, caps: true, color: LIGHT.muted, bold: true }], ctx, { keepNext: true, spacing: { before: 160, after: 60 } })];
        return [this.para(this.inlines([...el.childNodes]).map((r) => ({ ...r, bold: true })), ctx, { keepNext: true, spacing: { before: 200, after: 60 } })];
      case 'P':
        return [this.paragraphEl(el, ctx)];
      case 'UL':
      case 'OL':
        return this.list(el, ctx, 0);
      case 'TABLE':
        return [this.table(el, ctx), this.spacer()];
      case 'DL':
        return [this.numstats(el, ctx), this.spacer()];
      case 'svg':
        return this.svgImage(el as SVGSVGElement, ctx);
      case 'IMG':
        return [await this.imgImage(el as HTMLImageElement, ctx)];
      case 'PRE':
        return [this.para([{ text: el.textContent ?? '', font: 'Consolas', size: 18 }], ctx)];
    }
    if (el.matches('.cb-stats')) return [this.stats(el, ctx), this.spacer()];
    if (el.matches('.header-shading')) return this.variableHead(el, ctx);
    if (el.matches('.cb-block')) {
      const head = el.querySelector(':scope > .cb-block-head');
      const h3 = head?.querySelector('h3');
      const out: Block[] = [];
      if (h3) {
        // The "Block" label is its own line, so the table of contents lists just the block's name.
        const bar = { left: { style: d.BorderStyle.SINGLE, size: 24, color: this.accent, space: 6 } };
        out.push(
          this.para([{ text: 'BLOCK', size: 15, bold: true, color: this.accent }], ctx, { border: bar, keepNext: true, spacing: { before: 280, after: 0 } }),
          this.heading(h3, d.HeadingLevel.HEADING_3, ctx, { border: bar, spacing: { before: 0, after: 120 } }),
        );
      }
      const cond = head?.querySelector('.cb-cond');
      if (cond) out.push(this.paragraphEl(cond, ctx));
      const bodyEl = el.querySelector(':scope > .cb-sec-body');
      if (bodyEl) out.push(...(await this.blocks(bodyEl, { indent: ctx.indent + 240 })));
      return out;
    }
    const inner = el.matches('.cb-anchor') ? { indent: ctx.indent + 200 } : ctx;
    return this.blocks(el, inner);
  }

  // ---- Paragraph pieces

  private rule(color = LIGHT.border, size = 6) {
    return { style: this.d.BorderStyle.SINGLE, size, color, space: 4 };
  }

  private spacer(): Docx.Paragraph {
    return new this.d.Paragraph({ spacing: { after: 0 }, children: [new this.d.TextRun({ text: '', size: 8 })] });
  }

  /** Paragraph options shared by everything: indent, and the page break a new page or survey asks for. */
  private para(runs: Inline[], ctx: Ctx, opts: Record<string, unknown> = {}): Docx.Paragraph {
    const pageBreakBefore = this.breakNext;
    this.breakNext = false;
    return new this.d.Paragraph({ indent: ctx.indent ? { left: ctx.indent } : undefined, pageBreakBefore, ...opts, children: this.runs(runs) });
  }

  private heading(el: Element, level: (typeof Docx.HeadingLevel)[keyof typeof Docx.HeadingLevel], ctx: Ctx, opts: Record<string, unknown> = {}): Docx.Paragraph {
    return this.para(this.inlines([...el.childNodes]), ctx, { heading: level, ...opts });
  }

  private paragraphEl(el: Element, ctx: Ctx): Docx.Paragraph {
    const small = el.matches('.cb-small');
    const cond = el.matches('.cb-cond');
    const runs = this.inlines([...el.childNodes]).map((r) => (small ? { ...r, size: r.size ?? 18, color: r.color ?? LIGHT.muted } : cond ? { ...r, size: r.size ?? 19 } : r));
    return this.para(runs, ctx);
  }

  /** A variable's shaded header: the question, then its ID and type on a second line. */
  private variableHead(el: Element, ctx: Ctx): Block[] {
    const d = this.d;
    const h4 = el.querySelector('h4');
    if (!h4) return [];
    const sub = h4.querySelector('.cb-q-sub');
    const question = this.inlines([...h4.childNodes].filter((n) => n !== sub));
    const id = sub?.querySelector('.item-id')?.textContent?.trim() ?? '';
    const meta = sub?.querySelector('.cb-q-meta')?.textContent?.trim() ?? '';
    const shading = { type: d.ShadingType.CLEAR, color: 'auto', fill: LIGHT.header };
    const indent = ctx.indent ? { left: ctx.indent } : undefined;
    return [
      this.para(question, ctx, { heading: d.HeadingLevel.HEADING_4, shading, spacing: { before: 200, after: 0 }, keepNext: true }),
      new d.Paragraph({
        indent,
        shading,
        keepNext: true,
        spacing: { after: 100 },
        children: this.runs([
          { text: id, bold: true, color: this.accent, size: 19 },
          ...(meta ? [{ text: `    ${meta}`, color: LIGHT.muted, size: 18 }] : []),
        ]),
      }),
    ];
  }

  private list(el: Element, ctx: Ctx, level: number): Block[] {
    const out: Block[] = [];
    for (const li of el.querySelectorAll(':scope > li')) {
      const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL' || c.tagName === 'TABLE');
      const runs = this.inlines([...li.childNodes].filter((n) => !nested.includes(n as Element)));
      if (runs.some((r) => r.text.trim())) out.push(this.para(runs, { indent: 0 }, { bullet: { level: Math.min(level, 8) }, indent: { left: ctx.indent + 360 * (level + 1), hanging: 260 }, spacing: { after: 40 } }));
      for (const n of nested) {
        if (n.tagName === 'TABLE') out.push(this.table(n, { indent: ctx.indent + 360 * (level + 1) }));
        else out.push(...this.list(n, ctx, level + 1));
      }
    }
    return out;
  }

  // ---- Inline text

  private inlines(nodes: Node[], style: Omit<Inline, 'text'> = {}): Inline[] {
    const out: Inline[] = [];
    const walk = (n: Node, s: Omit<Inline, 'text'>) => {
      if (n.nodeType === 3) {
        const text = (n.textContent ?? '').replace(/\s+/g, ' ');
        if (text) out.push({ ...s, text });
        return;
      }
      if (n.nodeType !== 1) return;
      const el = n as Element;
      if (el.matches(SKIP)) return;
      if (el.tagName === 'BR') return void out.push({ text: '', br: true });
      const next = { ...s };
      if (el.tagName === 'STRONG' || el.tagName === 'B') next.bold = true;
      if (el.tagName === 'EM' || el.tagName === 'I') next.italics = true;
      if (el.tagName === 'CODE') next.font = 'Consolas';
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (/^https?:\/\//.test(href)) next.link = href;
      }
      if (el.matches('.cb-cond-tag')) {
        out.push({ text: (el.textContent ?? '').trim().toUpperCase(), bold: true, color: this.accent, size: 16 }, { text: '  ' });
        return;
      }
      if (el.matches('.cb-cond-q,.cb-toc-count')) next.color = LIGHT.muted;
      if (el.matches('.item-id')) Object.assign(next, { bold: true, color: this.accent });
      for (const c of el.childNodes) walk(c, next);
    };
    for (const n of nodes) walk(n, style);
    // Trim the paragraph's ends, as HTML does.
    while (out.length && !out[0]!.br && !out[0]!.text.trim()) out.shift();
    while (out.length && !out[out.length - 1]!.br && !out[out.length - 1]!.text.trim()) out.pop();
    if (out[0]) out[0] = { ...out[0], text: out[0].text.trimStart() };
    const last = out[out.length - 1];
    if (last) out[out.length - 1] = { ...last, text: last.text.trimEnd() };
    return out;
  }

  private runs(inl: Inline[]): Array<Docx.TextRun | Docx.ExternalHyperlink> {
    const d = this.d;
    const run = (r: Inline) =>
      r.br
        ? new d.TextRun({ text: '', break: 1 })
        : new d.TextRun({ text: r.text, bold: r.bold, italics: r.italics, color: r.color, size: r.size, font: r.font, allCaps: r.caps, style: r.link ? 'Hyperlink' : undefined });
    const out: Array<Docx.TextRun | Docx.ExternalHyperlink> = [];
    for (let i = 0; i < inl.length; i++) {
      const r = inl[i]!;
      if (!r.link) {
        out.push(run(r));
        continue;
      }
      const group = [r];
      while (inl[i + 1]?.link === r.link) group.push(inl[++i]!);
      out.push(new d.ExternalHyperlink({ link: r.link, children: group.map(run) }));
    }
    return out;
  }

  // ---- Tables

  private table(el: Element, ctx: Ctx): Docx.Table {
    const rows = [...el.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')];
    const grid = rows.map((tr) => [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH'));
    const cols = Math.max(1, ...grid.map((r) => r.length));
    // Column widths from content length, so tables read well in Word, Google Docs and LibreOffice alike.
    const lens = Array.from({ length: cols }, (_, i) => Math.min(40, Math.max(4, ...grid.map((r) => (r[i]?.textContent?.trim().length ?? 0)))));
    const total = lens.reduce((a, b) => a + b, 0);
    const width = PAGE_W_TWIPS - ctx.indent;
    const widths = lens.map((l) => Math.round((l / total) * width));
    let body = 0;
    return this.makeTable(
      grid.map((cells, ri) => {
        const head = cells.every((c) => c.tagName === 'TH');
        const zebra = !head && body++ % 2 === 1;
        return { head, cells: cells.map((c, ci) => ({ runs: this.inlines([...c.childNodes]), width: widths[ci]!, fill: zebra ? LIGHT.faint : undefined, cls: c.className, ri })) };
      }),
      widths,
      ctx,
    );
  }

  private makeTable(rows: Array<{ head: boolean; cells: Array<{ runs: Inline[]; width: number; fill?: string; cls?: string; ri?: number } | { blocks: Docx.Paragraph[]; width: number }> }>, widths: number[], ctx: Ctx): Docx.Table {
    const d = this.d;
    const none = { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const line = (size: number) => ({ style: d.BorderStyle.SINGLE, size, color: LIGHT.border });
    return new d.Table({
      width: { size: widths.reduce((a, b) => a + b, 0), type: d.WidthType.DXA },
      columnWidths: widths,
      layout: d.TableLayoutType.FIXED,
      indent: ctx.indent ? { size: ctx.indent, type: d.WidthType.DXA } : undefined,
      borders: { top: none, bottom: line(4), left: none, right: none, insideHorizontal: line(4), insideVertical: none },
      rows: rows.map(
        (r) =>
          new d.TableRow({
            tableHeader: r.head,
            cantSplit: true,
            children: r.cells.map(
              (c) =>
                new d.TableCell({
                  width: { size: c.width, type: d.WidthType.DXA },
                  margins: { top: 50, bottom: 50, left: 100, right: 100 },
                  shading: 'fill' in c && c.fill ? { type: d.ShadingType.CLEAR, color: 'auto', fill: c.fill } : undefined,
                  borders: r.head ? { bottom: line(12) } : undefined,
                  children:
                    'blocks' in c
                      ? c.blocks
                      : [
                          new d.Paragraph({
                            spacing: { after: 0 },
                            children: this.runs(
                              c.runs.map((x) => ({ ...x, size: x.size ?? 19, bold: x.bold || r.head, color: x.color ?? (c.cls?.includes('cb-count') ? this.accent : undefined) })),
                            ),
                          }),
                        ],
                }),
            ),
          }),
      ),
    });
  }

  /** N / Mean / SD … as a small two-row table. */
  private numstats(el: Element, ctx: Ctx): Docx.Table {
    const items = [...el.querySelectorAll(':scope > div')].map((x) => [x.querySelector('dt')?.textContent ?? '', x.querySelector('dd')?.textContent ?? '']);
    const widths = items.map(() => Math.round(Math.min(PAGE_W_TWIPS - ctx.indent, 6600) / Math.max(1, items.length)));
    return this.makeTable(
      [
        { head: true, cells: items.map(([k], i) => ({ runs: [{ text: k!, size: 16, caps: true, color: LIGHT.muted }], width: widths[i]! })) },
        { head: false, cells: items.map(([, v], i) => ({ runs: [{ text: v!, size: 21 }], width: widths[i]! })) },
      ],
      widths,
      ctx,
    );
  }

  /** The missingness tiles as one row of cells. */
  private stats(el: Element, ctx: Ctx): Docx.Table {
    const d = this.d;
    const tiles = [...el.querySelectorAll(':scope > .cb-stat')];
    const widths = tiles.map(() => Math.round((PAGE_W_TWIPS - ctx.indent) / Math.max(1, tiles.length)));
    const p = (sel: string, tile: Element, style: Omit<Inline, 'text'>) => {
      const text = tile.querySelector(sel)?.textContent?.trim();
      return text ? [new d.Paragraph({ spacing: { after: 20 }, children: this.runs([{ text, ...style }]) })] : [];
    };
    return this.makeTable(
      [
        {
          head: false,
          cells: tiles.map((t, i) => ({
            width: widths[i]!,
            blocks: [...p('.cb-stat-l', t, { size: 15, caps: true, bold: true, color: LIGHT.muted }), ...p('.cb-stat-n', t, { size: 26, bold: true }), ...p('.cb-stat-sub', t, { size: 16, color: LIGHT.muted })],
          })),
        },
      ],
      widths,
      ctx,
    );
  }

  // ---- Images

  private imagePara(data: ArrayBuffer, w: number, h: number, ctx: Ctx, alt: string): Docx.Paragraph {
    const d = this.d;
    const pageBreakBefore = this.breakNext;
    this.breakNext = false;
    return new d.Paragraph({
      indent: ctx.indent ? { left: ctx.indent } : undefined,
      pageBreakBefore,
      keepLines: true,
      spacing: { after: 120 },
      children: [new d.ImageRun({ type: 'png', data, transformation: { width: Math.round(w), height: Math.round(h) }, altText: { name: alt, description: alt, title: alt } })],
    });
  }

  private async svgImage(svg: SVGSVGElement, ctx: Ctx): Promise<Block[]> {
    const vb = svg.viewBox?.baseVal;
    const box = svg.getBoundingClientRect();
    const w0 = vb?.width || parseFloat(svg.getAttribute('width') ?? '') || box.width || 600;
    const h0 = vb?.height || parseFloat(svg.getAttribute('height') ?? '') || box.height || 300;
    const chart = svg.classList.contains('cb-chart');
    const wide = svg.getAttribute('aria-label') === 'Surveys by day since first survey';
    const maxW = (chart ? (wide ? 6.4 : 4.6) * 96 : PAGE_W_PX) - ctx.indent / 15;
    // Charts keep the PDF's sizes. Flowcharts keep their natural size (or fit the page width) and a
    // tall one continues over as many pages as it needs, instead of shrinking until it can't be read.
    const s = chart ? Math.min(maxW / w0, ((wide ? 5 : 2.6) * 96) / h0) : Math.min(maxW / w0, FLOW_SCALE);
    const w = w0 * s;
    const h = h0 * s;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    if (chart) inlineStyles(svg, clone, this.win);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w0));
    clone.setAttribute('height', String(h0));
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w0} ${h0}`);
    clone.removeAttribute('style');
    const alt = svg.getAttribute('aria-label') || (chart ? 'Chart' : 'Survey flowchart');
    try {
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`);
      if (chart) return [this.imagePara(await toPng(img, { sy: 0, sh: h0, sw: w0 }, w, h), w, h, ctx, alt)];
      const full = drawFull(img, w, h);
      const k = full.width / w;
      const cuts = sliceRows(full, Math.round((PAGE_H_PX - 40) * k)).map((y) => y / k);
      const out: Block[] = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const ph = cuts[i + 1]! - cuts[i]!;
        const png = await crop(full, cuts[i]! * k, ph * k);
        if (i > 0) this.breakNext = true;
        out.push(this.imagePara(png, w, ph, ctx, cuts.length > 2 ? `${alt} (part ${i + 1} of ${cuts.length - 1})` : alt));
      }
      return out;
    } catch {
      return [this.para([{ text: `[${alt} could not be included]`, italics: true, color: LIGHT.muted }], ctx)];
    }
  }

  private async imgImage(img: HTMLImageElement, ctx: Ctx): Promise<Docx.Paragraph> {
    const alt = img.alt || 'Image';
    try {
      const res = await fetch(img.src, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      const bmp = await createImageBitmap(await res.blob());
      const s = Math.min(1, 320 / bmp.width);
      const png = await toPng(bmp, { sy: 0, sh: bmp.height, sw: bmp.width }, bmp.width * s, bmp.height * s);
      return this.imagePara(png, bmp.width * s, bmp.height * s, ctx, alt);
    } catch {
      return this.para([{ text: 'Screenshot: ', italics: true, color: LIGHT.muted }, { text: img.src, link: img.src }], ctx);
    }
  }
}

/** Copies computed paint and text styles onto a cloned SVG, since its stylesheet stays behind. */
function inlineStyles(src: Element, dst: Element, win: Window) {
  const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight', 'display'];
  const a = [src, ...src.querySelectorAll('*')];
  const b = [dst, ...dst.querySelectorAll('*')];
  a.forEach((el, i) => {
    const cs = win.getComputedStyle(el);
    const target = b[i] as SVGElement | undefined;
    if (!target) return;
    target.setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
}

const RENDER_SCALE = 2;
/** Flowcharts at a little over half their on-screen size: node text comes out around 9pt. */
const FLOW_SCALE = 0.55;

/** The whole flowchart on one canvas (at up to 2×), so it can be cut into pages. */
function drawFull(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const k = Math.min(RENDER_SCALE, 16000 / h, Math.sqrt(40e6 / (w * h)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Where to cut a tall image into pages: each cut is the row with the least drawn on it in the
 * bottom 40% of the page, so cuts fall in the gaps between boxes rather than through them.
 * Returns the row offsets, starting with 0 and ending with the height.
 */
function sliceRows(c: HTMLCanvasElement, pageH: number): number[] {
  const cuts = [0];
  if (c.height <= pageH) return [0, c.height];
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const inked = (y: number) => {
    let n = 0;
    for (let x = 0, i = y * c.width * 4; x < c.width; x++, i += 4) if (255 * 3 - data[i]! - data[i + 1]! - data[i + 2]! > 36) n++;
    return n;
  };
  let y = 0;
  while (c.height - y > pageH) {
    let best = y + pageH;
    let bestN = Infinity;
    for (let r = y + pageH; r > y + pageH * 0.6; r--) {
      const n = inked(r);
      if (n < bestN) [best, bestN] = [r, n];
      if (n === 0) break;
    }
    cuts.push(best);
    y = best;
  }
  cuts.push(c.height);
  return cuts;
}

async function crop(c: HTMLCanvasElement, top: number, height: number): Promise<ArrayBuffer> {
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = Math.max(1, Math.round(height));
  out.getContext('2d')!.drawImage(c, 0, Math.round(top), c.width, out.height, 0, 0, c.width, out.height);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
  if (!blob) throw new Error('canvas');
  return blob.arrayBuffer();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** Draws a horizontal band of the source (source units) as a PNG of w × h display pixels, at 2× for sharpness. */
async function toPng(img: CanvasImageSource, band: { sy: number; sh: number; sw: number }, w: number, h: number): Promise<ArrayBuffer> {
  const scale = Math.min(RENDER_SCALE, 8000 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, band.sy, band.sw, band.sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('canvas');
  return blob.arrayBuffer();
}
