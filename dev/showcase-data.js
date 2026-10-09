/*
 * The showcase dashboards (dev/showcase.html): a made-up family house, "Solbakken", on an October evening
 * (Tuesday 6 October 2026, 18:40; showcase.html fixes the clock). The oven is on, the heat pump keeps the house
 * at 21°, the car charged in the cheap night hours and the sun has just set.
 *
 * `SHOWCASE[id]` is one dashboard: `{ title, columns: [[widget, …], …] }`. A widget is `{ type, … }` with the
 * data its `create…Widget` takes (see MOUNT in showcase.html). To add a dashboard, add an entry and render it with
 * `npm run showcase -- <id>`. All data is built from formulas and a seeded random sequence, so every render is the same.
 */
(function () {
  const NOW = Date.now(); // The fixed clock.
  const HOUR = 3600e3, MIN = 60e3, DAY = 24 * HOUR;
  const icon = name => (window.ICONS && ICONS[name]) || null;
  function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
  const hourOf = t => new Date(t).getHours();
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // ---- Electricity: Danish spot prices with the evening peak, a heat pump, a night of car charging, cooking now.

  // Price per hour of day (kr/kWh incl. tariffs), today and tomorrow (a windier, cheaper day).
  const PRICE_TODAY = [1.62, 1.55, 1.49, 1.47, 1.52, 1.71, 2.18, 2.74, 2.81, 2.33, 1.96, 1.78, 1.69, 1.66, 1.74, 1.98, 2.61, 3.28, 3.46, 3.12, 2.47, 2.04, 1.83, 1.71];
  const PRICE_TOMORROW = [1.44, 1.31, 1.18, 1.12, 1.21, 1.47, 1.98, 2.52, 2.47, 2.02, 1.71, 1.52, 1.38, 1.31, 1.42, 1.69, 2.29, 2.94, 3.07, 2.71, 2.18, 1.86, 1.64, 1.52];
  const PRICE_YESTERDAY = [1.71, 1.64, 1.58, 1.55, 1.61, 1.84, 2.37, 2.95, 3.02, 2.51, 2.08, 1.88, 1.79, 1.75, 1.83, 2.07, 2.72, 3.31, 3.39, 3.01, 2.41, 2.01, 1.86, 1.77];

  /** The house's power use at time t (W), without the noise. */
  function houseLoad(t, r, car = true) {
    const h = hourOf(t) + new Date(t).getMinutes() / 60;
    let w = 230; // Fridge, router, standby.
    if (Math.floor(t / (7 * MIN)) % 3 === 0) w += 95; // Fridge compressor.
    w += 520 + 260 * Math.sin(t / (41 * MIN)); // Heat pump, modulating.
    if (h >= 6.5 && h < 8) w += 380 + (h < 6.9 ? 1900 : 0); // Morning: kettle, then lights and the toaster.
    if (h >= 7.1 && h < 7.4) w += 1400; // Shower pump and the water heater.
    if (h >= 16.5 && h < 23) w += 240; // Evening lights and the TV.
    if (h >= 21.2 && h < 22.6) w += 1900 * (Math.floor(t / (4 * MIN)) % 3 ? 1 : 0.15); // The dishwasher.
    if (car && h >= 1 && h < 4.5) w += 3650; // The car, on the cheapest hours.
    if (r) w += (r() - 0.5) * 70;
    return w;
  }

  let snapshot;
  function electricity() {
    if (snapshot) return structuredClone(snapshot);
    const r = rng(1906);
    const hourStart = Math.floor(NOW / HOUR) * HOUR;
    const prices = Array.from({ length: 49 }, (_, i) => {
      const start = hourStart + (i - 24) * HOUR;
      const day = Math.floor((start - new Date(NOW).setHours(0, 0, 0, 0)) / DAY);
      const table = day < 0 ? PRICE_YESTERDAY : day > 0 ? PRICE_TOMORROW : PRICE_TODAY;
      return { start, price: table[hourOf(start)] };
    });
    const usage = [];
    for (let t = prices[0].start; t <= NOW; t += 5 * MIN) {
      let w = 0;
      for (let k = 0; k < 5; k++) w += houseLoad(t + k * MIN, r) / 5;
      if (t > NOW - 40 * MIN) w += 1500; // The oven, preheating and on.
      usage.push({ t, w: Math.round(w) });
    }
    // The meter's raw readings (every ~10 s) for the last hour: the oven since 18:05, cycling on its thermostat,
    // and the hob for the potatoes from 18:22 to 18:34.
    const live = [];
    for (let t = NOW - HOUR; t <= NOW; t += 7e3 + r() * 6e3) {
      const m = (t - NOW) / MIN;
      let w = houseLoad(t, r);
      if (m > -35) w += m < -27 ? 2350 : (Math.floor((m + 35) / 2.5) % 3 === 0 ? 150 : 2300);
      if (m > -18 && m < -6) w += 1150 + (Math.floor(m) % 4 === 0 ? 900 : 0);
      live.push({ t: Math.round(t), w: Math.round(w) });
    }
    live.push({ t: NOW, w: live[live.length - 1].w });
    snapshot = { now: NOW, deviceName: 'Main meter', live, prices, usage, currency: 'DKK' };
    return structuredClone(snapshot);
  }

  // ---- Weather: a mild, breezy evening, rain in the night, then a bright, cool Wednesday.

  // [hours from now, symbol, °C, wind m/s, from °, mm] keyframes; hours in between take the earlier symbol.
  const WEATHER = [
    [0, 'partlycloudy', 11.4, 5.2, 225, 0], [2, 'cloudy', 10.6, 6.0, 220, 0], [4, 'lightrain', 10.2, 7.1, 215, 0.4],
    [6, 'rain', 9.8, 8.3, 230, 1.6], [8, 'lightrainshowers', 9.1, 7.6, 250, 0.5], [10, 'partlycloudy', 7.9, 5.9, 270, 0],
    [12, 'fair', 7.4, 4.8, 285, 0], [14, 'clearsky', 9.6, 4.2, 290, 0], [17, 'fair', 13.2, 4.6, 280, 0],
    [20, 'partlycloudy', 14.1, 5.0, 270, 0], [23, 'cloudy', 12.0, 4.4, 260, 0], [26, 'lightrainshowers', 10.8, 5.6, 250, 0.3],
    [29, 'cloudy', 10.1, 5.2, 245, 0], [34, 'partlycloudy', 8.6, 4.1, 240, 0], [42, 'fair', 7.2, 3.4, 230, 0], [48, 'fair', 7.0, 3.0, 230, 0],
  ];
  const NIGHT_CAPABLE = /^(clearsky|fair|partlycloudy|lightrainshowers|rainshowers)$/;
  function weatherHours() {
    const from = Math.floor(NOW / HOUR) * HOUR;
    return Array.from({ length: 48 }, (_, i) => {
      const k = WEATHER.findLastIndex(w => w[0] <= i);
      const [h0, sym, temp0, wind0, dir0, mm] = WEATHER[k];
      const [h1, , temp1, wind1, dir1] = WEATHER[Math.min(k + 1, WEATHER.length - 1)];
      const f = h1 > h0 ? (i - h0) / (h1 - h0) : 0;
      const t = new Date(from + i * HOUR);
      const night = t.getHours() >= 19 || t.getHours() < 7;
      return {
        t: t.toISOString(),
        symbol: NIGHT_CAPABLE.test(sym) ? `${sym}_${night ? 'night' : 'day'}` : sym,
        temp: round(temp0 + (temp1 - temp0) * f, 1), wind: round(wind0 + (wind1 - wind0) * f, 1),
        windDir: Math.round(dir0 + (dir1 - dir0) * f), precip: mm,
      };
    });
  }

  // ---- Heatmaps: the last 7 days up to now, the way the app sends `/history`.

  function heatDays(fn, seed) {
    const r = rng(seed);
    const today = new Date(NOW); today.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - 6 + i);
      return {
        date: ymd(d), weekday: d.getDay(),
        hours: Array.from({ length: 24 }, (_, h) => (i === 6 && h > hourOf(NOW) ? null : fn(new Date(d).setHours(h, 30), d.getDay(), h, r))),
      };
    });
  }
  /** A Locks and Doors device: `caps` is `{capabilityId: [value, minutes ago]}`; a contact sensor can't be set. */
  const lockDevice = (id, name, iconName, caps) => ({
    id, name, icon: icon(iconName),
    caps: Object.fromEntries(Object.entries(caps).map(([cap, [value, ago]]) => [cap, { value, setable: cap !== 'alarm_contact', lastUpdated: NOW - ago * MIN }])),
  });
  const powerNow = () => { const live = electricity().live; return live[live.length - 1].w; };
  const heatPower = () => ({
    name: 'Main meter', icon: icon('inverter'), language: 'en', value: powerNow(),
    capability: { id: 'measure_power', title: 'Power', type: 'number', units: 'W', decimals: 0 },
    days: heatDays((t, wd, h, r) => {
      let w = 0;
      const car = wd !== 3 && wd !== 5; // Wednesday and Friday the car didn't need charging.
      for (let k = 0; k < 6; k++) w += houseLoad(t - 25 * MIN + k * 10 * MIN, r, car) / 6;
      if (h >= 17 && h < 19) w += 700 + r() * 900; // Cooking.
      if ((wd === 0 || wd === 6) && h >= 10 && h < 13) w += 900 * r(); // Weekend washing and baking.
      return Math.round(w);
    }, 7),
  });
  const heatMotion = () => ({
    name: 'Hallway motion', icon: icon('motion-sensor'), language: 'en', value: true,
    capability: { id: 'alarm_motion', title: 'Motion alarm', type: 'boolean', units: null, decimals: null },
    days: heatDays((t, wd, h, r) => {
      const weekend = wd === 0 || wd === 6;
      if (h < 6 || h >= 23) return r() < 0.08 ? 0.05 : 0;
      if (!weekend && h >= 9 && h < 15) return r() * 0.06; // Everyone out.
      const busy = (!weekend && h >= 6 && h < 9) || (weekend && h >= 8 && h < 12) || (h >= 15 && h < 21);
      return round(busy ? 0.25 + r() * 0.5 : r() * 0.18, 2);
    }, 31),
  });

  // ---- Sparklines: 24 h of 120 points ending now.

  const spark = (f, seed) => {
    const r = rng(seed);
    return Array.from({ length: 120 }, (_, i) => { const t = NOW - DAY + (i + 0.5) * DAY / 120; return [t, f(t, r)]; });
  };
  const vcap = (type, extra = {}) => ({ title: '', type, units: null, decimals: null, values: null, icon: null, ...extra });
  const sparkSlot = (deviceId, capabilityId, name, extra, points) =>
    ({ deviceId, capabilityId, name, capability: vcap('number', extra), value: points[points.length - 1][1], points });
  const dayCurve = (t, peak = 15) => Math.cos(((hourOf(t) + new Date(t).getMinutes() / 60 - peak) / 24) * 2 * Math.PI); // 1 at `peak` o'clock.
  const value = (deviceId, capabilityId, name, extra, v) => ({ deviceId, capabilityId, name, capability: vcap(extra.type || 'number', extra), value: v });

  // ---- Devices.

  const qa = (capabilityId, value) => ({ capabilityId, value, actionable: true, momentary: false, icon: null });
  const alarm = (capabilityId, value, title, state = false) => ({ capabilityId, title, value, state });
  /** A motion, contact or camera detection for Sensor Dots, changed `min` minutes ago. */
  const sensor = (capabilityId, value, title, min) => ({ ...alarm(capabilityId, value, title, true), lastUpdated: NOW - min * MIN });
  const contactDot = (id, name, open, min) => ({ id, name, icon: null, alarms: [sensor('alarm_contact', open, 'Contact alarm', min)] });
  const motionDot = (id, name, on, min) => ({ id, name, icon: null, alarms: [sensor('alarm_motion', on, 'Motion alarm', min)] });
  const lcap = v => ({ value: v, setable: true });
  // Snapshots of the made-up house (AI-generated, cut from one picture, the timestamp baked in): dev/cameras/<id>.webp,
  // relative to the dev page that loads this file.
  const cam = (id, name) => ({ id, name, icon: null, image: { id: `img-${id}`, url: `cameras/${id}.webp`, lastUpdated: 0 }, video: `vid-${id}` });

  const FAN = { title: 'Fan speed', units: null, values: ['auto', 'low', 'medium', 'high'].map(id => ({ id, title: id[0].toUpperCase() + id.slice(1) })) };
  const MODE = { title: 'Mode', units: null, values: [['heat', 'Heat'], ['cool', 'Cool'], ['auto', 'Auto'], ['dry', 'Dry']].map(([id, title]) => ({ id, title })) };
  const heatPump = {
    type: 'thermostat',
    presets: {
      b1Power: 'off',
      b2Power: 'keep', b2Temp: { capabilityId: 'target_temperature', value: 21 }, b2Mode: { capabilityId: 'hp_mode', value: 'heat' }, b2Extra: { capabilityId: 'fan_speed', value: 'auto' },
      b3Power: 'keep', b3Temp: { capabilityId: 'target_temperature', value: 23 }, b3Mode: { capabilityId: 'hp_mode', value: 'heat' }, b3Extra: { capabilityId: 'fan_speed', value: 'high' },
    },
    state: {
      name: 'Heat pump | Living room', icon: icon('climate'),
      values: { onoff: true, target_temperature: 21, hp_mode: 'heat', fan_speed: 'auto' },
      caps: { onoff: { title: 'Turned on', units: null, values: null }, target_temperature: { title: 'Target temperature', units: '°C', values: null }, hp_mode: MODE, fan_speed: FAN },
    },
  };

  const lights = [
    { id: 'l1', name: 'Living room', icon: icon('light-hanging'), zone: { id: 'z1', name: 'Living room' }, caps: { onoff: lcap(true), dim: lcap(0.55), light_temperature: lcap(0.85), light_mode: lcap('temperature') } },
    { id: 'l2', name: 'Sofa lamp', icon: icon('light-standing'), zone: { id: 'z1', name: 'Living room' }, caps: { onoff: lcap(true), dim: lcap(0.4), light_hue: lcap(0.07), light_saturation: lcap(0.75), light_temperature: lcap(0.9), light_mode: lcap('color') } },
    { id: 'l3', name: 'Kitchen spots', icon: icon('light-spot'), zone: { id: 'z2', name: 'Kitchen' }, caps: { onoff: lcap(true), dim: lcap(1), light_temperature: lcap(0.35), light_mode: lcap('temperature') } },
    { id: 'l4', name: 'Dining table', icon: icon('light-hanging'), zone: { id: 'z3', name: 'Dining room' }, caps: { onoff: lcap(true), dim: lcap(0.7), light_temperature: lcap(0.95) } },
    { id: 'l5', name: 'Office desk', icon: icon('light-table'), zone: { id: 'z4', name: 'Office' }, caps: { onoff: lcap(false), dim: lcap(0.8), light_temperature: lcap(0.2) } },
    { id: 'l6', name: 'Terrace', icon: icon('light-outdoor'), zone: { id: 'z5', name: 'Garden' }, caps: { onoff: lcap(true), dim: lcap(0.3), light_hue: lcap(0.6), light_saturation: lcap(0.55), light_mode: lcap('color') } },
  ];
  const outdoorLights = [
    { id: 'o1', name: 'Entrance', icon: icon('light-outdoor'), caps: { onoff: lcap(true), dim: lcap(0.8), light_temperature: lcap(0.8) } },
    { id: 'o2', name: 'Driveway', icon: icon('light-spot'), caps: { onoff: lcap(true), dim: lcap(0.45) } },
    { id: 'o3', name: 'Garden path', icon: icon('light-outdoor'), caps: { onoff: lcap(false), dim: lcap(0.6), light_temperature: lcap(0.9) } },
    { id: 'o4', name: 'Terrace', icon: icon('light-outdoor'), caps: { onoff: lcap(true), dim: lcap(0.3), light_hue: lcap(0.6), light_saturation: lcap(0.55), light_mode: lcap('color') } },
    { id: 'o5', name: 'Carport', icon: icon('light-spot'), caps: { onoff: lcap(true), dim: lcap(1) } },
    { id: 'o6', name: 'Shed', icon: icon('light-outdoor'), caps: { onoff: lcap(false), dim: lcap(0.5) } },
  ];

  const smokeAndWater = [
    { id: 's1', name: 'Kitchen', icon: icon('smoke-detector'), alarms: [alarm('alarm_smoke', false, 'Smoke alarm'), alarm('alarm_heat', false, 'Heat alarm')] },
    { id: 's2', name: 'Hallway', icon: icon('smoke-detector'), alarms: [alarm('alarm_smoke', false, 'Smoke alarm')] },
    { id: 's3', name: "Emma's room", icon: icon('air-purifier'), alarms: [alarm('alarm_co2', true, 'CO₂ alarm'), alarm('alarm_radon', false, 'Radon alarm')] },
    { id: 's4', name: 'Utility room', icon: icon('washing-machine'), alarms: [alarm('alarm_water', false, 'Water alarm')] },
  ];

  const indoorSparks = [
    sparkSlot('t1', 'measure_temperature', 'Living room', { units: '°C', decimals: 1 }, spark((t, r) => round(20.9 + 0.5 * dayCurve(t, 19) + 0.1 * r(), 1), 3)),
    sparkSlot('t2', 'measure_temperature', 'Outdoor', { units: '°C', decimals: 1 }, spark((t, r) => round(10.4 + 3 * dayCurve(t, 14) + 0.2 * r(), 1), 5)),
    sparkSlot('t3', 'measure_co2', "Emma's room", { units: 'ppm', decimals: 0 }, spark((t, r) => {
      // Up through the night with the door shut, aired out in the morning, homework from 16.
      const h = hourOf(t) + new Date(t).getMinutes() / 60;
      return Math.round((h >= 21 || h < 7 ? 820 + 115 * ((h + 3) % 24) : h >= 16 ? 640 + 45 * (h - 16) : h < 8 ? 1900 - 1300 * (h - 7) : 560) + 30 * r());
    }, 7)),
    sparkSlot('t4', 'measure_humidity', 'Bathroom', { units: '%', decimals: 0 }, spark((t, r) => {
      const h = hourOf(t) + new Date(t).getMinutes() / 60;
      return Math.round(h >= 7.1 && h < 7.6 ? 88 : h >= 7.6 && h < 9 ? 88 - 22 * (h - 7.6) : 54 + 4 * r());
    }, 9)),
  ];

  // ---- More of the house, for the Climate, Evening, Garden and Kitchen dashboards.

  /** A thermostat with three temperature presets and no mode (a radiator valve, the floor heating). */
  const thermo = (name, iconName, temps, current, onoff = true) => ({
    type: 'thermostat',
    presets: Object.fromEntries(temps.flatMap((v, i) => [[`b${i + 1}Power`, 'keep'], [`b${i + 1}Temp`, { capabilityId: 'target_temperature', value: v }]])),
    state: {
      name, icon: icon(iconName),
      values: { onoff, target_temperature: current },
      caps: { onoff: { title: 'Turned on', units: null, values: null }, target_temperature: { title: 'Target temperature', units: '°C', values: null } },
    },
  });
  /** Flow Buttons from `[id, name, colour, icon, enabled?]` rows. */
  const flowButtons = (columns, list) => ({
    type: 'flows',
    opts: { columns, buttons: list.map(([id, , color, iconId]) => ({ id, color, icon: iconId })) },
    flows: list.map(([id, name, , , enabled = true]) => ({ id, name, enabled, triggerable: true, advanced: id.startsWith('advanced:') })),
  });
  /** A week of a room's temperature: the heating's day and night setpoints, and the sun through the windows. */
  const heatTemp = (name, base, seed) => ({
    name, icon: icon('climate'), language: 'en', value: base + 0.4,
    capability: { id: 'measure_temperature', title: 'Temperature', type: 'number', units: '°C', decimals: 1 },
    days: heatDays((t, wd, h, r) => {
      const night = h < 6 || h >= 23 ? -2.2 : 0;
      const sun = h >= 11 && h < 16 && (wd === 0 || wd === 2 || wd === 6) ? 1.4 * Math.sin(((h - 11) / 5) * Math.PI) : 0;
      return round(base + night + sun + 0.3 * r(), 1);
    }, seed),
  });
  /** A week of daylight in the garden: bright days, a grey Thursday and Friday. */
  const heatLux = () => ({
    name: 'Garden sensor', icon: icon('motion-sensor'), language: 'en', value: 4,
    capability: { id: 'measure_luminance', title: 'Light', type: 'number', units: 'lx', decimals: 0 },
    days: heatDays((t, wd, h, r) => {
      if (h < 7 || h >= 19) return 0;
      const cloudy = wd === 4 || wd === 5 ? 0.35 : 1;
      return Math.round(9000 * cloudy * Math.sin(((h + 0.5 - 7) / 12) * Math.PI) * (0.75 + 0.25 * r()));
    }, 41),
  });

  const eveningLights = [
    { id: 'v1', name: 'Ceiling', icon: icon('light-hanging'), zone: { id: 'z1', name: 'Living room' }, caps: { onoff: lcap(true), dim: lcap(0.35), light_temperature: lcap(0.95), light_mode: lcap('temperature') } },
    { id: 'v2', name: 'Sofa lamp', icon: icon('light-standing'), zone: { id: 'z1', name: 'Living room' }, caps: { onoff: lcap(true), dim: lcap(0.4), light_hue: lcap(0.07), light_saturation: lcap(0.75), light_temperature: lcap(0.9), light_mode: lcap('color') } },
    { id: 'v3', name: 'TV backlight', icon: icon('light-spot'), zone: { id: 'z1', name: 'Living room' }, caps: { onoff: lcap(true), dim: lcap(0.6), light_hue: lcap(0.78), light_saturation: lcap(0.7), light_mode: lcap('color') } },
    { id: 'v4', name: 'Dining table', icon: icon('light-hanging'), zone: { id: 'z3', name: 'Dining room' }, caps: { onoff: lcap(true), dim: lcap(0.7), light_temperature: lcap(0.95) } },
    { id: 'v5', name: 'Kitchen spots', icon: icon('light-spot'), zone: { id: 'z2', name: 'Kitchen' }, caps: { onoff: lcap(true), dim: lcap(1), light_temperature: lcap(0.35), light_mode: lcap('temperature') } },
    { id: 'v6', name: 'Window', icon: icon('christmas-lights'), zone: { id: 'z6', name: 'Window' }, caps: { onoff: lcap(true), dim: lcap(0.5), light_hue: lcap(0.11), light_saturation: lcap(0.85), light_mode: lcap('color') } },
    { id: 'v7', name: 'Bedside left', icon: icon('light-table'), zone: { id: 'b1', name: 'Bedroom' }, caps: { onoff: lcap(false), dim: lcap(0.2), light_temperature: lcap(1) } },
    { id: 'v8', name: 'Bedside right', icon: icon('light-table'), zone: { id: 'b1', name: 'Bedroom' }, caps: { onoff: lcap(false), dim: lcap(0.2), light_temperature: lcap(1) } },
  ];

  window.SHOWCASE = {
    home: {
      title: 'Home',
      columns: [
        [
          { type: 'electricity', settings: { liveWindow: 30, nextLow: 'none', smooth: true }, data: electricity() },
          heatPump,
          { type: 'flows', opts: { columns: '2', buttons: [
            { id: 'flow:1', color: 'purple', icon: 'moon' }, { id: 'flow:2', color: 'yellow', icon: 'sun' },
          ] }, flows: [
            { id: 'flow:1', name: 'Good night', enabled: true, triggerable: true, advanced: false },
            { id: 'flow:2', name: 'Good morning', enabled: true, triggerable: true, advanced: false },
          ] },
        ],
        [
          { type: 'weather', hours: weatherHours() },
          { type: 'lights', devices: lights },
          { type: 'quickactions', devices: [
            { id: 'q1', name: 'Front door', icon: icon('lock'), quickAction: qa('locked', true) },
            { id: 'q2', name: 'Coffee', icon: icon('coffee-machine'), quickAction: qa('onoff', false) },
            { id: 'q3', name: 'TV', icon: icon('tv'), quickAction: qa('onoff', true) },
          ] },
          { type: 'sensoralarms', devices: smokeAndWater },
        ],
        [
          { type: 'cameras', cameras: [cam('drive', 'Driveway'), cam('door', 'Hallway')] },
          { type: 'sparklines', slots: indoorSparks },
          { type: 'heatmap', opts: { period: 'rolling', step: 2 }, data: heatMotion() },
        ],
      ],
    },

    energy: {
      title: 'Energy',
      columns: [
        [
          { type: 'electricity', settings: { liveWindow: 60, nextLow: '24', smooth: true, separateUsage: true, usageColor: 'purple' }, data: electricity() },
        ],
        [
          { type: 'heatmap', opts: { period: 'rolling', step: 2, color: 'orange' }, data: heatPower() },
          { type: 'sparklines', slots: [
            sparkSlot('m1', 'measure_power', 'Main meter', { units: 'W', decimals: 0 }, spark((t, r) => (t > NOW - DAY / 120 ? powerNow() : Math.round(houseLoad(t, r) + (t > NOW - 40 * MIN ? 1500 : 0))), 11)),
            sparkSlot('w1', 'measure_power', 'Heat pump', { units: 'W', decimals: 0 }, spark((t, r) => Math.round(520 + 260 * Math.sin(t / (41 * MIN)) + 40 * r()), 13)),
            sparkSlot('c2', 'measure_power', 'Car charger', { units: 'W', decimals: 0 }, spark(t => (houseLoad(t, null, true) - houseLoad(t, null, false) > 0 ? 3650 : 0), 15)),
            sparkSlot('h1', 'measure_temperature', 'Water heater', { units: '°C', decimals: 0 }, spark((t, r) => {
              const h = hourOf(t) + new Date(t).getMinutes() / 60;
              return Math.round(h >= 7.1 && h < 7.5 ? 62 - 50 * (h - 7.1) : h >= 7.5 && h < 13 ? 42 + 0.6 * (h - 7.5) : h >= 13 && h < 15 ? 45 + 8.5 * (h - 13) : 62 - 0.2 * ((h + 9) % 24) + r());
            }, 17)),
          ] },
          { type: 'variables', opts: { columns: '2' }, vars: [
            { id: 'e1', name: 'Charge at the cheapest hours', type: 'boolean', value: true },
            { id: 'e2', name: 'Price cap', type: 'number', value: 2.5 },
          ] },
        ],
        [
          // 18:40, the evening peak: high, cheaper from 19, the low at 03 tonight.
          { type: 'price', state: { prices: electricity().prices, fixedPrice: null, currency: 'DKK' } },
          heatPump,
          { type: 'weather', opts: { density: 'detailed' }, hours: weatherHours() },
          { type: 'quickactions', devices: [
            { id: 'e1', name: 'Car charger', icon: icon('car-charger'), quickAction: qa('onoff', false) },
            { id: 'e2', name: 'Dryer', icon: icon('dryer'), quickAction: qa('onoff', false) },
            { id: 'e3', name: 'Water heater', icon: icon('socket'), quickAction: qa('onoff', true) },
            { id: 'e4', name: 'Fridge', icon: icon('fridge'), quickAction: qa('onoff', true) },
            { id: 'e5', name: 'Kettle', icon: icon('kettle'), quickAction: qa('onoff', false) },
            { id: 'e6', name: 'Oven', icon: icon('oven'), quickAction: qa('onoff', true) },
          ] },
          { type: 'values', opts: { percentFill: true }, slots: [
            value('c1', 'measure_battery', 'Car', { units: '%', decimals: 0 }, 86),
            value('c2', 'measure_power', 'Car charger', { units: 'W', decimals: 0 }, 0),
            // Green from a Flow while today's use stays under budget.
            { ...value('m1', 'meter_power', 'Today', { units: 'kWh', decimals: 1 }, 31.4), color: 'green' },
          ] },
        ],
      ],
    },

    security: {
      title: 'Security',
      columns: [
        [
          { type: 'cameras', cameras: [
            cam('drive', 'Driveway'), cam('door', 'Hallway'),
            cam('garden', 'Terrace'), cam('shed', 'Shed'),
            cam('living', 'Kitchen'), cam('side', 'Side path'),
          ] },
          { type: 'sensoralarms', opts: { includeStates: true }, devices: [
            ...smokeAndWater,
            { id: 's5', name: 'Back door', icon: icon('door'), alarms: [alarm('alarm_contact', false, 'Contact alarm', true), alarm('alarm_tamper', false, 'Tamper alarm')] },
            { id: 's6', name: 'Garage', icon: icon('garage-door'), alarms: [alarm('alarm_contact', true, 'Contact alarm', true)] },
          ] },
          // One line (the default view): the shed is unlocked and the garage open. The README shows the list.
          { type: 'locks', opts: { locale: 'en-GB' }, devices: [
            lockDevice('k1', 'Front door', 'lock', { locked: [true, 52], alarm_contact: [false, 53] }),
            lockDevice('k2', 'Back door', 'lock', { locked: [true, 95] }),
            lockDevice('k3', 'Shed', 'lock', { locked: [false, 41] }),
            lockDevice('k4', 'Garage', 'garage-door', { garagedoor_closed: [false, 23] }),
          ] },
        ],
        [
          { type: 'quickactions', devices: [
            { id: 'k1', name: 'Front door', icon: icon('lock'), quickAction: qa('locked', true) },
            { id: 'k2', name: 'Back door', icon: icon('lock'), quickAction: qa('locked', true) },
            { id: 'k3', name: 'Shed', icon: icon('lock'), quickAction: qa('locked', false) },
          ] },
          { type: 'heatmap', opts: { period: 'rolling', step: 2 }, data: heatMotion() },
          { type: 'values', opts: { percentFill: true }, slots: [
            value('b1', 'measure_battery', 'Front door', { units: '%', decimals: 0 }, 72),
            value('b2', 'measure_battery', 'Back door', { units: '%', decimals: 0 }, 9),
            value('b3', 'measure_battery', 'Hallway', { units: '%', decimals: 0 }, 18),
            value('b4', 'measure_battery', 'Kitchen', { units: '%', decimals: 0 }, 94),
            value('b5', 'measure_battery', 'Doorbell', { units: '%', decimals: 0 }, 61),
            value('b6', 'measure_battery', 'Garage', { units: '%', decimals: 0 }, 45),
          ] },
          { type: 'variables', opts: { columns: '2' }, vars: [
            { id: 'f1', name: 'Away mode', type: 'boolean', value: false },
            { id: 'f2', name: 'Guests staying over', type: 'boolean', value: true },
            { id: 'f3', name: 'Pause the hallway motion lights', type: 'boolean', value: false },
            { id: 'f4', name: 'Night setpoint', type: 'number', value: 18.5 },
          ] },
        ],
        [
          { type: 'lights', devices: outdoorLights },
          { type: 'quickactions', devices: [
            { id: 'g1', name: 'Garage door', icon: icon('garage-door'), quickAction: qa('onoff', true) },
            { id: 'g2', name: 'Doorbell', icon: icon('doorbell'), quickAction: { capabilityId: 'button', value: true, actionable: true, momentary: true, icon: null } },
            { id: 'g3', name: 'Router', icon: icon('router'), quickAction: qa('onoff', true) },
          ] },
          // The open garage is in the second row (7 or 8 dots per row), so its overlay leaves the hallway's red dot showing.
          { type: 'sensordots', opts: { locale: 'en-GB', title: 'Doors and motion' }, open: 'd9', devices: [
            contactDot('d1', 'Front door', false, 52), motionDot('d2', 'Hallway', true, 1),
            contactDot('d3', 'Back door', false, 95), motionDot('d4', 'Kitchen', false, 6),
            contactDot('d5', 'Kitchen window', false, 310), motionDot('d6', 'Living room', false, 14),
            contactDot('d7', 'Bedroom window', false, 640), motionDot('d8', 'Office', false, 180),
            contactDot('d9', 'Garage', true, 23), contactDot('d10', 'Shed', false, 1500),
            { id: 'd11', name: 'Driveway', icon: null, alarms: [sensor('alarm_motion', false, 'Motion alarm', 9), sensor('alarm_person', false, 'Person Detected', 9)] },
            motionDot('d12', 'Terrace', false, 75),
          ] },
          { type: 'weather', hours: weatherHours() },
        ],
      ],
    },

    climate: {
      title: 'Climate',
      columns: [
        [
          heatPump,
          thermo('Bedroom | Radiator', 'thermostat', [16, 18, 20], 18),
          thermo('Bathroom | Floor heating', 'thermostat', [20, 23, 26], 23),
          { type: 'values', opts: { columns: '3' }, slots: [
            value('r1', 'measure_temperature', 'Living room', { units: '°C', decimals: 1 }, 21.4),
            value('r2', 'measure_temperature', 'Bedroom', { units: '°C', decimals: 1 }, 18.2),
            value('r3', 'measure_temperature', "Emma's room", { units: '°C', decimals: 1 }, 20.6),
            value('r4', 'measure_humidity', 'Bathroom', { units: '%', decimals: 0 }, 56),
            value('r5', 'measure_co2', "Emma's room", { units: 'ppm', decimals: 0 }, 783),
            value('r6', 'measure_humidity', 'Bedroom', { units: '%', decimals: 0 }, 48),
          ] },
        ],
        [
          { type: 'heatmap', opts: { period: 'rolling', step: 2, color: 'red' }, data: heatTemp('Living room', 21.2, 51) },
          { type: 'sparklines', slots: indoorSparks },
        ],
        [
          { type: 'weather', opts: { density: 'detailed', theme: 'temperature' }, hours: weatherHours() },
          flowButtons('2', [
            ['flow:c1', 'Air out', 'blue', 'fan'], ['flow:c2', 'Eco mode', 'green', 'drop'],
            ['flow:c3', 'Warm bathroom', 'orange', 'flame'], ['advanced:c4', 'Frost guard', 'grey', 'snowflake'],
          ]),
          { type: 'variables', opts: { columns: '2' }, vars: [
            { id: 'cv1', name: 'Night setpoint', type: 'number', value: 18.5 },
            { id: 'cv2', name: 'Heating season', type: 'boolean', value: true },
          ] },
        ],
      ],
    },

    evening: {
      title: 'Evening',
      columns: [
        [
          { type: 'lights', opts: { groupByZone: true, palette: 'dusk' }, devices: eveningLights },
          flowButtons('2', [
            ['advanced:v1', 'Movie time', 'purple', 'tv'], ['flow:v2', 'Dinner', 'orange', 'bulb'],
            ['flow:v3', 'Reading light', 'yellow', 'star'], ['flow:v4', 'Good night', 'blue', 'moon'],
          ]),
          { type: 'sparklines', slots: indoorSparks.slice(0, 2) },
        ],
        [
          { type: 'quickactions', devices: [
            { id: 'eq1', name: 'TV', icon: icon('tv'), quickAction: qa('onoff', true) },
            { id: 'eq2', name: 'Speaker', icon: icon('speaker'), quickAction: qa('onoff', true) },
            { id: 'eq3', name: 'Kettle', icon: icon('kettle'), quickAction: qa('onoff', false) },
            { id: 'eq4', name: 'Front door', icon: icon('lock'), quickAction: qa('locked', true) },
            { id: 'eq5', name: 'Back door', icon: icon('lock'), quickAction: qa('locked', false) },
            { id: 'eq6', name: 'Dishwasher', icon: icon('socket'), quickAction: qa('onoff', false) },
          ] },
          heatPump,
          { type: 'cameras', cameras: [cam('door', 'Hallway'), cam('drive', 'Driveway')] },
          { type: 'values', opts: { columns: '3' }, slots: [
            value('ew1', 'measure_power', 'House', { units: 'W', decimals: 0 }, 3536),
            value('ew2', 'measure_humidity', 'Living room', { units: '%', decimals: 0 }, 47),
            { ...value('ew3', 'measure_co2', "Emma's room", { units: 'ppm', decimals: 0 }, 783), color: 'green' },
          ] },
        ],
        [
          { type: 'weather', opts: { rows: 2, step: 2 }, hours: weatherHours() },
          // The living room speaker in the condensed layout, its TV and line-in buttons behind ⋯.
          { type: 'media', speaker: ['Living room', 0], opts: {
            volumeLayout: 'buttons', showProgress: false, canSwitch: true,
            buttons: [{ id: 'card:tv', name: 'TV' }, { id: 'card:line', name: 'Line-in' }],
          } },
          { type: 'variables', opts: { columns: '1' }, vars: [
            { id: 'ev1', name: 'Guests staying over', type: 'boolean', value: true },
            { id: 'ev2', name: 'Kids in bed', type: 'boolean', value: false },
            { id: 'ev3', name: 'Note on the hallway screen', type: 'string', value: 'Pizza at 19!' },
          ] },
          { type: 'sensoralarms', devices: smokeAndWater.slice(0, 2) },
        ],
      ],
    },

    garden: {
      title: 'Garden',
      columns: [
        [
          { type: 'cameras', cameras: [cam('garden', 'Terrace'), cam('shed', 'Shed'), cam('side', 'Side path'), cam('drive', 'Driveway')] },
          { type: 'lights', devices: outdoorLights },
        ],
        [
          { type: 'weather', opts: { density: 'detailed', rows: 2, theme: 'sky' }, hours: weatherHours() },
          { type: 'heatmap', opts: { period: 'rolling', step: 2, color: 'yellow' }, data: heatLux() },
        ],
        [
          { type: 'sparklines', slots: [
            sparkSlot('g1', 'measure_temperature', 'Outdoor', { units: '°C', decimals: 1 }, spark((t, r) => round(10.4 + 3 * dayCurve(t, 14) + 0.2 * r(), 1), 5)),
            sparkSlot('g2', 'measure_wind_strength', 'Wind', { units: 'm/s', decimals: 1 }, spark((t, r) => round(4.2 + 1.4 * dayCurve(t, 16) + 1.2 * r(), 1), 19)),
          ] },
          { type: 'values', opts: { columns: '3', percentFill: true }, slots: [
            value('gv1', 'measure_humidity', 'Lawn soil', { units: '%', decimals: 0 }, 38),
            value('gv2', 'measure_humidity', 'Greenhouse', { units: '%', decimals: 0 }, 71),
            value('gv3', 'measure_battery', 'Mower', { units: '%', decimals: 0 }, 100),
          ] },
          flowButtons('1', [
            ['flow:gb1', 'Water the vegetable beds', 'blue', 'drop'],
            ['flow:gb2', 'Mow the lawn', 'green', 'play'],
            ['flow:gb3', 'Garden lights for an hour', 'yellow', 'bulb'],
          ]),
          // The driveway (a person, just now) has its overlay open; the open greenhouse stays blue below it.
          { type: 'sensordots', opts: { locale: 'en-GB', title: 'Outside' }, open: 'gd3', devices: [
            contactDot('gd1', 'Gate', false, 47), motionDot('gd2', 'Terrace', false, 75),
            { id: 'gd3', name: 'Driveway', icon: null, alarms: [sensor('alarm_motion', true, 'Motion alarm', 2), sensor('alarm_person', true, 'Person Detected', 2)] },
            contactDot('gd4', 'Shed', false, 1500), motionDot('gd5', 'Side path', false, 33),
            contactDot('gd6', 'Greenhouse', true, 260), contactDot('gd7', 'Carport', false, 1100),
          ] },
        ],
      ],
    },

    kitchen: {
      title: 'Kitchen',
      columns: [
        [
          { type: 'electricity', settings: { liveWindow: 10, nextLow: 'both', smooth: true }, data: electricity() },
          flowButtons('2', [
            ['flow:k1', "Dinner's ready", 'orange', 'bell'], ['flow:k2', 'Good morning', 'yellow', 'sun'],
            ['flow:k3', 'Leaving home', 'blue', 'leave'], ['flow:k4', 'Party mode', 'purple', 'music'],
          ]),
        ],
        [
          { type: 'weather', opts: { theme: 'vivid' }, hours: weatherHours() },
          { type: 'quickactions', devices: [
            { id: 'kq1', name: 'Oven', icon: icon('oven'), quickAction: qa('onoff', true) },
            { id: 'kq2', name: 'Kettle', icon: icon('kettle'), quickAction: qa('onoff', false) },
            { id: 'kq3', name: 'Coffee', icon: icon('coffee-machine'), quickAction: qa('onoff', false) },
            { id: 'kq4', name: 'Fridge', icon: icon('fridge'), quickAction: qa('onoff', true) },
            { id: 'kq5', name: 'Dishwasher', icon: icon('socket'), quickAction: qa('onoff', false) },
            { id: 'kq6', name: 'Radio', icon: icon('speaker'), quickAction: qa('onoff', true) },
          ] },
          { type: 'values', opts: { columns: '3' }, slots: [
            // Blue from a Flow while they're cold enough.
            { ...value('kv1', 'measure_temperature', 'Fridge', { units: '°C', decimals: 1 }, 3.8), color: 'blue' },
            { ...value('kv2', 'measure_temperature', 'Freezer', { units: '°C', decimals: 0 }, -19), color: 'blue' },
            value('kv3', 'measure_power', 'Oven', { units: 'W', decimals: 0 }, 2300),
          ] },
          { type: 'sensoralarms', devices: [smokeAndWater[0], smokeAndWater[3]] },
          { type: 'timers', presets: [{ minutes: 7, label: 'Eggs' }, { minutes: 12, label: 'Pizza' }, { minutes: 5, label: '' }, { minutes: 20, label: '' }], timers: [
            { id: 'kt1', label: 'Pizza', duration: 12 * MIN, endsAt: NOW + 8 * MIN + 24e3, remaining: null, doneAt: null },
          ] },
        ],
        [
          { type: 'lights', devices: [lights[2], lights[3], lights[0], lights[1]] },
          { type: 'variables', opts: { columns: '1' }, vars: [
            { id: 'kx1', name: 'Shopping list', type: 'string', value: 'Milk, eggs, rye bread' },
            { id: 'kx2', name: 'Dishwasher emptied', type: 'boolean', value: false },
          ] },
          { type: 'cameras', cameras: [cam('door', 'Hallway')] },
        ],
      ],
    },
  };
})();
