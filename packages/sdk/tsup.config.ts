import { defineConfig } from 'tsup';

// ESM + CJS + type declarations from one entry. Output names follow the `exports` map in
// package.json: dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts / index.d.cts.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  treeshake: true,
});
