---
paths:
  - "widgets/heatmap/**"
  - "test/heatmap-*.test.ts"
  - "dev/heatmap-preview.html"
  - "lib/HeatmapService.ts"
  - "lib/heatmap.ts"
  - "dev/mock-heatmap.js"
---
# Insights Heatmap widget (`heatmap`)

- One capability's recent days as weekday rows × hour columns, like Homey's own insights heatmaps (the user's reference screenshot). `lib/HeatmapService.ts`; local-hour bucketing in `lib/heatmap.ts`.
- Settings: the `device` and `capability` autocompletes, `period` (`week`, the default: Mon–Sun with the days to come hatched; or the last `3`, `rolling` (7: its original id, kept), `10` or `14` days, today last; `heatmapPeriodDays()`), `step` (1/2/3 hours per column, default 2), `color` (Device Values' Flow colours, `blue` default; `data-color` on `.hm` only swaps `--hm-accent`), `showScale` and `showLegend` (on; the user asked to be able to hide them).
- Capabilities (`heatmapCaps()`): every `number` or `boolean` with `insights === true`.
- `GET /history?deviceId=&capabilityId=&days=` → `{name, icon, capability: {id, title, type, units, decimals}, value, days, language}`: 7 or 14 local days ending today (`spanFor()`, Homey's timezone), each `{date, weekday, hours: (number|null)[24]}`. The widget arranges the rows (with more than 7, the labels add the day of the month, `25 Fri`, in the language's order) and averages the reported hours into columns.
- Numbers: Insights `last7Days` or `last14Days` (hourly), one average per UTC hour put on its local hour (the autumn DST hour's two are averaged). Cached 5 min per span, dropped after 10 min without a request. Once a capability is known to be a number, its history is read alongside the device. Read through `readCapabilityLog()`.
- Booleans: Insights can't do a week (see Homey API facts), so the app records them. From the first `/history`, a capability instance logs each change as `[t, 0|1]`, backfilled with Insights' last 50 (`mergeChanges`), kept in the app setting `heatmapHistory` (saved at most once a minute, pruned to 15 days), resubscribed at app start, forgotten 8 days after the last request. A cell is the share of the known part of the hour that was true (`hourlyShareTrue`, in 15-min slices for half-hour timezones).
- Scale: 5 levels between the lowest and highest cell shown (all equal → the middle level, except a boolean never on → the lowest); booleans start at 0 % (with min–max a little motion read as "less"). The bar shows min/max and a marker (`5.2 lx now`; booleans `Active now`/`Inactive now`). Colours: the accent mixed into the empty-cell colour (`--hm-l0…4`).
- The legend keeps Less → More and Nothing reported on one line (the user asked): 16 px swatches, below 300 px (`@container hm`) 9 px without letter spacing, which fits every language; Nothing reported ellipsizes as a last resort.
- Labels 12/16. `.hm-frame` copies `.tw-frame`. No realtime; refetch every 5 min.
- Colour style (`colorStyle`, Muted/Vivid; CLAUDE.md *Widget styling*, `kit.css`): after `color`. Muted: the accent is the colour's shade (`--wk-<colour>-shade`) with the ramp as before; Vivid: the bright colour and a steeper ramp (20/44/66/86 %). The user swapped them (round 2, 2026-10-18).
