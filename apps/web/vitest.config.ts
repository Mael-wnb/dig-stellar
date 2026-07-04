// apps/web/vitest.config.ts
// Dedicated Vitest config, kept separate from vite.config.ts so the strict
// production build (vue-tsc + vite build) never pulls in test-only types.
// It mirrors the app's `@` -> ./src alias so imports resolve the same in tests.
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // The code under test (XDR validation) is pure — no DOM needed.
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // @stellar/stellar-sdk ships ESM that pulls in Node built-ins; inline it so
    // Vitest's transform pipeline resolves it cleanly instead of externalizing.
    server: {
      deps: {
        inline: ['@stellar/stellar-sdk'],
      },
    },
  },
})
