/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest config for the client RTL smoke tests.
 *
 * Kept separate from `vite.config.ts` so the production build config stays
 * lean and never pulls in the test-only plugins. Tests run under jsdom so
 * `window.fetch`, `document`, and navigation primitives behave like a
 * browser; we mock `fetch` per-test rather than hitting a real server.
 *
 * Convention: co-locate tests next to the component (`foo.test.tsx` next
 * to `foo.tsx`) or drop them in `src/__tests__/`. Both are picked up by
 * the default include pattern below.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
