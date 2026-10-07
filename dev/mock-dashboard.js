// The widgets of dev/screenshots.html: the real widget code with the made-up home of showcase-data.js ("Solbakken",
// the showcase dashboards' data, so no real home's names or readings end up in the README), mounted into the elements
// with the ids w-elec, w-thermo, w-qa, w-sa, w-weather, w-heatmap, w-cameras, w-values, w-lights, w-sparklines and w-variables.
// Needs the widget scripts, temp/screenshot-icons.js and showcase-data.js loaded first, and the
// showcase's fixed clock (screenshots.html sets it), so every render is the same.
(function () {
  const LOCALE = 'en-GB';
  const all = Object.values(SHOWCASE).flatMap(board => board.columns.flat());
  /** The `n`th widget of a type, in the order of the dashboards (home, energy, security) and their columns. */
  const find = (type, n = 0) => all.filter(w => w.type === type)[n];
  const el = id => document.getElementById(id);

  const elec = find('electricity');
  const e = createElectricityWidget(el('w-elec'), { locale: LOCALE });
  e.setSettings({ ...elec.settings, liveWindow: 10, smooth: false });
  e.setData(elec.data);

  const heatPump = find('thermostat');
  const thermo = createThermostatWidget(el('w-thermo'), { locale: LOCALE });
  thermo.setButtons(thermostatPresetsFromSettings(heatPump.presets));
  thermo.setState(heatPump.state);

  // Home's lock, coffee machine and TV, then the security dashboard's garage door, doorbell and router.
  createQuickActionsWidget(el('w-qa'), {}).setState([...find('quickactions', 0).devices, ...find('quickactions', 3).devices]);

  const alarms = find('sensoralarms', 1); // security: with the door contacts
  createSensorAlarmsWidget(el('w-sa'), alarms.opts || {}).setState(alarms.devices);

  const values = find('values', 1); // security: batteries in red, yellow and green
  createValuesWidget(el('w-values'), values.opts || {}).setState(values.slots);

  createSparklinesWidget(el('w-sparklines'), {}).setState(find('sparklines').slots);

  createVariablesWidget(el('w-variables'), {}).setState(find('variables').vars);

  createLightsWidget(el('w-lights'), {}).setState(find('lights').devices);

  const cams = createCamerasWidget(el('w-cameras'), {});
  cams.setState(find('cameras', 1).cameras.slice(0, 4));
  cams.refresh();

  const heat = find('heatmap');
  createHeatmapWidget(el('w-heatmap'), { locale: LOCALE, ...heat.opts }).setData(heat.data);

  createWeatherWidget(el('w-weather'), { locale: LOCALE, iconBase: '../widgets/weather/public/icons/' })
    .setForecast({ hours: find('weather').hours, language: 'en' });
})();
