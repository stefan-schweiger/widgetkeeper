---
paths:
  - "widgets/spacer/**"
  - "test/spacer-*.test.ts"
  - "dev/spacer-preview.html"
---
# Spacer widget (`spacer`)

- An empty, transparent widget of a set height, to line up widgets across a dashboard's columns (wk-023: two users kept Widgey only for its spacer). `homey-widget-full`, nothing drawn.
- One setting, `height` (px, 0–800, default 32); `spacerHeight()` rounds and clamps it (anything else is 32), and `mount.js` sends it with `Homey.ready({height})`. Homey keeps its own gap above and below.
- No `api`, requests or strings, so it's left out of the copied-helpers check (`loadMarks()`/`perfParam()`) and the fallback-strings test. Not a Smart Stack page (not in `STACK_TYPES`, `TYPES` or `stack_show`; `dashboardPages()` skips it). `npm run test-dashboards -- spacer`: four columns of clocks with spacers of 32, 0, 16 and 76 px.
- Not yet checked on the Homey: whether a dashboard takes 0 or very small heights, and how it reads in edit mode.
