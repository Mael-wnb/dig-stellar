import { defineConfig } from 'tsup';

// ESM only (the MCP SDK is ESM). Two entries: the library (`createServer`, for tests and
// embedding) and the CLI (`bin`, stdio transport). Dependencies stay external; the shebang
// comes from src/cli.ts itself.
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: false,
  clean: true,
  target: 'node18',
  platform: 'node',
  treeshake: true,
});
