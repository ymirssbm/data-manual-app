// Widget entry: built as an IIFE that exposes a global `DataManual`.
// The htmlwidgets binding (r-package/inst/htmlwidgets/dataManual.js) calls
// DataManual.render(el, x) from renderValue.
import { createRoot, type Root } from 'react-dom/client';
import { App } from './components/App';
import { createWidgetAdapter, type WidgetConfig } from './adapters/widget';
import './styles.css';

const roots = new WeakMap<HTMLElement, Root>();

export function render(el: HTMLElement, config: WidgetConfig) {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  // key forces a fresh App when R sends a new payload, so initial state resets.
  root.render(<App key={Date.now()} adapter={createWidgetAdapter(config)} />);
}

export function unmount(el: HTMLElement) {
  roots.get(el)?.unmount();
  roots.delete(el);
}
