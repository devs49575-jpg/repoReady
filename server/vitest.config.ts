import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/fixtures/**'],
    // Several files assert on the shared temp folder (and one on a shared test DB); run them serially.
    fileParallelism: false,
    // Integration tests run real tarball extraction and the madge worker; give them headroom.
    testTimeout: 30_000,
  },
});
