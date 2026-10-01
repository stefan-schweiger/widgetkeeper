# Contributing

Bug reports and pull requests are welcome. For a thermostat problem, include the diagnostics report from **Apps → Widgetkeeper → Configure** with the device selected.

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
npx homey app install                  # build and install on your Homey
npx homey app run                      # run with live logs (needs Docker); widget files hot-reload
npm run app-images                     # render the app store images
npm run previews                       # render the widget preview images
```

## How it's built
- **App code** is TypeScript (ESM), compiled by `tsc` to `.homeybuild/`. Relative imports need `.js` extensions.
- **Widget front ends** (`widgets/*/public`) are plain JS with no build step, because Homey serves those files as-is.

### Previewing widgets in a browser
`dev/preview.html` and `dev/thermostat-preview.html` render the widgets with mock data, outside Homey.
1. Serve the repo root, e.g. `python -m http.server 8765`.
2. Open `/dev/preview.html`.
3. Optionally add `#live=0.4` or `#price=0.3` to the URL to simulate scrubbing.

## Layout
```
app.ts                          App: owns the services, registers autocomplete listeners
api.ts                          App API (diagnostics for the settings page)
lib/ElectricityService.ts       live buffer, insights usage, Homey Energy prices
lib/ThermostatService.ts        thermostat state tracking and preset apply
lib/appApi.ts                   shared HomeyAPI instance
lib/Diagnostics.ts              in-memory log buffer
lib/series.ts                   resampling / parsing helpers
widgets/electricity/            widget manifest, api.ts, public/ (renderer)
widgets/thermostat/             widget manifest, api.ts, public/ (renderer)
settings/                       app settings page (diagnostics)
dev/                            browser previews with mock data
scripts/                        app image and widget preview generators
```
