# Contributing

Bug reports and pull requests are welcome. For a problem with a device, include the diagnostics report from **Apps → Widgetkeeper → Configure** with that device selected.

## Setup

```sh
npm install
npx homey login
npx homey select                       # pick your Homey
```

Use the project-local Homey CLI (`npx homey`, v4). An older globally installed `homey` may not work.

## Commands

```sh
npx homey app validate --level debug   # compile + validate
npm test                               # unit tests (vitest; widget tests use happy-dom)
npm run typecheck                      # tsc for the app + basic JS checking of the widget front ends
npx homey app install                  # build and install on your Homey
npx homey app run                      # run with live logs (needs Docker); widget files hot-reload
npm run app-images                     # render the app store images
npm run previews                       # render the widget preview images (Homey's widget picker)
npm run screenshots                    # render the README screenshots (docs/screenshots)
```

## How it's built
- **App code** is TypeScript (ESM), compiled by `tsc` to `.homeybuild/`. Relative imports need `.js` extensions.
- **Widget front ends** (`widgets/*/public`) are plain JS with no build step, because Homey serves those files as-is.
- **Styling** follows [Homey's widget styling guide](https://apps.developer.homey.app/the-basics/widgets/styling):
  - Use Homey's CSS variables (`--homey-text-color`, `--homey-font-size-*`, `--homey-su-*`, `--homey-line-light` …), each with a fallback value, so the widgets also render in the browser previews.
  - Stay on Homey's type scale. CLAUDE.md lists the tokens and the few deliberate exceptions.

### Previewing widgets in a browser
`dev/preview.html`, `dev/thermostat-preview.html`, `dev/quickactions-preview.html`, `dev/sensoralarms-preview.html`, `dev/weather-preview.html`, `dev/heatmap-preview.html`, `dev/values-preview.html` and `dev/lights-preview.html` render the widgets with mock data, outside Homey.
1. Serve the repo root, e.g. `python -m http.server 8765`.
2. Open `/dev/preview.html`.
3. Optionally add `#live=0.4` or `#price=0.3` to the URL to simulate scrubbing.

## Layout
```
app.ts                          App: owns the services, registers autocomplete listeners
api.ts                          App API (diagnostics for the settings page)
lib/ElectricityService.ts       live buffer, insights usage, Homey Energy prices
lib/ThermostatService.ts        thermostat state tracking and preset apply
lib/QuickActionService.ts       quick-action state tracking and triggering
lib/SensorAlarmService.ts       alarm capability tracking
lib/WeatherService.ts           MET Norway forecast fetching and caching
lib/HeatmapService.ts           Insights history and on/off recording for the heatmap
lib/ValueService.ts             capability value tracking for Device Values
lib/LightService.ts             light state tracking and control for Light Controls
lib/heatmap.ts                  local-hour bucketing for the heatmap
lib/deviceIcon.ts               device and capability icons, as SVG data URLs
lib/appApi.ts                   shared HomeyAPI instance
lib/Diagnostics.ts              in-memory log buffer
lib/series.ts                   resampling / parsing helpers
widgets/electricity/            widget manifest, api.ts, public/ (renderer)
widgets/thermostat/             widget manifest, api.ts, public/ (renderer)
widgets/quickactions/           widget manifest, api.ts, public/ (renderer)
widgets/sensoralarms/           widget manifest, api.ts, public/ (renderer)
widgets/weather/                widget manifest, api.ts, public/ (renderer, vendored MET icons)
widgets/heatmap/                widget manifest, api.ts, public/ (renderer)
widgets/values/                 widget manifest, api.ts, public/ (renderer)
widgets/lights/                 widget manifest, api.ts, public/ (renderer)
settings/                       app settings page (diagnostics)
dev/                            browser previews with mock data; screenshots.html for the README
scripts/                        app image, widget preview and screenshot generators
docs/screenshots/               README screenshots (npm run screenshots)
test/                           vitest tests; helpers/ has the fake Homey API and the widget loader
```
