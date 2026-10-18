// The widgets of dev/screenshots.html: the real widget code with the made-up home of showcase-data.js ("Solbakken",
// the showcase dashboards' data, so no real home's names or readings end up in the README), mounted into the elements
// with the ids w-elec, w-thermo, w-qa, w-sa, w-roomhealth, w-weather, w-heatmap, w-cameras, w-values, w-sparklines, w-charts, w-variables,
// w-varpresets, w-flows, w-price, w-locks, w-clock, w-textline(-note) and w-dayssince. Most go through showcase-mount.js's MOUNT with a
// showcase entry (`findWidget()`); only the README's own changes are here. Needs the widget scripts,
// temp/screenshot-icons.js, showcase-data.js and showcase-mount.js loaded first, and the showcase's fixed clock
// (fixed-clock.js), so every render is the same.
(function () {
  const el = id => document.getElementById(id);

  const elec = findWidget('electricity');
  MOUNT.electricity(el('w-elec'), { ...elec, settings: { ...elec.settings, liveWindow: 10, smooth: false, nextLow: 'both' } });

  MOUNT.thermostat(el('w-thermo'), findWidget('thermostat'));

  // Home's lock, coffee machine and TV, then the security dashboard's garage door, doorbell and router.
  MOUNT.quickactions(el('w-qa'), { devices: [...findWidget('quickactions', 0).devices, ...findWidget('quickactions', 3).devices] });

  MOUNT.sensoralarms(el('w-sa'), findWidget('sensoralarms', 1)); // security: with the door contacts

  MOUNT.values(el('w-values'), findWidget('values', 1)); // security: batteries in red, yellow and green

  MOUNT.sparklines(el('w-sparklines'), { slots: findWidget('sparklines').slots });

  // Charts isn't on a showcase dashboard: the README's two, from the sparklines' made-up 24 hours (outdoor, main meter).
  const sparkSlot = (deviceId) => {
    for (let n = 0; findWidget('sparklines', n); n++) {
      const s = findWidget('sparklines', n).slots.find(x => x.deviceId === deviceId);
      if (s) return s;
    }
    return null;
  };
  MOUNT.charts(el('w-charts'), {
    opts: { charts: [{ span: '24h', color: 'purple', smooth: true }, { span: '24h', style: 'bars', color: 'orange' }] },
    charts: [['g1', 'Temperature'], ['m1', 'Power']].map(([id, title]) => {
      const s = sparkSlot(id);
      return { ...s, capability: { ...s.capability, title } };
    }),
  });

  // Not on a showcase dashboard: the Climate dashboard's rooms (its readings), with the kitchen humid after dinner.
  const zone = (id, name) => ({ id, name });
  const sensor = (id, z, values) => ({
    id, name: id, zone: z,
    measures: Object.fromEntries(Object.entries(values).map(([m, v]) => [m, { capabilityId: `measure_${m}`, value: v }])),
  });
  MOUNT.roomhealth(el('w-roomhealth'), { devices: [
    sensor('rh1', zone('z1', 'Living room'), { temperature: 21.4, humidity: 47, co2: 690, radon: 48 }),
    sensor('rh2', zone('z2', 'Kitchen'), { temperature: 22.6, humidity: 64 }),
    sensor('rh3', zone('b1', 'Bedroom'), { temperature: 18.2, humidity: 48, co2: 610 }),
    sensor('rh4', zone('z7', 'Bathroom'), { temperature: 22.8, humidity: 56 }),
    sensor('rh5', zone('z8', "Emma's room"), { temperature: 20.6, humidity: 45, co2: 783 }),
    sensor('rh6', zone('z4', 'Office'), { temperature: 19.4 }),
  ] });

  // Not on a showcase dashboard any more (Home's flags made way for Flow Buttons): the README's own four.
  MOUNT.variables(el('w-variables'), { vars: [
    { id: 'f1', name: 'Away mode', type: 'boolean', value: false },
    { id: 'f2', name: 'Guests staying over', type: 'boolean', value: true },
    { id: 'f3', name: 'Pause the hallway motion lights', type: 'boolean', value: false },
    { id: 'f4', name: 'Night setpoint', type: 'number', value: 18.5 },
  ] });

  // Not on a showcase dashboard: the README's house mode, a text variable with four buttons, Away lit.
  const mode = value => ({ id: `string:${JSON.stringify(value)}`, name: value, value, type: 'string' });
  MOUNT.varpresets(el('w-varpresets'), {
    opts: { icon: 'home' },
    settings: { value1: mode('Home'), value2: mode('Away'), value3: mode('Night'), value4: mode('Holiday') },
    variable: { id: 'm1', name: 'House mode', type: 'string', value: 'Away' },
  });

  // Home's two flows side by side, and two more below them for the README.
  const flows = findWidget('flows');
  const more = [
    [{ id: 'advanced:3', color: 'orange', icon: 'tv' }, { id: 'advanced:3', name: 'Movie time', enabled: true, triggerable: true, advanced: true }],
    [{ id: 'flow:4', color: 'blue', icon: 'leave' }, { id: 'flow:4', name: 'Leaving home', enabled: true, triggerable: true, advanced: false }],
  ];
  MOUNT.flows(el('w-flows'), {
    opts: { ...flows.opts, buttons: [...flows.opts.buttons, ...more.map(m => m[0])] },
    flows: [...flows.flows, ...more.map(m => m[1])],
  });

  MOUNT.price(el('w-price'), findWidget('price')); // energy: the evening peak

  const doors = findWidget('locks'); // security: the shed unlocked and the garage open, here with the list showing
  MOUNT.locks(el('w-locks'), { ...doors, opts: { ...doors.opts, view: 'list' } });

  MOUNT.cameras(el('w-cameras'), { cameras: findWidget('cameras', 1).cameras.slice(0, 4) });

  MOUNT.heatmap(el('w-heatmap'), findWidget('heatmap'));

  MOUNT.weather(el('w-weather'), { hours: findWidget('weather').hours });

  MOUNT.clock(el('w-clock'), findWidget('clock'));

  // Notes' two looks: a tile a Flow wrote on in blue, and the Kitchen's Post-it.
  const board = (text, color = null) => ({ key: 'note', name: 'Note', text, color, updatedAt: SHOWCASE_NOW });
  MOUNT.textline(el('w-textline'), { opts: { source: 'flow', icon: 'bell' }, board: board('The washing machine is done', 'blue') });
  MOUNT.textline(el('w-textline-note'), findWidget('textline'));

  // Days Since isn't on a showcase dashboard: the README's household, one row amber, one red, and Fish just fed (Undo).
  const DAY = 864e5;
  MOUNT.dayssince(el('w-dayssince'), { counters: [
    { name: 'Plants watered', icon: 'leaf', amber: 5, red: 7, ago: 6 * DAY + 3 * 3600e3 },
    { name: 'Vacuum filter', icon: 'vacuum', amber: 75, red: 90, ago: 92 * DAY },
    { name: 'Bedsheets', icon: 'bed', amber: 12, red: 14, ago: 9 * DAY },
    { name: 'Fish fed', icon: 'paw', amber: 2, red: 3, ago: 26 * 3600e3 },
    { name: 'Descale coffee machine', icon: 'coffee', amber: 50, red: 60, ago: 23 * DAY },
    { name: 'Smoke alarm test', icon: 'bell', amber: 25, red: 30, ago: 12 * DAY },
  ] });
  el('w-dayssince').querySelectorAll('.ds-row')[3].click();
})();
