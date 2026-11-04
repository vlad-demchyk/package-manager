import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    environment: 'node',
    // CLI tests assert English messages and bundled data; keep them independent of the machine.
    env: { PACKMAN_LANG: 'en', PACKMAN_DATA_DIR: '' },
  },
});
