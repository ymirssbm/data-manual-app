// Small browser helpers shared by views.

export function download(fileName: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'study';

// Mermaid is large, so it's loaded only when a flowchart is first drawn.
// Renders are queued because mermaid keeps global state during render().
type Mermaid = typeof import('mermaid').default;
let mermaidLoad: Promise<Mermaid> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

export function renderMermaid(code: string): Promise<string> {
  mermaidLoad ??= import('mermaid').then((m) => m.default);
  const job = queue.then(async () => {
    const mermaid = await mermaidLoad!;
    mermaid.initialize({
      startOnLoad: false,
      // Mermaid's default theme: the lavender boxes the prior tool's flowcharts used.
      theme: 'default',
      securityLevel: 'strict',
      htmlLabels: false,
      // The generator inserts its own line breaks, so mermaid's wrapping is set wide enough not to re-wrap.
      flowchart: { htmlLabels: false, curve: 'basis', useMaxWidth: false, nodeSpacing: 30, rankSpacing: 40, wrappingWidth: 420 },
      markdownAutoWrap: false,
      maxTextSize: 1_000_000,
      maxEdges: 5000,
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    });
    const { svg } = await mermaid.render(`dm-mermaid-${++counter}`, code);
    return svg;
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Rasterize an SVG string to a PNG blob at the given scale. */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.documentElement;
  const vb = el.getAttribute('viewBox')?.split(/\s+/).map(Number);
  const w = vb?.[2] ?? Number.parseFloat(el.getAttribute('width') ?? '800');
  const h = vb?.[3] ?? Number.parseFloat(el.getAttribute('height') ?? '600');
  el.setAttribute('width', String(w));
  el.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(el)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('Could not rasterize the flowchart.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('PNG export failed.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
