import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
        'src/domain/**': { lines: 95, functions: 95, statements: 95, branches: 90 },
        'src/application/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
      },
    },
  },
});
