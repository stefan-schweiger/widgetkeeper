import { defineConfig } from 'vitest/config';

// Set here so the test workers inherit it: the tests' fixtures are Copenhagen times, like the Homey they were checked on.
process.env.TZ = 'Europe/Copenhagen';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // `npm run coverage`: a report (coverage/index.html and a summary), not a gate. The widget and page scripts run
    // unchanged in the tests, under their own file names (test/helpers/loadWidget.ts' `runFile()`), so they're counted too.
    coverage: {
      provider: 'v8',
      include: ['app.ts', 'api.ts', 'lib/**/*.ts', 'widgets/*/api.ts', 'widgets/*/public/*.js', 'settings/*.js'],
      exclude: ['settings/socket.io.js'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
