import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles the tests so decorator metadata is emitted, which Nest's
// dependency injection relies on (esbuild, Vitest's default, omits it).
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          globals: true,
          include: ['src/**/*.spec.ts'],
        },
      },
      {
        plugins,
        test: {
          name: 'integration',
          globals: true,
          include: ['test/**/*.int-spec.ts'],
          // One throwaway PostgreSQL server for the whole run.
          globalSetup: ['test/setup/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
