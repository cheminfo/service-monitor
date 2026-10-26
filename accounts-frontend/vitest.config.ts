import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        // react-cheminfo loads its non-English chrome catalogs with dynamic
        // JSON imports that only Vite resolves, so its code runs through Vite
        // rather than Node's own loader.
        inline: ['react-cheminfo'],
      },
    },
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
    },
    snapshotFormat: {
      maxOutputLength: Number.MAX_SAFE_INTEGER,
    },
  },
});
