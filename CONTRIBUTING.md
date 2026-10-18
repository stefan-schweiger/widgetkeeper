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
npx homey app validate --level debug   # compile + validate (also: npm run validate)
npm test                               # unit tests (vitest; widget tests use happy-dom)
npm run typecheck                      # tsc for the app + basic JS checking of the widget front ends
npx homey app install                  # build and install on your Homey (also: npm run install-homey)
npx homey app run                      # run with live logs (needs Docker); widget files hot-reload (also: npm start)
npm run diagnostics                    # the app's diagnostics report and log from your Homey
npm run app-images                     # render the App Store images from the widget previews (assets/images)
npm run previews                       # render the widget preview images (Homey's widget picker), then the App Store images
npm run screenshots                    # render the README screenshots (docs/screenshots)
npm run showcase                       # render the README's showcase dashboards (docs/showcase)
npm run clips                          # record the README clips (docs/clips, animated WebP)
npm run flow-icons                     # re-render the Flow Buttons icon images (lib/flowIconImages.ts)
```

The npm scripts run the project-local CLI too. The render scripts need Microsoft Edge (set `EDGE` to its path if it isn't the default).

### App Store images
The app's App Store images (`assets/images/small.png`, `large.png` and `xlarge.png`: 250×175, 500×350 and 1000×700, Homey's sizes) are rendered from the widget previews: columns of preview cards, tilted, on a gradient in the brand colour. `dev/app-images.json` sets which widgets appear and in what order (`columns`, by widget id), the previews' `theme`, the tilt, the column width (a fraction of the image), the gaps and the gradient (its colours, angle and glow).
- `npm run app-images` renders all three (with `sharp`, so no Edge needed). Every preview is only ever scaled down, and the same inputs give the same files.
- `npm run previews` runs it too when it rendered a preview the images use, so a changed preview is in the store images at once.
- `npx homey app validate` checks the images, and `npm test` checks their sizes and that the config's widgets have previews.

## How it's built
- **App code** is TypeScript (ESM), compiled by `tsc` to `.homeybuild/`. Relative imports need `.js` extensions.
- **Widget front ends** (`widgets/*/public`) are plain JS with no build step, because Homey serves those files as-is.
- **Styling** follows [Homey's widget styling guide](https://apps.developer.homey.app/the-basics/widgets/styling):
  - Use Homey's CSS variables (`--homey-text-color`, `--homey-font-size-*`, `--homey-su-*`, `--homey-line-light` …), each with a fallback value, so the widgets also render in the browser previews.
  - Stay on Homey's type scale. CLAUDE.md lists the tokens and the few deliberate exceptions.

### Previewing widgets in a browser
`dev/preview.html`, `dev/thermostat-preview.html`, `dev/quickactions-preview.html`, `dev/sensoralarms-preview.html`, `dev/sensordots-preview.html`, `dev/roomhealth-preview.html`, `dev/valuematrix-preview.html`, `dev/weather-preview.html`, `dev/heatmap-preview.html`, `dev/values-preview.html`, `dev/lights-preview.html`, `dev/sparklines-preview.html`, `dev/variables-preview.html`, `dev/varpresets-preview.html`, `dev/flows-preview.html`, `dev/price-preview.html`, `dev/timers-preview.html`, `dev/locks-preview.html`, `dev/curtains-preview.html`, `dev/media-preview.html`, `dev/cameras-preview.html`, `dev/stack-preview.html`, `dev/clock-preview.html` and `dev/dayssince-preview.html` render the widgets with mock data, outside Homey.
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
lib/SensorAlarmService.ts       alarm capability tracking (Sensor Alarms and Activity Dots)
lib/RoomHealthService.ts        climate and air sensor tracking, with their rooms, for Room Health
lib/ValueMatrixService.ts       a value per device and column, with their rooms, for Value Matrix
lib/WeatherService.ts           MET Norway forecast fetching and caching
lib/HeatmapService.ts           Insights history and on/off recording for the heatmap
lib/ValueService.ts             capability value tracking for Device Values
lib/LightService.ts             light state tracking and control for Light Controls
lib/SparklineService.ts         Insights history for Sparklines (live values through ValueService)
lib/VariableService.ts          Logic variables for Variables and Variable Presets (read, set, live updates)
lib/FlowService.ts              flows for Flow Buttons (list, start)
lib/PersonalApiKey.ts           the user's API key for changing variables, starting flows and running speaker actions
lib/TimerService.ts             the Timers widget's timers (run, save, Flow card)
lib/LockService.ts              lock, contact and garage door tracking for Locks and Doors
lib/CurtainService.ts           curtain and blind tracking and moves for Curtains
lib/MediaService.ts             speaker tracking, album art, controls and source buttons for Media
lib/heatmap.ts                  local-hour bucketing for the heatmap
lib/deviceIcon.ts               device and capability icons, as SVG data URLs
lib/appApi.ts                   shared HomeyAPI instance
lib/Diagnostics.ts              in-memory log buffer
lib/series.ts                   resampling / parsing helpers
widgets/electricity/            widget manifest, api.ts, public/ (renderer)
widgets/thermostat/             widget manifest, api.ts, public/ (renderer; presets.js/.css, shared with Variable Presets)
widgets/quickactions/           widget manifest, api.ts, public/ (renderer)
widgets/sensoralarms/           widget manifest, api.ts, public/ (renderer)
widgets/sensordots/             widget manifest, api.ts (Sensor Alarms' state), public/ (renderer)
widgets/roomhealth/             widget manifest, api.ts, public/ (renderer)
widgets/valuematrix/            widget manifest, api.ts, public/ (renderer)
widgets/weather/                widget manifest, api.ts, public/ (renderer, vendored MET icons)
widgets/heatmap/                widget manifest, api.ts, public/ (renderer)
widgets/values/                 widget manifest, api.ts, public/ (renderer)
widgets/lights/                 widget manifest, api.ts, public/ (renderer)
widgets/sparklines/             widget manifest, api.ts, public/ (renderer)
widgets/variables/              widget manifest, api.ts, public/ (renderer)
widgets/varpresets/             widget manifest, api.ts (Variables' service), public/ (renderer on Thermostat Presets' presets module)
widgets/flows/                  widget manifest, api.ts, public/ (renderer)
widgets/price/                  widget manifest, api.ts (the Electricity Overview's prices), public/ (renderer)
widgets/timers/                 widget manifest, api.ts, public/ (renderer)
widgets/locks/                  widget manifest, api.ts, public/ (renderer)
widgets/curtains/               widget manifest, api.ts, public/ (renderer)
widgets/media/                  widget manifest, api.ts, public/ (renderer)
widgets/clock/                  widget manifest, api.ts (the Weather Forecast's data), public/ (renderer)
widgets/dayssince/              widget manifest, api.ts, public/ (renderer)
settings/                       app settings page (diagnostics)
dev/                            browser previews with mock data; screenshots, showcase and clips pages for the README
scripts/                        App Store image, widget preview, screenshot, showcase and clip renderers; diagnostics
docs/screenshots/               README screenshots (npm run screenshots)
docs/showcase/, docs/clips/     README showcase dashboards and clips (npm run showcase, npm run clips)
test/                           vitest tests; helpers/ has the fake Homey API and the widget loader
```
