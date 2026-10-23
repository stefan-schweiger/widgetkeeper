---
paths:
  - "widgets/pollen/**"
  - "test/pollen-*.test.ts"
  - "dev/pollen-preview.html"
  - "lib/PollenService.ts"
  - "lib/pollenLevels.ts"
---
# Pollen and UV widget (`pollen`)

- wk-057 (the user's own idea). Today's pollen per type and the day's UV peak at the Homey's location (`homey.geolocation`). The look is "1c" of the mockups (`temp/pollen-directions.html`, 2026-10-22): the UV line on top, then a 32 px row per type. The user picked it, our own icons, and Open-Meteo only.
- Source: Open-Meteo's air-quality API (CAMS Europe; keyless, CC BY 4.0 with a Copernicus credit in the store text and README; free for non-commercial use under 10,000 calls a day). It has exactly six pollen types: `alder, birch, olive, grass, mugwort, ragweed` (`hazel_pollen` is refused). UV is worldwide.
  - Outside Europe the pollen values are `null` (New York, Tokyo), so `outside` comes from the data. Out of season inside Europe they're `0` (Copenhagen, Athens in October), so the widget's "No pollen in the air today" comes from the levels.
  - Rejected (2026-10-22): Google's Pollen API (15 plants, but a key with billing, 5,000 calls a month free, no caching, no UV), DWD (Germany only), SILAM (11 GB files, scientific use), Astma-Allergi Danmark (unofficial, personal use only).
- `lib/PollenService.ts`, on `ForecastCache` (`lib/forecastCache.ts`) like `WeatherService`: one fetch an hour at most (`TTL`), shared by every widget (one in-flight request per place), only while a widget asks (dropped 10 min after the last request once expired, and on a location change). A failed refetch keeps the last data and retries after 5 min. `uvNow` is the hour holding now (Open-Meteo's hours start on local hours: half past a UTC hour in India). `timeformat=unixtime`, `forecast_days=4`, `timezone` = Homey's.
- `GET /pollen` → `{days, uvNow, outside, language}` or `{noLocation, language}`. `days`: today and the next three, local days in Homey's timezone (`localHour()` from `lib/heatmap.ts`). Each type's value is the **mean** of the day's hours (the bands are 24-hour averages), with its level from `lib/pollenLevels.ts`. `uv`: the day's max, its level and its hour (ms).
- Levels (`pollenLevel()`): Astma-Allergi Danmark's bands plus a "very high" band. Birch, alder, olive: low 1, moderate 30, high 101, very high 1001 grains/m³. Grass, mugwort, ragweed: 1, 10, 51, 251. UV (`uvLevel()`): the WHO's, of the rounded index (low < 3, moderate < 6, high < 8, very high < 11, extreme).
- Settings: `density` (`compact`; `detailed` adds the grains under each level, the UV now, and the next three days: kept discreet at the user's request (2026-10-22, after filled cells with level words): 14 px icons, a 6 px dot in the level's colour and the level in words (12 px, text colour) per type and day, a grey dot and a dash for none (its word as the title), the UV peaks as muted numbers, 18 px rows. Tried before (2026-10-22): lone dots ("too much unused space"), thin four-step bars ("too much like the bars that show level"); beside A the user turned down a tinted chip (B) and the word in its colour (C, yellow unreadable on white)), `showUv` (on), `showAlder`…`showRagweed` (birch, grass and mugwort on by default; `pollenTypes()` reads a missing one as its default), `colorStyle`, `timeFormat` (Clock's; the peak time through the kit's `timeFormatter()`, in Homey's language like the numbers and weekdays).
- Colours: the levels are green, yellow, orange, red and purple (UV extreme) from `kit.css`. The bars, cells and sun are small solid parts, so Muted uses the shades and Vivid the bright colours (like Heatmap); `--pw-l1…5`, `data-level` on the row, line or cell. "None" has no colour.
- Icons: drawn for this widget, in `ICONS` in `widget.js` (24 px, 2 px round stroke, like the kit's). Birch: twig with a catkin and a leaf. Alder: two cones. Olive: branch with an olive. Grass: an ear with blades. Mugwort: its cut leaf. Ragweed: flower heads over cut leaves. The sun is ours too. The 15-plant set (for Google's list) is in `temp/pollen-drawn.js`.
- A Smart Stack page. No realtime; refetch every 5 min.
- Not yet seen on the Homey or a phone.
