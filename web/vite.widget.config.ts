// Widget build: one self-contained script for the R htmlwidget.
// Output is written straight into the R package so R users never need Node.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: resolve(__dirname, '../r-package/inst/htmlwidgets/lib/app'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/main-widget.tsx'),
      name: 'DataManual',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'widget.[ext]',
      },
    },
  },
});
