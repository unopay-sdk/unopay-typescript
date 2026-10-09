import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration flows drive real sandbox state (pending_settle blocks ~5s inside verify);
    // unit tests finish in milliseconds regardless of this ceiling.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
