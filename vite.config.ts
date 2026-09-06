import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@parsers': resolve(__dirname, 'src/parsers'),
      '@diagnostics': resolve(__dirname, 'src/diagnostics'),
      '@viewer': resolve(__dirname, 'src/viewer'),
      '@panels': resolve(__dirname, 'src/panels'),
    },
  },
  server: {
    port: 5173,
  },
});
