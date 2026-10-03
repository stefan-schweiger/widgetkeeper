# Widgetkeeper — notes for Claude

Homey Pro app (`com.thomassidor.widgetkeeper`) that hosts custom dashboard widgets: **Electricity Overview** (id `electricity`), **Thermostat Shortcuts** (id `thermostat`), **Device Quick Actions** (id `quickactions`), **Sensor Alarms** (id `sensoralarms`) and **Weather Forecast** (id `weather`). Keep the ids; renaming them would break widgets already on dashboards. Its design spec is in `temp/Homey electricity dashboard widget.zip`; `temp/` is gitignored.

## Commands
- Use the **project-local Homey CLI v4**: `npx homey …`. The global `homey` is an old 3.7.x.
- `npx homey app validate --level debug`: compiles the TS and validates.
- `npm test`: the vitest suite in `test/` (`npm run test:watch` to watch). It runs in Europe/Copenhagen. Service tests mock `homey-api` with fakes from `test/helpers/fakeHomey.ts`; widget tests run the unchanged `public/widget.js` in happy-dom (`test/helpers/loadWidget.ts`). CI (`.github/workflows/ci.yml`) runs typecheck, the tests and validate.
- `npm run diagnostics`: the app's diagnostics report and log from the active Homey (see Diagnostics below).
- `npm run typecheck`: `tsc` for the app, plus a basic (non-strict) `checkJs` pass over every `widgets/*/public/widget.js` (`tsconfig.widgets.json`; the window globals are declared in `types/widgets.d.ts`). TypeScript 7 defaults to strict, so that config sets `strict: false` explicitly.
- `npx homey app install`: builds and installs on the active Homey (firmware 13.x). No Docker needed.
- `npx homey app run`: live logs and hot reload of the widget files. It needs Docker Desktop running, which usually isn't.
- `npm run app-images`: renders the three app store PNGs from `dev/app-images.html` (the hero photo `dev/hero.webp`, cropped to 10:7) with headless Edge.
- `npm run previews [-- qa-dark …]`: renders the widget preview PNGs (all, or the ids given) from `dev/widget-previews.html` (the "Widget Previews" Claude Design project) with headless Edge. Open the page without a query to see them all; `?p=elec-dark` and so on shows one frame.
- `npm run screenshots [-- thermostat …]`: renders the README screenshots (`docs/screenshots/*.png`) from `dev/screenshots.html`: the real widgets with mock data on Homey's dark dashboard, 390 px at 3x. It downloads the Homey library icons the mock devices use into `temp/screenshot-icons.js` (not committed).
- `dev/preview.html`: the widget with mock data in a plain browser. Its mock snapshot is in `dev/mock-electricity.js`.
  - Serve the repo root (`python -m http.server 8765`) and open `/dev/preview.html`.
  - `?snap=/temp/real-snapshot.json` loads a real captured snapshot.
  - `#live=0.4` / `#price=0.3` simulates a scrub.
  - `dev/thermostat-preview.html`, `dev/quickactions-preview.html`, `dev/sensoralarms-preview.html` and `dev/weather-preview.html` do the same for the other widgets. The weather page takes `?snap=/temp/met-compact.json` (a real MET response); its mock is `dev/mock-weather.js`.
  - `?lang=de` (either page) uses `locales/de.json`, through `dev/i18n.js`.
  - Headless screenshots: `msedge --headless=new --screenshot=… --user-data-dir=<fresh dir>`. A fresh profile avoids a stale cached CSS.

## Architecture
- TypeScript, ESM (`"type": "module"`), compiled by `tsc` to `.homeybuild/`. Relative imports need `.js` extensions.
- `app.ts` owns one `ElectricityService` (`lib/ElectricityService.ts`). The service uses `homey-api` `HomeyAPI.createAppAPI`, which needs the `homey:manager:api` permission.
- The widget API (`widgets/electricity/api.ts`) has a single endpoint, `GET /snapshot?deviceId=`. It returns raw live readings for the last hour, 49 hourly price slots (index 24 is the current hour; the charts show the first 37, the lowest-price footer can look 24 h ahead), 5-min usage for the last ~24 h, the currency and Homey's language.
- Realtime: each meter reading goes out as `homey.api.realtime('electricity:live', {deviceId, t, w})`, throttled to 1/s, and the widget receives it with `Homey.on('electricity:live')`.
  - Meters are tracked lazily per requested device.
  - A meter is dropped after 10 min without a snapshot request. Widgets re-fetch every 5 min.
- The widget front end (`widgets/electricity/public/`) is **plain JS**, with no build step, because Homey serves it as-is.
  - `widget.js` exposes `createElectricityWidget(root, opts)`; `index.html` wires it to `Homey`.
  - Keep the SVG elements persistent across re-renders; replacing them breaks touch scrubbing.
  - Touch: the charts `preventDefault` every `touchstart`/`touchmove` (with `touch-action: none`). Without that, Homey's dashboard scrolls and cancels the scrub. The iOS app honours it.
  - Homey's Android app (a React Native WebView) ignores it. The native dashboard takes the touch about 100 ms in, before the first `touchmove`, and sends `pointercancel`; this was verified with an on-screen event log on a Galaxy Tab. No widget message is sent during touches, so no widget-side fix is possible.
  - So a tap selects (on `pointerdown`). A touch selection stays for 3 s after `pointerup`/`pointercancel`. Mouse selections reset on `pointerleave`.
  - It resamples the raw live readings to 120 points for the selected window and re-renders on a timer so the chart scrolls.
- Colours are Homey CSS tokens with spec-hex fallbacks, defined on `.ew` (not `:root`) so the light-mode overrides in the preview inherit.
- Both widgets stick to Homey's widget type scale (`--homey-font-size-*` with its matching `--homey-line-height-*`, and only the allowed weights: 14 regular, 17 any, 20 medium, 24/32 bold), `--homey-line-color(-light)` and `--homey-border-radius-*`, each with a px fallback. The font is set on `html`, so Homey's own font on `body` wins.

## Thermostat Shortcuts widget
- Three preset buttons for one device. `lib/ThermostatService.ts` owns it; `lib/appApi.ts` holds the shared `createAppAPI` instance.
- The device is an **autocomplete** setting (`device`), not the `devices` picker, because autocomplete listeners get the other settings but not the device selection. `app.ts` registers the listeners.
- Per button: `bNPower` (keep/on/off) and the autocompletes `bNTemp`, `bNMode` and `bNExtra`. Each autocomplete item carries `{capabilityId, value}`, read from the device's `target_temperature` range and its settable enum capabilities.
- Endpoints: `GET /state?deviceId=` and `POST /apply {deviceId, values}`. `apply` sets `onoff=true` first and `onoff=false` last.
- Realtime: `thermostat:state` `{deviceId, capabilityId, value}`. Tracking is dropped after 10 min without `/state`; widgets re-fetch every 5 min.
- The **Mode** field defines the mode capability (often the driver's own, not `thermostat_mode`). If the device has no `onoff`, "turn off" becomes that mode's `off` value and "turn on" is dropped (`deviceValues()` in the widget).
- `apply` sends mode → temperature → extra one at a time. It waits up to 4 s for each value to be reported, because some drivers check the fan speed against the *current* mode. Values the device already has are skipped.
- A button is highlighted while the device matches every value it sets. A preset that doesn't turn the device off never matches while the device is off.
- Layout: a header with the device icon and name, then a segmented row of three buttons. Each button's text is derived from its preset (`21°` / `Heat` / `Fan slow`, or `Off`). The custom label and icon settings are hidden for now.
- When no preset matches, the header shows `Currently Cool 23° · Fan auto` under the name.
- Type: the name and the button values are 17 bold. The buttons' mode/extra text is 12/16 regular, a deliberate exception to Homey's scale so three lines fit the 68 px buttons.
- In dark mode, `body.tw-frame` mimics Homey's native device tiles: a `#181920` fill and a 1px rim that's lighter at the top (a fixed `::after`, so it stays out of the height), using a 10px radius measured from a phone screenshot. It's gated on `.homey-dark-mode`; light mode keeps the default frame.
- The device icon is fetched by the app (`lib/deviceIcon.ts`), sent as an SVG data URL, and used as a CSS mask. A rounded square is the fallback.
  - A user-picked icon (`device.iconOverride`, e.g. `lock`, `christmas-lights`) comes from Homey's icon library at `https://my.homey.app/img/devices/<name>.svg`. That's public, and it's where the web app's own bundle loads it from.
  - Otherwise it's the driver's icon: `api.baseUrl` + `device.iconObj.url`.
  - Every icon URL is fetched once per app run (`lib/deviceIcon.ts`); fetching took 150–450 ms per widget load.

## Device Quick Actions widget
- Half-height tiles for several devices (the `devices` setting with `singular: false`, read with `Homey.getDeviceIds()`), 3 per row. `lib/QuickActionService.ts` owns it. The widget is `transparent`, so each tile sits on the dashboard like a native one.
- The whole tile triggers the device's quick action and shows its state. The `activeStyle` setting picks how: `tint` (default; a blue-tinted tile with blue icons) or `lighter` (a lighter grey tile). There's no circle around the quick-action icon.
- The name is 14/20 regular, like the native device tiles' name (measured from a phone screenshot).
- The quick action is `ui.quickActionOverride` (the user's choice; `.none` turns it off) or else `ui.quickAction`. Locks only have the override (`locked`).
- Taps come from the touch events (a touch ending within 10 px of where it started), with `click` kept for mouse and keyboard. A drag is left alone, so the dashboard still scrolls. Tiles do nothing in the dashboard's edit mode.
- Only settable booleans can be triggered. `button*` capabilities are momentary: always `true`, and the tile flashes.
- Icons: Homey's standard capabilities have `iconObj: null` (the Homey app draws those icons), so the widget has built-in power/padlock/play/button glyphs. A custom capability's own icon (e.g. the Roborock's `clean_full`) is used when present.
- Endpoints: `GET /state?deviceIds=a,b` (one entry per id, in order; deleted devices are `{id, missing: true}`) and `POST /trigger {deviceId, value}`, which only ever sets the quick-action capability.
- Realtime: `quickactions:state` `{deviceId, capabilityId, value}`. Tracking is dropped after 10 min without `/state`; widgets re-fetch every 5 min.
- `/state` re-reads an already-tracked device (`current()`), so a rename, a changed quick action (re-tracked) or a deleted device (`missing`) shows on the next refresh. Without that an open widget kept the first read forever.
- A failed 5-min refresh keeps the tiles and shows the error as a transient message; only a failed first load replaces the tiles with it.
- The diagnostics report lists every device with its quick action, override, type and icon.

## Sensor Alarms widget
- Tiles for several devices (the `devices` setting, `singular: false`, no filter so custom alarm capabilities count), 2 per row, in the style of Homey's native temperature tiles. `lib/SensorAlarmService.ts` owns it. The widget is `transparent`, like Quick Actions.
- A tile: the device icon (24 px, muted), the name (14 bold) and the alarm text (14 regular, muted), both on an 18px line: deliberate exceptions to Homey's scale, measured from the native tiles. The tile is `#2B2C36` in dark mode, flat, with a 10px radius and 52 px high, all measured from a phone screenshot of the native temperature tiles.
- Alarms are every boolean capability whose base id starts with `alarm_` (`alarmCaps()`), custom ones included (an Airthings' `alarm_radon`). Each one carries its `title` (localised by Homey) and `state`: true for `alarm_motion`/`alarm_contact` and the cameras' `alarm_person`/`alarm_vehicle`/`alarm_pet`. Those only count with the `includeStates` checkbox (off by default); the widget filters, not the service.
- Active alarms are counted once per title without a trailing `(…)`: the Airthings reports radon three times (`Radon alarm`, `… (Bq/m³)`, `… (pCi/L)`).
- Text: `No alarm`, the one active alarm's title, or `__count__ alarms` (the user chose a count over a list). Without counted alarm capabilities: `No alarm sensors`. Any active alarm makes the tile red (`.alarm`: a red-tinted tile, red icon and text); the user chose always red over a colour per alarm type.
- Endpoint: `GET /state?deviceIds=a,b`, one entry per id (`{id, name, icon, alarms}` or `{id, missing: true}`). `/state` re-reads tracked devices and re-tracks when the set of alarm capabilities changed.
- Realtime: `sensoralarms:state` `{deviceId, capabilityId, value}`. Tracking is dropped after 10 min without `/state`; widgets re-fetch every 5 min. A failed refresh keeps the tiles, as in Quick Actions.
- The diagnostics report lists each device's alarm capabilities and values (`alarms`).

## Weather Forecast widget
- The next 36 hours for the Homey's location (`homey.geolocation`, which needs the `homey:manager:geolocation` permission), from MET Norway's Locationforecast 2.0 `compact` (the data behind yr.no).
- Settings: `density` (`compact`, the default, or `detailed`), `rows` (`1` or `2`) and `step` (`1`, `2` or `3` hours per column). They're passed to `createWeatherWidget` as `opts.density`, `opts.rows` and `opts.step`.
- With `step` 2 or 3, the widget combines the hours (`group()`/`combine()` in `widget.js`) into columns on the clock (00, 03, 06 …); the first one runs from the current hour to the next boundary.
  - A combined column has the average temperature and wind speed, the summed precipitation (a total is more useful than an average), the wind direction averaged as vectors weighted by speed, and the icon of the wettest hour (the first hour's when dry).
  - The footer's day ranges always use the raw hours. `lib/WeatherService.ts` owns it.
- MET's terms, which the service follows:
  - An identifying `User-Agent` (`Widgetkeeper/<version> github.com/thomassidor/widgetkeeper`); without one MET answers 403.
  - At most 4 decimals in the coordinates. We round to 3.
  - No refetch before `Expires` (about 30 min), then revalidate with `If-Modified-Since` (a `304` only moves the expiry on).
  - The limits count the traffic from every installation, so it only fetches while a widget asks. The cache is dropped after 10 min without a request or when the Homey's location changes.
  - The data is CC BY 4.0. The credit is in the store text (the last line of each `README.<lang>.txt`) and in README.md, not in the widget, whose footer has the day ranges instead.
- A failed refetch keeps serving the previous forecast and retries after 5 min. The first fetch failing is an error.
- Endpoint: `GET /forecast` returns up to 48 hourly entries from the current hour, `{t, symbol, temp, wind, windDir, precip}`, plus `updatedAt` and `language`, or `noLocation: true`. The widget shows 36, and drops passed hours on the hour itself.
- Fields used: `instant.details.air_temperature`, `wind_speed` and `wind_from_direction`, and `next_1_hours`'s `symbol_code` and `precipitation_amount`. Compact is hourly for about 60 h, then 6-hourly (no `next_1_hours`).
- Icons: MET's own set (`metno/weathericons`, MIT), vendored in `widgets/weather/public/icons/`. The file names are the symbol codes.
  - `/forecast` also sends `icons`: the SVG text of each symbol in use, read from those files once per app run (a few KB each, usually 3–10 symbols). Otherwise each icon would be its own request through Homey (~0.4 s).
  - The widget turns them into data URLs, falling back to `icons/<symbol>.svg`.
  - The widget skips rebuilding the strip when a refresh brings the same hours, the same hour and the same column count. MET kept the `lightssleet…`/`lightssnow…` typos in both.
- Layout: a strip of hour columns: the hour label, the icon, the temperature, then precipitation and wind at 12/16. Columns are `100% / --wf-cols`, set by container queries.
  - Detailed: a 36 px icon and the temperature at 17 bold, with units on every value. 6 columns by default, 5 below 340 px (phones), 8 from 460 px, 10 from 620 px.
  - Compact: a 28 px icon and the temperature at 14 bold (a deliberate exception to Homey's scale, so `-12°` fits about 34 px). Plain numbers, with `mm · m/s` once in the footer. 10 columns by default, 9 below 340 px, 8 below 300 px, 13 from 460 px, 18 from 620 px.
  - Two rows: pages (`.wf-page`) of 2 × `--wf-cols` hours, each the strip's full width, with mandatory scroll snap. `widget.js` reads `--wf-cols` from the computed style, falling back to 9/5, and re-renders through a `ResizeObserver` when it changes. The edge fades are off in this mode.
  - Temperature colour runs blue → the text colour → red. `colorTemp()` in `widget.js` sets a `cold`/`warm` class and `--k` (0–1): neutral at 12°, full blue at -5°, full red at 28°. CSS blends with `color-mix(in oklab, …)`. It's not white, so it still reads in light mode.
    - The ends have a dark pair (under `.homey-dark-mode`) and a darker light pair; each passes 4.5:1 as text.
    - The user rejected a red/blue split at 0° ("red for 10° is weird") and then a rainbow scale ("green is weird"). Precipitation is blank at 0. The wind arrow points to where the wind blows (`wind_from_direction` + 180°).
  - The first column is "Now", and midnight shows the weekday in Homey's language, with a divider line.
- Scrolling is native `overflow-x` with no `preventDefault`, so vertical swipes still scroll the dashboard. A mouse drags it.
  - Untested on Android, where the dashboard steals touches. If it cancels the horizontal scroll there, add ‹ › paging buttons (taps work).
- Footer: today's and tomorrow's high and low (`Today ↑10° ↓4°  Tomorrow ↑8° ↓-2°`, coloured like the temperatures), worked out in the widget from all 48 hours in the device's local days. Today only counts from the current hour, because the forecast starts there. In compact, `mm · m/s` sits on the right.
- The dark frame (`.wf-frame`) copies the thermostat's `.tw-frame`.

## Diagnostics (no Docker needed)
- **Read it yourself with `npm run diagnostics`** (`scripts/diagnostics.mjs`); don't ask the user to paste it. It calls the app's `GET /diagnostics` on the active Homey through `homey api raw`, which uses the CLI's login. Options: `-- --device <id|name>`, `--devices`, `--json`, `--debug on|off`. Right after an install the app may still be starting, so retry.
- `lib/Diagnostics.ts` keeps the last 500 log lines. The report's `weather` section has the rounded location, the last fetch, `Expires`, and the last status and error. `app.log`/`app.error` are overridden to feed it.
- Errors and warnings always go to `log`. Routine detail (tracking, timings, applies, widget load marks) goes to `debug`, which logs only while the `debugLog` app setting is on (`npm run diagnostics -- --debug on`; off by default, and the report shows it). Services take `debug` as an optional third constructor argument.
- Load timings (`lib/Timings.ts`, debug): each snapshot/state request logs its total and per-step ms. A widget's first request also sends `perf=` (frame start, HTML, SDK ready, request), logged as `<Widget> widget: frame started … SDK ready 1100 ms`.
- Measured on 2026-10-03 (phone app): Homey creates all frames at once, the HTML arrives ~0.3 s in, the SDK is ready ~1.0–1.1 s in, and each request takes ~0.4 s each way through Homey. The app answers in 0–30 ms when warm, ~60–150 ms after the 10-min idle drop, ~0.2–0.4 s right after an app restart. So most of a widget's load time is Homey's, not ours.
- At start, `app.ts` connects the API and `ElectricityService.warmUp()` fetches the prices. Concurrent requests for a price day share one fetch.
- It's also shown on the app settings page (`settings/index.html`; Homey app → Apps → Widgetkeeper → Configure) through the authenticated app API `GET /diagnostics[?device=]` (`api.ts`). Pick a device to get its full capability details.

## Homey API facts (verified on the real Homey)
- Dynamic prices: `energy.fetchDynamicElectricityPrices({ date: 'YYYY-MM-DD' })` returns `{ priceUnit: 'DKK', interval: 60, pricesPerInterval: [{ periodStart, periodEnd, value }] }`. Zone DK2. `getCurrency()` returns `"DKK"`.
- Insights: `getLogEntries({ uri: 'homey:device:<id>', id: 'homey:device:<id>:<cap>', resolution })`. **The `id` is the full log id.**
  - `lastHour` has a 5 s step; `last24Hours` has a 5 min step.
  - The frient meter logs power as `energy_power`, not `measure_power`. The service reads `measure_power`, then `energy_power` (a missing log throws), and remembers the one that worked per device. Don't go back to `insights.getLogs()`: it lists every log on the Homey.
- The meter is a frient EMIZB-141 ("Electricity Meter", id `3450f8d3-…`). It reports `measure_power` about every 10 s, and Homey doesn't re-emit unchanged values.
- Widget `devices` setting (`type: global, singular, filter capabilities measure_power`); read it with `Homey.getDeviceIds()`.
- A widget can't open Homey's native device sheet. On the phone app (2026-10-03) the widget `Homey` object has only the documented methods (`ready api on getSettings getWidgetInstanceId getDeviceIds setHeight popup hapticFeedback __`); `popup(url)` just opens an in-app browser. A web search found no other route either. So the Sensor Alarms tiles are display-only.
- Widget preview images are 1024×1024. App images are 250×175, 500×350 and 1000×700.

## Localization
- All 13 Homey languages: en nl de fr it sv no es da ru pl ko ar.
- The widget, thermostat-service and settings-page strings are in `locales/<lang>.json`. The manifest strings are in the compose JSONs, and the store text is in `README.<lang>.txt`.
- `test/locales.test.ts` fails if a key, a `__token__` or a manifest language is missing. A new string needs all 13 languages.
- Keep the strings as short as the English. The 300 px narrow widget truncates the header subtitles and the footer label.
- Arabic keeps the LTR layout. The text elements are `dir="auto"` with `text-align: left`.

## Widget settings
`liveWindow` (60/30/10/5/1/0.5 min, default 10) · `showUsage` · `separateUsage` (usage as its own chart above price) · `nextLow` (none/12/24/both, default 12; replaced the `showNextLow` checkbox, which `index.html` still honours as a fallback).

## Design decisions that differ from the spec
- The live window is configurable, with relative axis labels (`1h · 30m · Now`).
- Axis labels are 12 px, to match Homey's native energy widgets; the gutters and plots were resized to match.
- The chart title chips and the whole footer are 12/16 too (`--ew-fs-label`), a step below Homey's scale. The header subtitles (`Using now`, `min left`) stay 14, the header values 24.
- There are dashed midnight lines on the slot charts.
- The footer shows only the start hour and price (`03:00 • 1,22 kr.`). With both 12h and 24h: `Lowest 12/24h   03:00 • 1,22 / 03:00 • 1,22` (no unit), or a single `03:00 • 1,22 kr.` when both are the same slot.
- Weekday names follow Homey's language, and numbers follow the device locale.

## Branding
- From the "Widgetkeeper Logo" Claude Design project: brand colour `#2A1958` (`brandColor` in `.homeycompose/app.json`).
- Logomark: three outlined rounded squares and a four-point sparkle in the top-right cell, on a 64×64 grid. `assets/icon.svg` is the black mark on transparent (Homey tints it).
- The widgets keep Homey's own blue for chart colours; the brand colour is only for the app's identity.
