// Live-preview helpers for the codebook generator: keep what the reader had open across rebuilds,
// and highlight the parts of the page a Content option controls.

/** What the reader had open in the preview: folded sections, open question bodies, chosen tabs. */
export interface PreviewState {
  visuals: Record<string, boolean>;
  sections: Record<string, boolean>;
  tabs: string[];
  toc: Record<string, boolean>;
  tocHidden: boolean | null;
}

const SECTION_HEADING = ':scope > h1[id], :scope > h2[id], :scope > h3[id], :scope > .cb-block-head h3[id]';

export function capturePreviewState(doc: Document): PreviewState {
  const visuals: Record<string, boolean> = {};
  doc.querySelectorAll('.cb-visuals[id]').forEach((el) => (visuals[el.id] = !el.hasAttribute('hidden')));
  const sections: Record<string, boolean> = {};
  doc.querySelectorAll('section').forEach((sec) => {
    const h = sec.querySelector(SECTION_HEADING);
    if (h) sections[h.id] = sec.classList.contains('is-collapsed');
  });
  const tabs = [...doc.querySelectorAll('.cb-tab.is-active')].map((t) => t.getAttribute('data-tab') ?? '').filter(Boolean);
  const toc: Record<string, boolean> = {};
  doc.querySelectorAll('.cb-toc li.has-children').forEach((li) => {
    const href = li.querySelector(':scope > .cb-toc-row > a')?.getAttribute('href');
    if (href) toc[href] = li.classList.contains('is-collapsed');
  });
  const body = doc.getElementById('cb-toc-body');
  return { visuals, sections, tabs, toc, tocHidden: body ? body.hasAttribute('hidden') : null };
}

/** Re-applies a captured state through the codebook's own toggles, so arrows and labels stay in step. */
export function restorePreviewState(doc: Document, s: PreviewState): void {
  const click = (el: Element | null | undefined) => (el as HTMLElement | null | undefined)?.click();
  for (const [id, open] of Object.entries(s.visuals)) {
    const el = doc.getElementById(id);
    if (el && el.hasAttribute('hidden') === open) click(doc.querySelector(`[data-target="${CSS.escape(id)}"]`));
  }
  for (const [id, collapsed] of Object.entries(s.sections)) {
    const sec = doc.getElementById(id)?.closest('section');
    if (sec && sec.classList.contains('is-collapsed') !== collapsed) {
      click(sec.querySelector(':scope > h1 .cb-sec-toggle, :scope > h2 .cb-sec-toggle, :scope > h3 .cb-sec-toggle, :scope > .cb-block-head .cb-sec-toggle'));
    }
  }
  for (const tab of s.tabs) {
    const el = doc.querySelector(`.cb-tab[data-tab="${CSS.escape(tab)}"]`);
    if (el && !el.classList.contains('is-active')) click(el);
  }
  for (const [href, collapsed] of Object.entries(s.toc)) {
    const li = doc.querySelector(`.cb-toc a[href="${CSS.escape(href)}"]`)?.closest('li.has-children');
    if (li && li.classList.contains('is-collapsed') !== collapsed) click(li.querySelector(':scope > .cb-toc-row > .cb-twisty'));
  }
  const body = doc.getElementById('cb-toc-body');
  if (body && s.tocHidden != null && body.hasAttribute('hidden') !== s.tocHidden) click(doc.querySelector('.cb-toc-toggle'));
}

const HL_CLASS = 'dm-opt-hl';
const HL_STYLE = `.${HL_CLASS}{outline:3px solid #f59e0b!important;outline-offset:3px;background-color:rgba(245,158,11,.14)!important;border-radius:4px;transition:outline-color .15s,background-color .15s}`;

/**
 * Highlights every element tagged with one of `keys` (data-cb-opt). Returns how many there are and
 * how many are visible right now, so the caller can say when the part is folded away or off-screen.
 */
export function highlightOptions(doc: Document, keys: string[]): { total: number; visible: number } {
  if (!doc.getElementById('dm-opt-hl-style')) {
    const st = doc.createElement('style');
    st.id = 'dm-opt-hl-style';
    st.textContent = HL_STYLE;
    doc.head.appendChild(st);
  }
  doc.querySelectorAll(`.${HL_CLASS}`).forEach((el) => el.classList.remove(HL_CLASS));
  if (!keys.length) return { total: 0, visible: 0 };
  const sel = keys.map((k) => `[data-cb-opt~="${CSS.escape(k)}"]`).join(',');
  let visible = 0;
  let total = 0;
  const vh = doc.defaultView?.innerHeight ?? 0;
  doc.querySelectorAll(sel).forEach((el) => {
    el.classList.add(HL_CLASS);
    total++;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && r.bottom > 0 && r.top < vh) visible++;
  });
  return { total, visible };
}
