// Mounting the made-up home's widgets (dev/showcase-data.js) with the real widget code, shared by showcase.html,
// screenshots.html (through mock-dashboard.js) and clips.html. Load it after the widget scripts, mock-media.js,
// temp/screenshot-icons.js and showcase-data.js, with fixed-clock.js first, so every render is the same.
// `MOUNT[type](el, w)` creates a widget of that type in `el` from a showcase entry `w`; a page that needs other
// options passes a changed copy of the entry. `findWidget(type, n)` is the `n`th widget of a type, in dashboard order.

const LOCALE = 'en-GB';
const SHOWCASE_NOW = Date.now(); // the timers count from this, so every render shows the same time left

// One mount per widget type: the element, then the widget's data from showcase-data.js.
const MOUNT = {
  electricity: (el, w) => { const x = createElectricityWidget(el, { locale: LOCALE }); x.setSettings(w.settings || {}); x.setData(w.data); },
  thermostat: (el, w) => { const x = createThermostatWidget(el, { locale: LOCALE }); x.setButtons(thermostatPresetsFromSettings(w.presets)); x.setState(w.state); },
  quickactions: (el, w) => createQuickActionsWidget(el, w.opts || {}).setState(w.devices),
  sensoralarms: (el, w) => createSensorAlarmsWidget(el, w.opts || {}).setState(w.devices),
  sensordots: (el, w) => { const x = createSensorDotsWidget(el, w.opts || {}); x.setState({ devices: w.devices, language: 'en' }); if (w.open) x.open(w.open); },
  values: (el, w) => createValuesWidget(el, w.opts || {}).setState(w.slots),
  variables: (el, w) => createVariablesWidget(el, w.opts || {}).setState(w.vars),
  flows: (el, w) => createFlowsWidget(el, w.opts || {}).setState(w.flows),
  price: (el, w) => createPriceWidget(el, { locale: LOCALE, ...w.opts }).setState(w.state),
  timers: (el, w) => createTimersWidget(el, { sound: false, now: () => SHOWCASE_NOW, presets: w.presets, ...w.opts }).setState({ timers: w.timers, now: SHOWCASE_NOW }),
  locks: (el, w) => createLocksWidget(el, w.opts || {}).setState({ devices: w.devices, language: 'en' }),
  sparklines: (el, w) => createSparklinesWidget(el, w.opts || {}).setState(w.slots),
  lights: (el, w) => createLightsWidget(el, w.opts || {}).setState(w.devices),
  curtains: (el, w) => createCurtainsWidget(el, w.opts || {}).setState(w.devices),
  cameras: (el, w) => { const x = createCamerasWidget(el, w.opts || {}); x.setState(w.cameras); x.refresh(); },
  heatmap: (el, w) => createHeatmapWidget(el, { locale: LOCALE, ...w.opts }).setData(w.data),
  // The made-up speakers of mock-media.js (drawn covers); the fixed clock keeps the position still.
  media: (el, w) => mountMockMedia(el, mockSpeaker(...w.speaker), { now: () => SHOWCASE_NOW, ...w.opts }),
  weather: (el, w) => createWeatherWidget(el, { locale: LOCALE, iconBase: '../widgets/weather/public/icons/', ...w.opts })
    .setForecast({ hours: w.hours, language: 'en' }),
};

const SHOWCASE_WIDGETS = Object.values(SHOWCASE).flatMap(board => board.columns.flat());
/** The `n`th widget of a type, in the order of the dashboards (home, energy, security …) and their columns. */
const findWidget = (type, n = 0) => SHOWCASE_WIDGETS.filter(w => w.type === type)[n];
