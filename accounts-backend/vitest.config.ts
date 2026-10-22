import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Child processes keep the `node:` prefix that the default worker pool
    // can strip, which breaks `node:sqlite`.
    pool: 'forks',
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
    },
    snapshotFormat: {
      maxOutputLength: Number.MAX_SAFE_INTEGER,
    },
  },
});
