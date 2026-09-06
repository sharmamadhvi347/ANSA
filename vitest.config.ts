import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@parsers': resolve(__dirname, 'src/parsers'),
      '@diagnostics': resolve(__dirname, 'src/diagnostics'),
    },
  },
});
