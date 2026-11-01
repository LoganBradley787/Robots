import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'sim-core',
    // Worlds and duels run minutes on a loaded laptop, and a limit is never what a test checks. Set here alone: no test sets its own.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
