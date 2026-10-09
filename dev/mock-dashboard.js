// The widgets of dev/screenshots.html: the real widget code with the made-up home of showcase-data.js ("Solbakken",
// the showcase dashboards' data, so no real home's names or readings end up in the README), mounted into the elements
// with the ids w-elec, w-thermo, w-qa, w-sa, w-sd, w-weather, w-heatmap, w-cameras, w-values, w-lights, w-sparklines, w-variables, w-flows, w-price, w-timers, w-locks, w-curtains and w-media.
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

  const dots = find('sensordots'); // security: the garage door open, its overlay showing
  const sd = createSensorDotsWidget(el('w-sd'), { ...dots.opts, locale: LOCALE });
  sd.setState({ devices: dots.devices, language: 'en' });
  sd.open(dots.open);

  const values = find('values', 1); // security: batteries in red, yellow and green
  createValuesWidget(el('w-values'), values.opts || {}).setState(values.slots);

  createSparklinesWidget(el('w-sparklines'), {}).setState(find('sparklines').slots);

  // Not on a showcase dashboard any more (Home's flags made way for Flow Buttons): the README's own four.
  createVariablesWidget(el('w-variables'), {}).setState([
    { id: 'f1', name: 'Away mode', type: 'boolean', value: false },
    { id: 'f2', name: 'Guests staying over', type: 'boolean', value: true },
    { id: 'f3', name: 'Pause the hallway motion lights', type: 'boolean', value: false },
    { id: 'f4', name: 'Night setpoint', type: 'number', value: 18.5 },
  ]);

  // Home's two flows side by side, and two more below them for the README.
  const flows = find('flows');
  const more = [
    [{ id: 'advanced:3', color: 'orange', icon: 'tv' }, { id: 'advanced:3', name: 'Movie time', enabled: true, triggerable: true, advanced: true }],
    [{ id: 'flow:4', color: 'blue', icon: 'leave' }, { id: 'flow:4', name: 'Leaving home', enabled: true, triggerable: true, advanced: false }],
  ];
  createFlowsWidget(el('w-flows'), { ...flows.opts, buttons: [...flows.opts.buttons, ...more.map(m => m[0])] })
    .setState([...flows.flows, ...more.map(m => m[1])]);

  createLightsWidget(el('w-lights'), {}).setState(find('lights').devices);

  const price = find('price'); // energy: the evening peak
  createPriceWidget(el('w-price'), { locale: LOCALE, ...price.opts }).setState(price.state);

  // Kitchen's timer twice for the README: its presets, then its pizza timer in their place. Counted from a fixed now,
  // so the shot stays the same.
  const kitchen = find('timers');
  const now = Date.now();
  createTimersWidget(el('w-timers'), { sound: false, now: () => now, presets: kitchen.presets }).setState({ timers: [], now });
  createTimersWidget(el('w-timers-running'), { sound: false, now: () => now, presets: kitchen.presets }).setState({ timers: kitchen.timers, now });

  const doors = find('locks'); // security: the shed unlocked and the garage open, here with the list showing
  createLocksWidget(el('w-locks'), { ...doors.opts, view: 'list' }).setState({ devices: doors.devices, language: 'en' });

  // Solbakken's curtains (no showcase dashboard has them): one open, one closing (so a tap would open it again), one closed and a
  // blind part open.
  const cap = value => ({ value, setable: true });
  const curtains = createCurtainsWidget(el('w-curtains'), {});
  curtains.setState([
    { id: 'c1', name: 'Garden window', kind: 'curtain', caps: { windowcoverings_set: cap(1), windowcoverings_state: cap('idle') } },
    { id: 'c2', name: 'Terrace door', kind: 'curtain', caps: { windowcoverings_set: cap(0.6), windowcoverings_state: cap('down') } },
    { id: 'c3', name: 'Bedroom', kind: 'curtain', caps: { windowcoverings_set: cap(0), windowcoverings_state: cap('idle') } },
    { id: 'c4', name: 'Office blind', kind: 'blinds', caps: { windowcoverings_set: cap(0.35), windowcoverings_state: cap('idle') } },
  ]);

  // Solbakken's living room speaker (the Evening showcase has it too, condensed), playing with a drawn cover, the TV and
  // line-in buttons behind its ⋯. The fixed clock keeps the position the same in every render.
  const clock = Date.now();
  mountMockMedia(el('w-media'), mockSpeaker('Living room', 0), {
    canSwitch: true,
    now: () => clock,
    buttons: [{ id: 'card:tv', name: 'TV' }, { id: 'card:line', name: 'Line-in' }, { id: 'flow:f1', name: 'Movie night' }],
  });

  const cams = createCamerasWidget(el('w-cameras'), {});
  cams.setState(find('cameras', 1).cameras.slice(0, 4));
  cams.refresh();

  const heat = find('heatmap');
  createHeatmapWidget(el('w-heatmap'), { locale: LOCALE, ...heat.opts }).setData(heat.data);

  createWeatherWidget(el('w-weather'), { locale: LOCALE, iconBase: '../widgets/weather/public/icons/' })
    .setForecast({ hours: find('weather').hours, language: 'en' });
})();
