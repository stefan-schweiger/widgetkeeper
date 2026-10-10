// The widgets of dev/screenshots.html: the real widget code with the made-up home of showcase-data.js ("Solbakken",
// the showcase dashboards' data, so no real home's names or readings end up in the README), mounted into the elements
// with the ids w-elec, w-thermo, w-qa, w-sa, w-sd, w-weather, w-heatmap, w-cameras, w-values, w-sparklines, w-variables,
// w-flows, w-price, w-timers, w-timers-running, w-locks and w-curtains. Most go through showcase-mount.js's MOUNT with a
// showcase entry (`findWidget()`); only the README's own changes are here. Needs the widget scripts,
// temp/screenshot-icons.js, showcase-data.js and showcase-mount.js loaded first, and the showcase's fixed clock
// (fixed-clock.js), so every render is the same.
(function () {
  const el = id => document.getElementById(id);

  const elec = findWidget('electricity');
  MOUNT.electricity(el('w-elec'), { ...elec, settings: { ...elec.settings, liveWindow: 10, smooth: false } });

  MOUNT.thermostat(el('w-thermo'), findWidget('thermostat'));

  // Home's lock, coffee machine and TV, then the security dashboard's garage door, doorbell and router.
  MOUNT.quickactions(el('w-qa'), { devices: [...findWidget('quickactions', 0).devices, ...findWidget('quickactions', 3).devices] });

  MOUNT.sensoralarms(el('w-sa'), findWidget('sensoralarms', 1)); // security: with the door contacts

  const dots = findWidget('sensordots'); // security: the garage door open, its overlay showing
  MOUNT.sensordots(el('w-sd'), { ...dots, opts: { ...dots.opts, locale: LOCALE } });

  MOUNT.values(el('w-values'), findWidget('values', 1)); // security: batteries in red, yellow and green

  MOUNT.sparklines(el('w-sparklines'), { slots: findWidget('sparklines').slots });

  // Not on a showcase dashboard any more (Home's flags made way for Flow Buttons): the README's own four.
  MOUNT.variables(el('w-variables'), { vars: [
    { id: 'f1', name: 'Away mode', type: 'boolean', value: false },
    { id: 'f2', name: 'Guests staying over', type: 'boolean', value: true },
    { id: 'f3', name: 'Pause the hallway motion lights', type: 'boolean', value: false },
    { id: 'f4', name: 'Night setpoint', type: 'number', value: 18.5 },
  ] });

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

  // Kitchen's timer twice for the README: its presets, then its pizza timer in their place. Counted from the
  // showcase's fixed now, so the shot stays the same.
  const kitchen = findWidget('timers');
  MOUNT.timers(el('w-timers'), { presets: kitchen.presets, timers: [] });
  MOUNT.timers(el('w-timers-running'), { presets: kitchen.presets, timers: kitchen.timers });

  const doors = findWidget('locks'); // security: the shed unlocked and the garage open, here with the list showing
  MOUNT.locks(el('w-locks'), { ...doors, opts: { ...doors.opts, view: 'list' } });

  // Solbakken's curtains (four more than the Evening dashboard's two): one open, one closing (so a tap would open it again), one closed and a
  // blind part open.
  const cap = value => ({ value, setable: true });
  const curtains = createCurtainsWidget(el('w-curtains'), {});
  curtains.setState([
    { id: 'c1', name: 'Garden window', kind: 'curtain', caps: { windowcoverings_set: cap(1), windowcoverings_state: cap('idle') } },
    { id: 'c2', name: 'Terrace door', kind: 'curtain', caps: { windowcoverings_set: cap(0.6), windowcoverings_state: cap('down') } },
    { id: 'c3', name: 'Bedroom', kind: 'curtain', caps: { windowcoverings_set: cap(0), windowcoverings_state: cap('idle') } },
    { id: 'c4', name: 'Office blind', kind: 'blinds', caps: { windowcoverings_set: cap(0.35), windowcoverings_state: cap('idle') } },
  ]);

  MOUNT.cameras(el('w-cameras'), { cameras: findWidget('cameras', 1).cameras.slice(0, 4) });

  MOUNT.heatmap(el('w-heatmap'), findWidget('heatmap'));

  MOUNT.weather(el('w-weather'), { hours: findWidget('weather').hours });
})();
