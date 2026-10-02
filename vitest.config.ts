import { defineConfig } from 'vitest/config';

// Set here so the test workers inherit it: the price slots and midnights depend on Homey's timezone.
process.env.TZ = 'Europe/Copenhagen';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
