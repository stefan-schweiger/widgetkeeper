---
paths:
  - "widgets/spacer/**"
  - "test/spacer-*.test.ts"
  - "dev/spacer-preview.html"
---
# Spacer widget (`spacer`)

- An empty, transparent widget of a set height, to line up widgets across a dashboard's columns (wk-023: two users kept Widgey only for its spacer). `homey-widget-full`, nothing drawn.
- One setting, `height` (px, 16–800, default 32); `spacerHeight()` rounds and clamps it (anything else is 32), and `mount.js` sends it with `Homey.ready({height})`. Homey keeps its own gap above and below.
- No `api`, requests or strings, so it's left out of the `wireFrame()` check (it calls `Homey.ready` itself) and the fallback-strings test. Not a Smart Stack page (not in `STACK_TYPES`, `TYPES` or `stack_show`; `dashboardPages()` skips it). `npm run test-dashboards -- spacer`: four columns of clocks with spacers of 32, 16, 48 and 76 px.
- **On iOS a 0 px Spacer showed the app's loading placeholder** for good; 16, 32 and 76 px didn't (the user, `Test · Spacer`, 2026-10-23). The Popups widget did the same at 0 px and at 1 px. So the height is 16–800 px (the user's choice: 16, known to work, rather than finding the limit between 1 and 16): the manifest's `min` and `spacerHeight()`, which draws a 0 stored before as 16. Not yet checked: Android, and how it reads in edit mode.
