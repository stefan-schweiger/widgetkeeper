# Widgetkeeper — notes for Claude

Homey Pro app (`com.thomassidor.widgetkeeper`) that hosts custom dashboard widgets: **Electricity** and **Thermostat shortcuts**. Its design spec is in `temp/Homey electricity dashboard widget.zip`; `temp/` is gitignored.

## Commands
- Use the **project-local Homey CLI v4**: `npx homey …`. The global `homey` is an old 3.7.x.
- `npx homey app validate --level debug`: compiles the TS and validates.
- `npm test`: the vitest suite in `test/` (`npm run test:watch` to watch). It runs in Europe/Copenhagen. Service tests mock `homey-api` with fakes from `test/helpers/fakeHomey.ts`; widget tests run the unchanged `public/widget.js` in happy-dom (`test/helpers/loadWidget.ts`). CI (`.github/workflows/ci.yml`) runs tsc, the tests and validate.
- `npx homey app install`: builds and installs on the active Homey (firmware 13.x). No Docker needed.
- `npx homey app run`: live logs and hot reload of the widget files. It needs Docker Desktop running, which usually isn't.
- `npm run app-images`: renders the three app store PNGs from `dev/app-images.html` (the hero photo `dev/hero.webp`, cropped to 10:7) with headless Edge.
- `npm run previews`: renders the four widget preview PNGs from `dev/widget-previews.html` (the "Widget Previews" Claude Design project) with headless Edge. Open the page without a query to see them all; `?p=elec-dark` and so on shows one frame.
- `dev/preview.html`: the widget with mock data in a plain browser.
  - Serve the repo root (`python -m http.server 8765`) and open `/dev/preview.html`.
  - `?snap=/temp/real-snapshot.json` loads a real captured snapshot.
  - `#live=0.4` / `#price=0.3` simulates a scrub.
  - `dev/thermostat-preview.html` does the same for the thermostat widget.
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
  - It resamples the raw live readings to 120 points for the selected window and re-renders on a timer so the chart scrolls.
- Colours are Homey CSS tokens with spec-hex fallbacks, defined on `.ew` (not `:root`) so the light-mode overrides in the preview inherit.
- Both widgets stick to Homey's widget type scale (`--homey-font-size-*` with its matching `--homey-line-height-*`, and only the allowed weights: 14 regular, 17 any, 20 medium, 24/32 bold), `--homey-line-color(-light)` and `--homey-border-radius-*`, each with a px fallback. The font is set on `html`, so Homey's own font on `body` wins.

## Thermostat shortcuts widget
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
- The device icon is fetched by the app from `homey.api.getLocalUrl()` + `device.iconObj.url`, sent as an SVG data URL, and used as a CSS mask. A rounded square is the fallback.

## Diagnostics (no Docker needed)
- `lib/Diagnostics.ts` keeps the last 500 log lines. `app.log`/`app.error` are overridden to feed it.
- It's shown on the app settings page (`settings/index.html`; Homey app → Apps → Widgetkeeper → Configure) through the authenticated app API `GET /diagnostics[?device=]` (`api.ts`). Pick a device to get its full capability details.
- The user copies or shares the report into the chat.
- A public, key-protected endpoint for reading it from the dev machine was blocked by the auto-mode classifier. It's not implemented.

## Homey API facts (verified on the real Homey)
- Dynamic prices: `energy.fetchDynamicElectricityPrices({ date: 'YYYY-MM-DD' })` returns `{ priceUnit: 'DKK', interval: 60, pricesPerInterval: [{ periodStart, periodEnd, value }] }`. Zone DK2. `getCurrency()` returns `"DKK"`.
- Insights: `getLogEntries({ uri: 'homey:device:<id>', id: 'homey:device:<id>:<cap>', resolution })`. **The `id` is the full log id.**
  - `lastHour` has a 5 s step; `last24Hours` has a 5 min step.
  - The frient meter logs power as `energy_power`, not `measure_power`. The service picks whichever exists.
- The meter is a frient EMIZB-141 ("Electricity Meter", id `3450f8d3-…`). It reports `measure_power` about every 10 s, and Homey doesn't re-emit unchanged values.
- Widget `devices` setting (`type: global, singular, filter capabilities measure_power`); read it with `Homey.getDeviceIds()`.
- Widget preview images are 1024×1024. App images are 250×175, 500×350 and 1000×700.

## Widget settings
`liveWindow` (60/30/10/5/1/0.5 min, default 10) · `showUsage` · `separateUsage` (usage as its own chart above price) · `nextLow` (none/12/24/both, default 12; replaced the `showNextLow` checkbox, which `index.html` still honours as a fallback).

## Design decisions that differ from the spec
- The live window is configurable, with relative axis labels (`1h · 30m · Now`).
- Axis labels are 12 px, to match Homey's native energy widgets; the gutters and plots were resized to match.
- There are dashed midnight lines on the slot charts.
- The footer shows only the start hour and price (`03:00 • 1,22 kr.`). With both 12h and 24h: `Lowest price 12h/24h   03:00 • 1,22 / 03:00 • 1,22` (no unit), or a single `03:00 • 1,22 kr.` when both are the same slot.
- Weekday names follow Homey's language, and numbers follow the device locale.

## Branding
- From the "Widgetkeeper Logo" Claude Design project: brand colour `#2A1958` (`brandColor` in `.homeycompose/app.json`).
- Logomark: three outlined rounded squares and a four-point sparkle in the top-right cell, on a 64×64 grid. `assets/icon.svg` is the black mark on transparent (Homey tints it).
- The widgets keep Homey's own blue for chart colours; the brand colour is only for the app's identity.
