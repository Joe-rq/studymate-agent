import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },
    coverage: {
      include: ['src/**'],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
