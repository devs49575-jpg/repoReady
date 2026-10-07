import { defineConfig } from 'tsup';

export default defineConfig({
  // The architecture worker is its own entry: it is loaded by path with new Worker(), next to index.js.
  entry: {
    index: 'src/index.ts',
    'architecture.worker': 'src/workers/architecture.worker.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Shared package ships TypeScript source, so bundle it instead of importing it at runtime.
  noExternal: ['@repoready/shared'],
});
