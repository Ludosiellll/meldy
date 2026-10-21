import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // The repository's README.md and README_HF.md (the Space card) are read by src/test/oneFace.test.ts.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1,
    clearMocks: true,
    restoreMocks: true,
    // On a loaded machine a few whole-page tests (the studio, the exam draw) pass the default 5 s; a hang still fails.
    testTimeout: 20000,
  },
});
