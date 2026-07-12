import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/fetcher.ts'],
      reporter: ['text', 'html'],
    },
    environment: 'jsdom',
  },
});
