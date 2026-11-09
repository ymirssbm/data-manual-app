import { defineConfig } from 'vite';

// The MCP server as one self-contained Node file (dist-mcp/data-manual-mcp.mjs), reusing the app's
// translators, connectors and generators. Run it with `node dist-mcp/data-manual-mcp.mjs`.
export default defineConfig({
  build: {
    ssr: 'src/mcp/server.ts',
    outDir: 'dist-mcp',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'data-manual-mcp.mjs', inlineDynamicImports: true },
    },
  },
  ssr: {
    // Bundle dependencies too, so the file runs without node_modules.
    noExternal: true,
    target: 'node',
  },
});
