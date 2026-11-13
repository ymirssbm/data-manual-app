// The AI assistant from any page: a small ✦ button in the corner opens a chat panel that shares the
// conversation with the AI Study Generator page. The panel can be minimized back to the button,
// popped out into its own window (handy on a second screen), or hidden completely (bring it back
// from the AI Study Generator page).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChatView, type AiChat } from './pages/Ai';

const HIDE_KEY = 'dm.ai.bubble.hidden';

export function loadAssistantHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}
export function saveAssistantHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDE_KEY, '1');
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    /* per-viewer convenience only */
  }
}

export function AiBubble({ chat, openPage, hidden, onHide }: { chat: AiChat; openPage(): void; hidden: boolean; onHide(): void }) {
  const [mode, setMode] = useState<'button' | 'open' | 'window'>('button');
  const popup = useRef<Window | null>(null);
  const [popupRoot, setPopupRoot] = useState<HTMLElement | null>(null);

  // Pop out: a separate browser window showing the same chat (one React tree, so one conversation).
  const popOut = () => {
    const w = window.open('', 'data-manual-ai', 'width=480,height=720');
    if (!w) return; // blocked: stay in the panel
    w.document.title = 'AI assistant · Data Manual';
    w.document.head.innerHTML = '';
    for (const el of document.querySelectorAll('style, link[rel="stylesheet"]')) w.document.head.appendChild(el.cloneNode(true));
    const app = document.querySelector('.dm-app') as HTMLElement | null;
    w.document.body.innerHTML = '';
    w.document.body.style.margin = '0';
    const root = w.document.createElement('div');
    root.className = `${app?.className ?? 'dm-app'} dm-ai-window`;
    for (const a of ['data-theme', 'data-sidebar', 'style']) {
      const v = app?.getAttribute(a);
      if (v) root.setAttribute(a, v);
    }
    w.document.body.appendChild(root);
    popup.current = w;
    setPopupRoot(root);
    setMode('window');
  };
  // Closing the window brings the chat back to the button.
  useEffect(() => {
    if (mode !== 'window') return;
    const t = setInterval(() => {
      if (popup.current?.closed) {
        popup.current = null;
        setPopupRoot(null);
        setMode('button');
      }
    }, 500);
    return () => clearInterval(t);
  }, [mode]);
  useEffect(() => () => popup.current?.close(), []);

  if (hidden && mode !== 'window') return null;

  const close = () => {
    popup.current?.close();
    setMode('button');
  };
  const head = (inWindow: boolean): ReactNode => (
    <header className="dm-ai-pop-head">
      <strong>AI assistant</strong>
      <span className="dm-hint">{chat.modelLabel}</span>
      <span className="dm-inline dm-inline-tight dm-push-right">
        {chat.messages.length > 1 && (
          <button className="dm-link-btn" onClick={() => chat.setMessages((m) => m.slice(0, 1))} disabled={!!chat.busy}>
            New chat
          </button>
        )}
        {!inWindow && (
          <button className="dm-icon-btn" onClick={popOut} aria-label="Pop out" title="Pop out into its own window">
            ⧉
          </button>
        )}
        <button className="dm-icon-btn" onClick={close} aria-label="Minimize" title={inWindow ? 'Back into the page' : 'Minimize (the chat keeps going)'}>
          −
        </button>
        <button className="dm-icon-btn" onClick={() => (close(), onHide())} aria-label="Hide the assistant" title="Hide the assistant on every page (turn it back on from the AI Study Generator page)">
          ×
        </button>
      </span>
    </header>
  );
  const body = (inWindow: boolean) => (
    <>
      {head(inWindow)}
      <p className="dm-hint dm-ai-pop-context">{chat.spec ? `Working on: ${chat.spec['Study.Metadata']['Study.Name']}. Changes it suggests are shown before you use them.` : 'No study loaded: describe one to create it.'}</p>
      {chat.config.apiKey ? (
        <ChatView chat={chat} compact />
      ) : (
        <div className="dm-ai-pop-setup">
          <p>Add an AI API key in AI settings first.</p>
          <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={() => (close(), openPage())}>
            Open AI settings
          </button>
        </div>
      )}
    </>
  );

  if (mode === 'window' && popupRoot) return createPortal(<section className="dm-ai-pop is-window">{body(true)}</section>, popupRoot);
  if (mode === 'open')
    return (
      <section className="dm-ai-pop" role="dialog" aria-label="AI assistant">
        {body(false)}
      </section>
    );
  return (
    <button className="dm-ai-bubble" onClick={() => setMode('open')} title="AI assistant" aria-label="Open the AI assistant">
      {chat.busy ? <span className="dm-spinner" /> : <span aria-hidden="true">✦</span>}
    </button>
  );
}
