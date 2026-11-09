// Standalone entry: the app as a normal web page.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { createStandaloneAdapter } from './adapters/standalone';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App adapter={createStandaloneAdapter()} />
  </StrictMode>,
);
