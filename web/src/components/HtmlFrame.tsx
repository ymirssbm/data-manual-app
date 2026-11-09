import { forwardRef, useEffect, useRef, useState } from 'react';

/**
 * Shows a full HTML document in an iframe served from a blob: URL.
 * (With srcdoc, "#anchor" links resolve against the app's own URL, so clicking
 * one loaded the whole app inside the frame. Blob URLs keep links in-document.)
 * Scroll position is kept when the document is replaced, so live previews
 * don't jump back to the top on every change.
 */
export const HtmlFrame = forwardRef<HTMLIFrameElement, { html: string; title: string; className?: string }>(function HtmlFrame({ html, title, className }, ref) {
  const [url, setUrl] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const scroll = useRef(0);

  useEffect(() => {
    try {
      scroll.current = frame.current?.contentWindow?.scrollY ?? scroll.current;
    } catch {
      // Cross-origin can't happen with blob URLs from this page; ignore defensively.
    }
    const u = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [html]);

  return url ? (
    <iframe
      ref={(el) => {
        frame.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      title={title}
      src={url}
      className={className}
      onLoad={() => {
        const w = frame.current?.contentWindow;
        if (w && scroll.current) w.scrollTo(0, scroll.current);
      }}
    />
  ) : null;
});
