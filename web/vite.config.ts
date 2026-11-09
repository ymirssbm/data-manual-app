// Standalone build: a static web app (dev server, GitHub Pages, etc.)
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { localServer } from './src/server/relay';

// The Wear-IT API sends no CORS headers, so the browser can't call it directly.
// The dev and preview servers forward /proxy/wearit/<server>/... to it.
// Only these two server paths are allowed through.
const wearitProxy: Record<string, ProxyOptions> = {
  '^/proxy/wearit/(wearables-survey|wearables-survey_sdb)/': {
    target: 'https://wearables.vmhost.psu.edu',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/proxy\/wearit/, ''),
  },
};

// REDCap, Qualtrics, Anthropic and OpenAI-compatible relays, and saved API keys: src/server/relay.ts
export { relayAllowed } from './src/server/relay';

export default defineConfig({
  plugins: [react(), localServer()],
  // Relative asset paths so the built app works from any static host or subfolder.
  base: './',
  server: {
    // The authoritative schema and examples live one level up.
    fs: { allow: ['..'] },
    proxy: wearitProxy,
  },
  preview: { proxy: wearitProxy },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
