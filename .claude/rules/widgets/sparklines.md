---
paths:
  - "widgets/sparklines/**"
  - "test/sparklines-*.test.ts"
  - "dev/sparklines-preview.html"
  - "lib/SparklineService.ts"
  - "lib/insightsLog.ts"
---
# Sparklines widget (`sparklines`)

- Device Values' tiles, 2 or 1 per row (`columns`, `"2"`), 104 px: the capability icon and value on top, a 36 px chart, the device name below. A 1.5 px line in Homey's blue with a 15 % area and a dot on the latest point; the highest (`↑23`) and lowest (`↓19.5`) shown value at its right edge, 12/16 muted, without units (the user chose this over a footer line or the name row). Display only; transparent. `lib/SparklineService.ts`.
- Settings: `span` (`1h`, `6h`, `24h` default, `2d`, `3d`, `5d`, `7d`), `columns`, `slot1`…`slot6` (as Device Values', listing only numbers with `insights === true`, `sparkCaps()`). Booleans were left out: their log is only the last 50 changes.
- History: Insights `lastHour` (5 s steps), `last6Hours` (1 min), `last24Hours` (5 min), `last3Days` (1 h; also for `2d`) or `last7Days` (1 h; also for `5d`); `last2Days` and `last5Days` are `Invalid Resolution` (2026-10-06/09). `downsample()` averages into at most 120 points at the bucket middles, no bucket shorter than the log's step (`2d` is 48 hourly points, not stairs; `bucketAverage` carries the last value over gaps). Cached per slot and span for 5 min with shared fetches, dropped after 10 min without a request; the raw log is shared per slot and resolution for 5 min (`readLog()`), so 2d/3d and 5d/7d read it once. A failed log gives no history (cached too: 5 min, or 30 s when Homey was busy) but still the value. Read through `readCapabilityLog()` (until 2026-10-09 every power sparkline started empty: a user's report).
- Live: `ValueService.getState()` gives the name, icon and value, so tracking and `values:state` are Device Values'. Each live number is appended and the line runs on to now at the current value; a refresh keeps the live points newer than its last point. Redrawn every `span / 120` (10–60 s), so the line scrolls.
- `GET /state?slots=a:cap,b:cap&span=24h`: Device Values' entries plus `points: [t, v][]`.
- It copies Device Values' glyphs (trimmed to numbers; the number formatting is the kit's); `sparkPath()` (on `window`) draws the paths. The SVG elements stay in place and are measured at each render (a `ResizeObserver` redraws).
