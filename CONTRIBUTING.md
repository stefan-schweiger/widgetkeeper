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
npm run test-dashboards                # a test web dashboard per widget on your Homey (--native: Homey dashboards)
```

Renders (they show made-up data on a fixed clock, so the same inputs give the same files):

```sh
npm run previews                       # the widget preview images (Homey's widget picker, docs/previews), then the App Store images
npm run app-images                     # the App Store images from the widget previews (assets/images)
npm run screenshots                    # the README screenshots (docs/screenshots)
npm run clips                          # the README clips (docs/clips, animated WebP)
npm run showcase                       # the README's showcase dashboards (docs/showcase)
npm run web-showcase                   # the README's web dashboard images (docs/web)
npm run forum-images                   # the community post's images (docs/forum)
npm run flow-icons                     # the Flow Buttons icon images (lib/flowIconImages.ts)
```

The npm scripts run the project-local CLI too. The render scripts need Microsoft Edge (set `EDGE` to its path if it isn't the default). `npm run web-socket` re-bundles `socket.io-client` into `settings/socket.io.js` after an update.

### App Store images
The app's App Store images (`assets/images/small.png`, `large.png` and `xlarge.png`: 250×175, 500×350 and 1000×700, Homey's sizes) are rendered from the widget previews: columns of preview cards, tilted, on a gradient in the brand colour. `dev/app-images.json` sets which widgets appear and in what order (`columns`, by widget id), the previews' `theme`, the tilt, the column width (a fraction of the image), the gaps and the gradient (its colours, angle and glow).
- `npm run app-images` renders all three (with `sharp`, so no Edge needed). Every preview is only ever scaled down, and the same inputs give the same files.
- `npm run previews` runs it too when it rendered a preview the images use, so a changed preview is in the store images at once.
- `npx homey app validate` checks the images, and `npm test` checks their sizes and that the config's widgets have previews.

## How it's built
- **App code** is TypeScript (ESM), compiled by `tsc` to `.homeybuild/`. Relative imports need `.js` extensions.
- **Widget front ends** (`widgets/*/public`) are plain JS with no build step, because Homey serves those files as-is: `widget.js` draws the widget, `mount.js` wires it to Homey (settings, API calls, live updates) and `index.html` loads them. Helpers they share are in the kit, `widgets/spacer/public/kit.js` and `kit.css` (Homey serves each widget's folder on its own, so it lives in the Spacer's).
- **Styling** follows [Homey's widget styling guide](https://apps.developer.homey.app/the-basics/widgets/styling):
  - Use Homey's CSS variables (`--homey-text-color`, `--homey-font-size-*`, `--homey-su-*`, `--homey-line-light` …), each with a fallback value, so the widgets also render in the browser previews.
  - Stay on Homey's type scale. CLAUDE.md lists the tokens and the few deliberate exceptions.

### Previewing widgets in a browser
Each widget but the Spacer has a page that renders it with mock data, outside Homey: `dev/<widget id>-preview.html` (the Electricity Overview's is `dev/preview.html`), usually in dark and light mode and at 300 px.
1. Serve the repo root, e.g. `python -m http.server 8765`.
2. Open a preview, e.g. `http://localhost:8765/dev/lights-preview.html`. Most take `?lang=de` for another language.
3. On `dev/preview.html`, `#live=0.4` or `#price=0.3` simulates scrubbing a chart.

## Layout
```
app.ts                          the app: owns the services, registers the widgets' autocomplete listeners
api.ts                          the app's API: diagnostics, the API key, the web dashboards
lib/<Name>Service.ts            a service per widget or feature (ElectricityService, LightService, WebDashboardService …)
lib/DeviceTracker.ts            per-device tracking shared by the device widgets' services
lib/                            other shared helpers: autocompletes, capabilities, device icons, Insights reads,
                                the personal API key (PersonalApiKey.ts), diagnostics (Diagnostics.ts)
widgets/<widget id>/            widget.compose.json, api.ts, previews, public/ (index.html, mount.js, widget.js, CSS)
widgets/spacer/public/kit.*     the kit: helpers and colours every widget loads
settings/                       the app settings page (index.html) and the web dashboards page (dashboard.*)
locales/                        strings for the widgets, services and pages, in Homey's 13 languages
dev/                            browser previews with mock data; the pages the renders use
scripts/                        renderers, diagnostics, test dashboards
docs/                           images for the README and the community post
test/                           vitest tests; helpers/ has the fake Homey API and the widget loader
```
