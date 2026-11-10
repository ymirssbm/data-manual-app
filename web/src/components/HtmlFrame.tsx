import { forwardRef, useEffect, useRef, useState } from 'react';

/** Carries page state (open panels, chosen tabs) from one version of the document to the next. */
export interface FramePreserve<S> {
  capture(doc: Document): S;
  restore(doc: Document, state: S): void;
  /** When this changes, the saved state is dropped instead of restored (e.g. "expand all" was switched). */
  key?: string;
}

interface Props {
  html: string;
  title: string;
  className?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preserve?: FramePreserve<any>;
}

/**
 * Shows a full HTML document in an iframe served from a blob: URL.
 * (With srcdoc, "#anchor" links resolve against the app's own URL, so clicking
 * one loaded the whole app inside the frame. Blob URLs keep links in-document.)
 * Scroll position is kept when the document is replaced, so live previews
 * don't jump back to the top on every change; with `preserve`, so is what was open.
 */
export const HtmlFrame = forwardRef<HTMLIFrameElement, Props>(function HtmlFrame({ html, title, className, preserve }, ref) {
  const [url, setUrl] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const scroll = useRef(0);
  const saved = useRef<{ state: unknown; key?: string } | null>(null);
  const preserveRef = useRef(preserve);
  preserveRef.current = preserve;

  useEffect(() => {
    try {
      const w = frame.current?.contentWindow;
      scroll.current = w?.scrollY ?? scroll.current;
      const p = preserveRef.current;
      const doc = frame.current?.contentDocument;
      if (p && doc?.body?.childElementCount) saved.current = { state: p.capture(doc), key: p.key };
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
        const doc = frame.current?.contentDocument;
        const p = preserveRef.current;
        if (p && doc && saved.current && saved.current.key === p.key) {
          try {
            p.restore(doc, saved.current.state);
          } catch {
            // A state that no longer fits the page is simply not restored.
          }
        }
        if (w && scroll.current) w.scrollTo(0, scroll.current);
      }}
    />
  ) : null;
});
