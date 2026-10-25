// Builds one web dashboard per widget type on the active Homey (the one `npx homey select` picked), each with the
// widget in its different configurations, for testing: `Test · <widget>`, id `test-<widget>`. Re-running replaces
// those and keeps every other web dashboard. Devices, flows, variables and the rest are picked on the Homey by their
// capabilities and classes, never by name, so nothing about the house is in here.
//
//   npm run test-dashboards                 every widget type
//   npm run test-dashboards -- lights media only those
//   npm run test-dashboards -- --remove     removes every test dashboard (`test-…` web ones, or `Test · …` with --native)
//   npm run test-dashboards -- --native …   the same as native Homey dashboards (the Homey app's), instead of web ones
//   npm run test-dashboards -- --apps "Widgey,Sun Times"   other apps' widgets instead: `Test · Other apps`, id `test-apps`
//
// It writes the app setting `webDashboards` through the Homey CLI's login (the web dashboards' own API wants the
// password's session too), so the app's `normalize()` checks it on the next read, as for any saved dashboard.
// The "Rename tiles" widgets get a name already typed on a tile, in the app setting `tileNames`. On the front page they're
// under their own section, Test dashboards (the app setting `webFront`), which goes with the last of them.
// Each type also gets a Vivid copy of its first plain widget (Colour style), one in purple where it has a colour setting,
// and a Muted one in orange. A widget marked `wide()` spans two columns on the web dashboard (native ones can't).
//
// With --native they're Homey dashboards named `Test · <widget>` (the Homey picks a dashboard's id, so the name is the
// marker), updated in place on a re-run. Their widget and column ids are derived from the type and position
// (`stableUuid()`), so a re-run keeps each widget's instance: its typed tile names, a running timer, Media's speaker.
//
// With --apps (app names as the Homey shows them, or app ids, comma-separated) it's one web dashboard of every widget
// those apps have, a column per app, each with its manifest's defaults and its first autocomplete setting filled
// (a Homey variable where there is one, so a toggle switches no device).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { APP_ID, WEB_SETTING as SETTING, WEB_FRONT_SETTING, DASHBOARDS, TILE_NAMES, MAX_WEB_DASHBOARDS, connect, widgetManifests } from './homey-session.mjs';

const EN = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));
const PREFIX = 'test-';
/** The front page's section the web test dashboards are under, as long as there are any. */
const SECTION = { id: 'test-dashboards', name: 'Test dashboards' };
/** The name every native test dashboard starts with: the Homey picks their ids, so the name is the marker. */
const NATIVE_PREFIX = 'Test · ';
const MISSING = 'missing-device-0000'; // a device id that doesn't exist: the widgets' missing state

const { values: opts, positionals } = parseArgs({ options: { remove: { type: 'boolean' }, native: { type: 'boolean' }, apps: { type: 'string' } }, allowPositionals: true });

const { api: homeyApi, close } = await connect();

/** A widget's autocomplete items, as Homey's widget settings ask for them (`settings` as `{key: id}`). */
async function autocomplete(widget, settingId, settings = {}, query = '') {
  const p = new URLSearchParams({ settingId, query });
  for (const [k, id] of Object.entries(settings)) p.set(`settings[${k}][id]`, id);
  const items = await homeyApi('GET', `/api/manager/dashboards/appwidget/${encodeURIComponent(`homey:app:${APP_ID}:${widget}`)}/autocomplete?${p}`);
  return (Array.isArray(items) ? items : []).map(({ image, ...item }) => item);
}

// ---------------------------------------------------------------- the Homey's things

const widgetDefs = widgetManifests();

const devices = Object.values(await homeyApi('GET', '/api/manager/devices/device/'))
  .sort((a, b) => a.name.localeCompare(b.name));
const has = (d, ...caps) => caps.every(c => d.capabilities?.includes(c));
const where = (fn, n = Infinity) => devices.filter(fn).slice(0, n).map(d => d.id);
const cls = d => d.virtualClass || d.class;

/** Spreads a list over n columns, in order (the first n go across the top, as a reader scans it). */
function columns(widgets, n = 3) {
  const cols = Array.from({ length: n }, () => []);
  widgets.forEach((w, i) => cols[i % n].push(w));
  return cols;
}

/** A widget: its title says what's being tested. */
const w = (type, title, settings = {}, deviceIds = []) => ({ type, title, settings, deviceIds });
/** A widget in rename mode (`renameTiles`) with names already typed on its tiles (tile key → name; see TILE_NAMES). */
const renaming = (type, title, settings, deviceIds, tileNames) => ({ ...w(type, title, { ...settings, renameTiles: true }, deviceIds), tileNames });
/**
 * A widget two columns wide on the web dashboard (`span`, wk-083). Put it first in the builder's list: it then heads the
 * first two columns (`normalize()` gives it `at: [0]`). Native dashboards have no wide widgets, so there it's one column.
 */
const wide = x => ({ ...x, title: `Wide on the web · ${x.title}`, span: 2 });

/**
 * Colour style (`colorStyle`): a Vivid copy of a type's first plain widget (not renaming, no deleted device, not wide),
 * one more in purple and a Muted one in orange where the type has a colour setting, and Weather's Vivid theme.
 */
function deepVariants(type, widgets) {
  const settings = widgetDefs[type].settings || [];
  const ids = settings.map(s => s.id);
  const plain = widgets.find(x => !x.tileNames && !x.settings?.renameTiles && !x.deviceIds?.includes(MISSING) && !x.span);
  if (!plain) return [];
  const { span, ...base } = plain;
  if (type === 'weather') return [{ ...base, title: `Vivid theme · ${base.title}`, settings: { ...base.settings, theme: 'card' } }];
  if (!ids.includes('colorStyle')) return [];
  const deep = { ...base, title: `Vivid · ${base.title}`, settings: { ...base.settings, colorStyle: 'deep' } };
  const colors = settings.find(s => s.id === 'color')?.values?.map(v => v.id) ?? [];
  return [
    deep,
    ...(colors.includes('purple') ? [{ ...deep, title: `Vivid · purple · ${base.title}`, settings: { ...deep.settings, color: 'purple' } }] : []),
    ...(colors.includes('orange') ? [{ ...base, title: `Muted · orange · ${base.title}`, settings: { ...base.settings, color: 'orange' } }] : []),
  ];
}

/** The first n autocomplete items that pass, `None` and the like left out. */
const pick = (items, fn = () => true, n = 1) => items.filter(i => i.id !== 'none' && fn(i)).slice(0, n);

/** `{slot1: …, slot2: …}` from a list of items (null where a slot stays empty). */
const slots = (prefix, items) => Object.fromEntries(items.map((item, i) => [`${prefix}${i + 1}`, item ?? null]));

/** A flow that may not be harmless to start by hand (a tap starts it for real): security, alarm, lock or siren. */
const RISKY_FLOW = /secur|alarm|siren|lock|fire|smoke|left|came home|restart|rstart/i;

// ---------------------------------------------------------------- one builder per widget type

const BUILD = {
  async electricity() {
    const meter = where(d => has(d, 'measure_power') && d.class === 'sensor', 1).concat(where(d => has(d, 'measure_power'), 1))[0];
    const m = meter ? [meter] : [];
    return { cols: 3, widgets: [
      wide(w('electricity', 'Separate usage · smooth', { separateUsage: true, smooth: true }, m)),
      w('electricity', 'Defaults', {}, m),
      w('electricity', 'Compact', { layout: 'compact' }, m),
      w('electricity', '60 min · smooth · separate usage · purple', { liveWindow: '60', smooth: true, separateUsage: true, usageColor: 'purple' }, m),
      w('electricity', '30 min window', { liveWindow: '30' }, m),
      w('electricity', '5 min window · compact', { liveWindow: '5', layout: 'compact' }, m),
      w('electricity', '1 min · lowest 12 and 24 h', { liveWindow: '1', nextLow: 'both' }, m),
      w('electricity', '30 s · no prices', { liveWindow: '0.5', showPrices: false }, m),
      w('electricity', 'No usage · no lowest price', { showUsage: false, nextLow: 'none' }, m),
      w('electricity', 'Spot prices (no tariffs) · lowest 24 h', { priceCosts: false, nextLow: '24' }, m),
      w('electricity', 'Compact · smooth · separate · purple', { layout: 'compact', smooth: true, separateUsage: true, usageColor: 'purple' }, m),
      w('electricity', 'No meter picked', {}, []),
    ] };
  },

  async thermostat() {
    const devs = await autocomplete('thermostat', 'device');
    // The value beside the name: a room temperature from the widget's own autocomplete, and a deleted device's.
    const sensor = pick(await autocomplete('thermostat', 'sensor'), i => i.id.endsWith(':measure_temperature'), 1);
    const missingSensor = { id: `${MISSING}:measure_temperature`, name: 'Deleted device · Temperature' };
    const out = [];
    for (const device of devs.slice(0, 2)) {
      const s = { device: device.id };
      const temps = pick(await autocomplete('thermostat', 'b1Temp', s), i => i.capabilityId, 20);
      const modes = pick(await autocomplete('thermostat', 'b1Mode', s), i => i.capabilityId, 50);
      const extras = modes; // b1Mode and b1Extra list the same items
      const modeCap = modes[0]?.capabilityId;
      const mode = n => modes.filter(i => i.capabilityId === modeCap)[n] ?? null;
      const extra = extras.find(i => i.capabilityId !== modeCap) ?? null;
      const temp = n => temps[Math.min(n, temps.length - 1)] ?? null;
      const presets = {
        device, b1Power: 'off',
        b2Power: 'on', b2Mode: mode(1), b2Temp: temp(5),
        b3Power: 'on', b3Mode: mode(0), b3Temp: temp(7), b3Extra: extra,
      };
      out.push(
        w('thermostat', 'Off · mode + temp · mode + temp + extra', presets),
        w('thermostat', 'Compact, same presets', { ...presets, layout: 'compact' }),
        w('thermostat', 'Temperatures only, power kept', { device, b1Power: 'keep', b1Temp: temp(2), b2Power: 'keep', b2Temp: temp(4), b3Power: 'keep', b3Temp: temp(6) }),
        w('thermostat', 'Value beside the name (a temperature)', { ...presets, sensor: sensor[0] ?? null }),
        w('thermostat', 'Own title "Living room" · value beside it', { ...presets, title: 'Living room', sensor: sensor[0] ?? null }),
        w('thermostat', 'Compact · value beside the name of a deleted device', { ...presets, layout: 'compact', sensor: missingSensor }),
        w('thermostat', 'Mode-only presets (setpoint under the name, tap the name)', { device, b1Power: 'off', b2Power: 'on', b2Mode: mode(1), b3Power: 'on', b3Mode: mode(0) }),
        w('thermostat', 'Compact · differ only in extra', { device, layout: 'compact', b1Power: 'on', b1Mode: mode(0), b1Temp: temp(4), b2Power: 'on', b2Mode: mode(0), b2Temp: temp(4), b2Extra: extra, b3Power: 'on', b3Mode: mode(2) }),
      );
    }
    out.push(w('thermostat', 'Defaults (no device)'));
    return { cols: 3, widgets: out };
  },

  async quickactions() {
    const lights = where(d => cls(d) === 'light', 4);
    const sockets = where(d => cls(d) === 'socket', 3);
    const locks = where(d => has(d, 'locked'), 2);
    const others = where(d => has(d, 'onoff') && !['light', 'socket'].includes(cls(d)), 3);
    const custom = where(d => d.ui?.quickAction && !['onoff', 'locked'].includes(d.ui.quickAction), 2);
    return { cols: 2, widgets: [
      w('quickactions', 'Tint · lights and plugs', {}, [...lights.slice(0, 3), ...sockets]),
      w('quickactions', 'Lighter · lights and plugs', { activeStyle: 'lighter' }, [...lights.slice(0, 3), ...sockets]),
      w('quickactions', 'Locks · other on/off · own icons', {}, [...locks, ...others, ...custom]),
      w('quickactions', 'Lighter · locks and others', { activeStyle: 'lighter' }, [...locks, ...others]),
      w('quickactions', 'One device', {}, lights.slice(0, 1)),
      w('quickactions', 'Two + a deleted device', {}, [...lights.slice(1, 3), MISSING]),
      renaming('quickactions', 'Rename tiles', {}, [...lights.slice(0, 3), MISSING], lights[0] ? { [lights[0]]: 'Typed name' } : {}),
      w('quickactions', 'No devices picked'),
    ] };
  },

  async sensoralarms() {
    const alarmCaps = d => (d.capabilities ?? []).filter(c => c.startsWith('alarm_') && !/^alarm_(battery|motion|presence|contact|person|vehicle|pet|button)\b/.test(c));
    const counted = where(d => alarmCaps(d).length > 0, 8);
    const states = where(d => has(d, 'alarm_contact') || has(d, 'alarm_motion') || has(d, 'alarm_presence'), 6);
    const none = where(d => !(d.capabilities ?? []).some(c => c.startsWith('alarm_')), 1);
    return { cols: 3, widgets: [
      w('sensoralarms', 'Defaults · alarm sensors', {}, counted),
      w('sensoralarms', 'Motion and contact counted', { includeStates: true }, [...states, ...counted.slice(0, 2)]),
      w('sensoralarms', 'Motion and contact not counted', {}, states),
      w('sensoralarms', 'No alarms · deleted device', {}, [...none, MISSING]),
      renaming('sensoralarms', 'Rename tiles', {}, counted.slice(0, 2), counted[0] ? { [counted[0]]: 'Typed name' } : {}),
    ] };
  },

  async sensordots() {
    const motion = where(d => (has(d, 'alarm_motion') || has(d, 'alarm_presence')) && cls(d) !== 'camera');
    const contact = where(d => has(d, 'alarm_contact'));
    const vibration = where(d => has(d, 'alarm_vibration'));
    const cams = where(d => cls(d) === 'camera');
    return { cols: 2, widgets: [
      w('sensordots', 'Defaults · everything', {}, [...contact, ...motion, ...vibration, ...cams]),
      w('sensordots', 'Title · green idle, red active', { title: 'Doors and motion', idleColor: 'green', activeColor: 'red' }, [...contact.slice(0, 5), ...motion.slice(0, 3)]),
      w('sensordots', 'Doors only · blue idle, orange active', { title: 'Doors', idleColor: 'blue', activeColor: 'orange' }, contact),
      w('sensordots', 'Cameras · purple/yellow', { idleColor: 'purple', activeColor: 'yellow' }, cams),
      w('sensordots', 'Vibration sensors', { title: 'Vibration' }, vibration),
      w('sensordots', 'One dot', {}, motion.slice(0, 1)),
      w('sensordots', '12-hour times (tap a dot)', { title: '12-hour', timeFormat: '12' }, [...contact.slice(0, 3), ...motion.slice(0, 3)]),
      w('sensordots', '24-hour times (tap a dot)', { title: '24-hour', timeFormat: '24' }, [...contact.slice(0, 3), ...motion.slice(0, 3)]),
      w('sensordots', 'Grey active · with a deleted device', { title: 'Odd ones', idleColor: 'grey', activeColor: 'grey' }, [...motion.slice(0, 2), MISSING]),
    ] };
  },

  async roomhealth() {
    // As lib/RoomHealthService.ts reads them: CO₂, radon, PM and VOC (any case), temperature and humidity also from a
    // room sub-capability (a heat pump's `measure_temperature.room`). Sensors only, so no plug's or fridge's thermometer.
    const air = where(d => (d.capabilities ?? []).some(c => /^measure_(co2|radon|pm25|pm10|voc)$/i.test(c)));
    const climate = where(d => d.class === 'sensor' && has(d, 'measure_temperature') && !air.includes(d.id));
    const tempOnly = where(d => d.class === 'sensor' && has(d, 'measure_temperature') && !(d.capabilities ?? []).some(c => /^measure_(humidity|co2)/i.test(c)), 3);
    const roomSub = where(d => !has(d, 'measure_temperature') && (d.capabilities ?? []).some(c => /^measure_temperature\.(room|indoor|inside)$/.test(c)), 1);
    const zoneOf = id => devices.find(d => d.id === id)?.zone;
    return { cols: 3, widgets: [
      w('roomhealth', 'Defaults · air and climate sensors', {}, [...air, ...climate].slice(0, 16)),
      w('roomhealth', 'Strict: 21–22 °C, 45–50 %, CO₂ 600, radon 40, VOC 200 (yellow and red)',
        { tempMin: 21, tempMax: 22, humidityMin: 45, humidityMax: 50, co2Max: 600, radonMax: 40, vocMax: 200 }, [...air, ...climate].slice(0, 9)),
      w('roomhealth', 'Bars, green when fine, strict CO₂ 600 (yellow and red)',
        { layout: 'bars', greenWhenFine: true, co2Max: 600 }, [...air, ...climate].slice(0, 9)),
      w('roomhealth', '2 per row · bars', { columns: '2', layout: 'bars' }, [...air, ...climate].slice(0, 9)),
      w('roomhealth', '4 per row', { columns: '4' }, [...air, ...climate].slice(0, 12)),
      w('roomhealth', 'Strict PM2.5 5 · PM10 10 (yellow and red where measured)', { pm25Max: 5, pm10Max: 10 }, air.slice(0, 6)),
      w('roomhealth', 'Temperature only', {}, tempOnly),
      w('roomhealth', "A heat pump's room temperature · deleted device", {}, [...roomSub, MISSING]),
      w('roomhealth', 'No devices picked'),
      renaming('roomhealth', 'Rename tiles', {}, air.slice(0, 3), air.length ? { [`zone:${zoneOf(air[0])}`]: 'Typed room name' } : {}),
    ] };
  },

  async valuematrix() {
    // The columns from the widget's own autocomplete (every number capability on the Homey, by id).
    const items = await autocomplete('valuematrix', 'col1');
    const col = id => items.find(i => i.id === id) ?? null;
    const [temp, hum, co2, radon, power, battery] = ['measure_temperature', 'measure_humidity', 'measure_co2', 'measure_radon', 'measure_power', 'measure_battery'].map(col);
    const cols = (...list) => Object.fromEntries(list.map((item, i) => [`col${i + 1}`, item]));
    const climate = where(d => d.class === 'sensor' && (has(d, 'measure_temperature') || has(d, 'measure_humidity') || has(d, 'measure_co2')), 12);
    const plugs = where(d => has(d, 'measure_power') && cls(d) === 'socket', 6);
    const batteries = where(d => has(d, 'measure_battery'), 6);
    const zoneOf = id => devices.find(d => d.id === id)?.zone;
    const six = cols(temp, hum, co2, radon, power, battery);
    const typed = { header1: 'Temp', range1: '20–23', header2: 'RH', range2: '35–55', header3: 'CO2', range3: '<800',
      header4: 'Rn', range4: '<80', header5: 'W', range5: '-', header6: 'Batt', range6: '>20' };
    return { cols: 3, widgets: [
      wide(w('valuematrix', 'Six columns · typed headers and ranges', { ...six, ...typed }, climate)),
      w('valuematrix', 'Rooms · °C, %, CO₂, radon (usual ranges)', cols(temp, hum, co2, radon), climate),
      w('valuematrix', 'Strict: 21–22 °C, 45–50 %, CO₂ <600 (orange and red)',
        { ...cols(temp, hum, co2), range1: '21–22', range2: '45-50', range3: '<600' }, climate),
      w('valuematrix', 'Devices · no legend', { ...cols(temp, hum, co2), rows: 'devices', showLegend: false }, climate.slice(0, 6)),
      w('valuematrix', 'Power (no range, header "Watt") · battery >30 · deleted device',
        { ...cols(power, battery), header1: 'Watt', range2: '>30', rows: 'devices' }, [...plugs.slice(0, 3), ...batteries.slice(0, 3), MISSING]),
      w('valuematrix', 'Six columns · typed headers and ranges (no range on W)', { ...six, ...typed }, climate),
      w('valuematrix', 'Unreadable range (plain column)', { ...cols(temp, hum), range1: 'warm', range2: '–' }, climate.slice(0, 4)),
      w('valuematrix', 'No values picked', {}, climate.slice(0, 3)),
      renaming('valuematrix', 'Rename tiles', cols(temp, hum), climate.slice(0, 3), climate.length ? { [`zone:${zoneOf(climate[0])}`]: 'Typed room name' } : {}),
    ] };
  },

  weather: () => ({ cols: 3, widgets: [
    wide(w('weather', 'Detailed · 2 rows', { density: 'detailed', rows: '2' })),
    w('weather', 'Defaults (compact, 1 row, 1 h)'),
    w('weather', 'Detailed', { density: 'detailed' }),
    w('weather', 'Compact · 2 rows', { rows: '2' }),
    w('weather', 'Detailed · 2 rows · 3 h', { density: 'detailed', rows: '2', step: '3' }),
    w('weather', 'Compact · 2 h · warm and cold', { step: '2', theme: 'vivid' }),
    w('weather', 'Vivid · 2 rows', { theme: 'card', rows: '2' }),
  ] }),

  pollen: () => ({ cols: 3, widgets: [
    w('pollen', 'Defaults (compact: birch, grass, mugwort, UV)'),
    w('pollen', 'Detailed', { density: 'detailed' }),
    w('pollen', 'All six types · 12-hour', { showAlder: true, showOlive: true, showRagweed: true, timeFormat: '12' }),
    w('pollen', 'Detailed · all six · no UV', { density: 'detailed', showAlder: true, showOlive: true, showRagweed: true, showUv: false }),
    w('pollen', 'UV only', { showBirch: false, showGrass: false, showMugwort: false }),
    w('pollen', 'Detailed · 24-hour', { density: 'detailed', timeFormat: '24' }),
    w('pollen', 'Nothing chosen', { showUv: false, showBirch: false, showGrass: false, showMugwort: false }),
  ] }),

  async heatmap() {
    const devs = await autocomplete('heatmap', 'device');
    const pair = async (fn, capId) => {
      const id = where(d => fn(d) && has(d, capId), 1)[0];
      const device = id && devs.find(i => i.id === id);
      const capability = device && (await autocomplete('heatmap', 'capability', { device: id })).find(i => i.id === capId);
      return capability ? { device, capability } : null;
    };
    const temp = await pair(d => d.class === 'sensor', 'measure_temperature');
    const temp2 = await pair(d => d.class === 'thermostat', 'measure_temperature') ?? temp;
    const power = await pair(d => d.class === 'sensor', 'measure_power') ?? await pair(() => true, 'measure_power');
    const motion = await pair(() => true, 'alarm_motion');
    const contact = await pair(() => true, 'alarm_contact');
    const out = [
      temp && wide(w('heatmap', 'Temperature · 14 days · 1 h', { ...temp, period: '14', step: '1' })),
      temp && w('heatmap', 'Temperature · defaults (week, 2 h, blue)', temp),
      temp2 && w('heatmap', 'Temperature · 3 days · 1 h · red', { ...temp2, period: '3', step: '1', color: 'red' }),
      power && w('heatmap', 'Power · 7 days · 3 h · yellow', { ...power, period: 'rolling', step: '3', color: 'yellow' }),
      power && w('heatmap', 'Power · 14 days · 1 h · purple', { ...power, period: '14', step: '1', color: 'purple' }),
      motion && w('heatmap', 'Motion (boolean) · week · orange', { ...motion, color: 'orange' }),
      contact && w('heatmap', 'Contact (boolean) · 10 days · green · no scale', { ...contact, period: '10', color: 'green', showScale: false }),
      temp && w('heatmap', 'No scale, no legend', { ...temp, showScale: false, showLegend: false }),
      temp && w('heatmap', 'Own title "Utility room"', { ...temp, title: 'Utility room' }),
      w('heatmap', 'Nothing picked'),
    ].filter(Boolean);
    return { cols: 3, widgets: out };
  },

  async cameras() {
    const cams = where(d => ['camera', 'doorbell'].includes(cls(d)));
    return { cols: 3, widgets: [
      wide(w('cameras', 'Three · large on top', { layout: 'top' }, cams.slice(0, 3))),
      w('cameras', 'One · 5 s', { refresh: '5' }, cams.slice(0, 1)),
      w('cameras', 'Two · defaults (10 s)', {}, cams.slice(1, 3)),
      w('cameras', 'Three (odd last) · 30 s', { refresh: '30' }, cams.slice(0, 3)),
      w('cameras', 'Three · one per row', { layout: 'single' }, cams.slice(0, 3)),
      w('cameras', 'All · 60 s', { refresh: '60' }, cams),
      w('cameras', 'With a deleted camera', {}, [cams[0], MISSING].filter(Boolean)),
      w('cameras', 'Live until tapped', { liveFor: 'tap' }, cams.slice(0, 2)),
      w('cameras', 'Live 30 s', { liveFor: '30' }, cams.slice(0, 1)),
      w('cameras', '12-hour times (a late snapshot shows its time) · 60 s', { refresh: '60', timeFormat: '12' }, cams.slice(0, 2)),
      w('cameras', '24-hour times · 60 s', { refresh: '60', timeFormat: '24' }, cams.slice(0, 2)),
      renaming('cameras', 'Rename tiles', {}, cams.slice(0, 2), cams[0] ? { [cams[0]]: 'Typed name' } : {}),
    ] };
  },

  async values() {
    const items = await autocomplete('values', 'slot1');
    const cap = c => i => i.id.endsWith(`:${c}`);
    const temps = pick(items, cap('measure_temperature'), 6);
    const batteries = pick(items, cap('measure_battery'), 6);
    const dims = pick(items, cap('dim'), 3);
    const thermo = where(d => d.class === 'thermostat' && has(d, 'target_temperature'), 1)[0];
    const mixed = [
      pick(items, cap('measure_power'))[0],
      pick(items, i => cap('onoff')(i) && devices.find(d => i.id.startsWith(d.id) && cls(d) === 'socket'))[0],
      pick(items, i => thermo && i.id.startsWith(`${thermo}:`) && !/:(measure|target|onoff|meter)_?/.test(i.id))[0],
      pick(items, cap('alarm_contact'))[0],
      pick(items, cap('locked'))[0],
      pick(items, cap('target_temperature'))[0],
    ];
    const missing = { id: `${MISSING}:measure_temperature`, name: 'Deleted device · Temperature' };
    // Second values: each tile's first other value of its device (humidity, battery …), from the widget's own autocomplete.
    const paired = [...temps.slice(0, 3), batteries[0], ...mixed.slice(0, 2)];
    const seconds = await Promise.all(paired.map(async item => (item
      ? (await autocomplete('values', 'second1', { slot1: item.id })).find(i => i.id !== 'none') ?? null
      : null)));
    const otherDevice = batteries.find(b => b && temps[0] && b.id.split(':')[0] !== temps[0].id.split(':')[0]);
    return { cols: 2, widgets: [
      w('values', 'Temperatures · 3 columns', slots('slot', temps)),
      w('values', 'Mixed types · 2 columns', { columns: '2', ...slots('slot', mixed) }),
      w('values', 'Batteries · fill (red < 30, yellow < 50)', { percentFill: true, redBelow: 30, yellowBelow: 50, ...slots('slot', batteries) }),
      w('values', 'Brightness (0–1 %) · fill', { percentFill: true, ...slots('slot', dims) }),
      w('values', 'Batteries · Vivid fill (red < 30, yellow < 50)', { colorStyle: 'deep', percentFill: true, redBelow: 30, yellowBelow: 50, ...slots('slot', batteries) }),
      w('values', 'Mixed types · pill', { tileStyle: 'pill', ...slots('slot', mixed) }),
      w('values', 'Batteries · pill · Vivid fill · 2 columns', { tileStyle: 'pill', columns: '2', colorStyle: 'deep', percentFill: true, redBelow: 30, yellowBelow: 50, ...slots('slot', batteries) }),
      w('values', 'Second values · 3 columns', { ...slots('slot', paired), ...slots('second', seconds) }),
      w('values', 'Second values · pill · 2 columns', { tileStyle: 'pill', columns: '2', ...slots('slot', paired), ...slots('second', seconds) }),
      w('values', 'Second values · Vivid fill', { colorStyle: 'deep', percentFill: true, ...slots('slot', paired), ...slots('second', seconds) }),
      // A second value left from another device (Tile 1 changed since): the tile shows only its value.
      w('values', 'Second value of another device: left out', { ...slots('slot', [temps[0]]), ...slots('second', [otherDevice]) }),
      w('values', 'Gaps and a deleted device', { ...slots('slot', [temps[0], null, missing, null, batteries[0]]) }),
      w('values', 'Nothing picked'),
      // The same value twice: the second tile's key is `#2`.
      renaming('values', 'Rename tiles · a value twice', slots('slot', [temps[0], temps[0], temps[1]]), [], temps[0] ? { [`${temps[0].id}#2`]: 'Typed name' } : {}),
    ] };
  },

  async lights() {
    const colour = where(d => cls(d) === 'light' && has(d, 'light_hue'));
    const dimOnly = where(d => cls(d) === 'light' && has(d, 'dim') && !has(d, 'light_hue'));
    const onoffOnly = where(d => ['light', 'socket'].includes(cls(d)) && has(d, 'onoff') && !has(d, 'dim'), 4);
    const all = where(d => cls(d) === 'light');
    // The lights in rooms with Homey Moods, for the `moods` palette (none without Moods).
    const moodZones = new Set(Object.values(await homeyApi('GET', '/api/manager/moods/mood').catch(() => ({}))).map(m => m.zone));
    const inMoodRooms = where(d => cls(d) === 'light' && moodZones.has(d.zone));
    return { cols: 3, widgets: [
      w('lights', 'Colour lights · defaults', {}, colour.slice(0, 6)),
      w('lights', 'Grouped by room', { groupByZone: true }, all.slice(0, 20)),
      w('lights', 'Three lights · last tile widened', { wideLast: true }, all.slice(0, 3)),
      w('lights', 'Warm palette · bar stops at 1 %', { palette: 'warm', barMin: '1' }, colour.slice(6, 10)),
      w('lights', 'Dusk palette', { palette: 'dusk' }, colour.slice(0, 4)),
      w('lights', "Room's Moods · a tile per light", { palette: 'moods' }, inMoodRooms.slice(0, 6)),
      w('lights', "Room's Moods · grouped by room, other rooms without", { palette: 'moods', groupByZone: true }, [...inMoodRooms, ...all.filter(id => !inMoodRooms.includes(id))].slice(0, 20)),
      w('lights', 'Dimmable, no colour', {}, dimOnly.slice(0, 6)),
      w('lights', 'On/off only · deleted device', {}, [...onoffOnly, MISSING]),
      w('lights', 'One light', {}, colour.slice(0, 1)),
      renaming('lights', 'Rename tiles · grouped by room', { groupByZone: true }, all.slice(0, 20), {
        [all[0]]: 'Typed name', [`zone:${devices.find(d => d.id === all[0])?.zone}`]: 'Typed group name',
      }),
    ] };
  },

  async lightrooms() {
    const all = where(d => cls(d) === 'light');
    const onoffOnly = where(d => ['light', 'socket'].includes(cls(d)) && has(d, 'onoff') && !has(d, 'dim'), 4);
    // The lights in rooms with Homey Moods first, so their Moods show (none without Moods).
    const moodZones = new Set(Object.values(await homeyApi('GET', '/api/manager/moods/mood').catch(() => ({}))).map(m => m.zone));
    const inMoodRooms = where(d => cls(d) === 'light' && moodZones.has(d.zone));
    const many = [...inMoodRooms, ...all.filter(id => !inMoodRooms.includes(id))].slice(0, 30);
    return { cols: 3, widgets: [
      w('lightrooms', 'Defaults · many rooms, Moods first', {}, many),
      w('lightrooms', 'Vivid · warm palette · bar stops at 1 %', { colorStyle: 'deep', palette: 'warm', barMin: '1' }, all.slice(0, 12)),
      w('lightrooms', 'Moods off · dusk palette', { showMoods: false, palette: 'dusk' }, inMoodRooms.slice(0, 8)),
      w('lightrooms', 'On/off only · deleted device', {}, [...onoffOnly, MISSING]),
      w('lightrooms', 'One light', {}, all.slice(0, 1)),
      w('lightrooms', 'Nothing picked'),
    ] };
  },

  async sparklines() {
    const items = await autocomplete('sparklines', 'slot1');
    const cap = c => i => i.id.endsWith(`:${c}`);
    const set = [pick(items, cap('measure_temperature'))[0], pick(items, cap('measure_power'))[0], ...pick(items, cap('measure_temperature'), 3).slice(1), pick(items, cap('measure_battery'))[0]];
    const out = ['1h', '6h', '24h', 'today', 'yesterday', '2d', '3d', '5d', '7d'].map(span =>
      w('sparklines', `${span}${span === '24h' ? ' (default)' : ''}`, { span, ...slots('slot', set.slice(0, 4)) }));
    out.push(
      w('sparklines', '1 column · 7 days · six', { span: '7d', columns: '1', ...slots('slot', set) }),
      w('sparklines', '1 h · 1 column · power', { span: '1h', columns: '1', ...slots('slot', set.slice(1, 2)) }),
      w('sparklines', 'Deleted device', { slot1: { id: `${MISSING}:measure_temperature`, name: 'Deleted device · Temperature' } }),
      renaming('sparklines', 'Rename tiles', slots('slot', set.slice(0, 2)), [], set[0] ? { [set[0].id]: 'Typed name' } : {}),
    );
    return { cols: 2, widgets: out };
  },

  async charts() {
    const items = await autocomplete('charts', 'chart1');
    const cap = c => i => i.id.endsWith(`:${c}`);
    const temp = pick(items, cap('measure_temperature'))[0];
    const power = pick(items, cap('measure_power'))[0];
    const other = pick(items, i => i !== temp && i !== power, 3);
    const missing = { id: `${MISSING}:measure_temperature`, name: 'Deleted device · Temperature' };
    return { cols: 3, widgets: [
      wide(w('charts', 'On one chart · 7 days · bars + line', { charts: 'overlay', chart1: power, span1: '7d', style1: 'bars', chart2: temp, style2: 'line', color2: 'orange' })),
      w('charts', 'One chart (defaults)', { chart1: temp }),
      w('charts', 'Two · chart 2: blue, own title, from zero, below zero yellow', { charts: '2', chart1: power, chart2: temp, color2: 'blue', title2: 'Typed title', range2: 'zero', negative2: true }),
      w('charts', 'Two · area + bars', { charts: '2', chart1: temp, chart2: power, style2: 'bars' }),
      w('charts', 'Two · line, smooth 6 h + bars 7 d', { charts: '2', chart1: power, span1: '6h', style1: 'line', smooth1: true, chart2: power, span2: '7d', style2: 'bars', color2: 'orange' }),
      w('charts', 'On one chart · area + line', { charts: 'overlay', chart1: temp, color1: 'purple', chart2: power, style2: 'line', smooth2: true, color2: 'orange' }),
      w('charts', 'On one chart · bars + bars, from zero', { charts: 'overlay', chart1: power, span1: '6h', style1: 'bars', range1: 'zero', chart2: other[0] || temp, style2: 'bars' }),
      w('charts', 'Start at zero · below zero yellow', { chart1: temp, range1: 'zero', negative1: true, color1: 'purple' }),
      w('charts', 'Two · today area + yesterday bars', { charts: '2', chart1: temp, span1: 'today', chart2: power, span2: 'yesterday', style2: 'bars', color2: 'green' }),
      w('charts', 'On one chart · yesterday', { charts: 'overlay', chart1: temp, span1: 'yesterday', color1: 'purple', chart2: power, style2: 'line', color2: 'orange' }),
      w('charts', '1 h · no header · own title', { chart1: power, span1: '1h', showHeader: false, title1: 'Power now' }),
      ...other.map((item, i) => w('charts', `Other value ${i + 1} · ${['2d', '3d', '5d'][i]}`, { chart1: item, span1: ['2d', '3d', '5d'][i], color1: ['red', 'yellow', 'green'][i] })),
      w('charts', 'Deleted device + empty', { charts: '2', chart1: missing }),
      w('charts', 'Nothing picked'),
    ] };
  },

  async variables() {
    const items = pick(await autocomplete('variables', 'slot1'), () => true, 10);
    const missing = { id: 'missing-variable-0000', name: 'Deleted variable' };
    return { cols: 2, widgets: [
      w('variables', 'Every variable · 1 column', slots('slot', items)),
      w('variables', '2 columns · step 0.5', { columns: '2', step: 0.5, ...slots('slot', items) }),
      renaming('variables', 'Rename tiles', slots('slot', items.slice(0, 3)), [], items[0] ? { [items[0].id]: 'Typed name' } : {}),
      w('variables', 'Step 0.05 · lowest 0 · highest 1', { step: 0.05, min: 0, max: 1, ...slots('slot', items) }),
      w('variables', 'Read only · 2 columns', { readOnly: true, columns: '2', ...slots('slot', items) }),
      w('variables', 'Step 10 · gaps · deleted', { step: 10, ...slots('slot', [items[0], null, missing, items[1]]) }),
      w('variables', 'Nothing picked'),
    ] };
  },

  async varpresets() {
    // A variable of each type (the items carry it), and the buttons' values from the widget's own value autocomplete,
    // typed as a user would: the first item is what's typed, or with nothing typed the current value. As on the
    // Variables dashboard, a tap sets the real variable.
    const vars = pick(await autocomplete('varpresets', 'variable'), () => true, 1000);
    const [bool, num, text] = ['boolean', 'number', 'string'].map(type => vars.find(v => v.type === type) ?? null);
    const value = async (variable, query = '') => pick(await autocomplete('varpresets', 'value1', { variable: variable.id }, query))[0] ?? null;
    const buttons = list => Object.fromEntries(list.flatMap(([item, label], i) => [[`value${i + 1}`, item], [`label${i + 1}`, label ?? '']]));
    const home = pick(await autocomplete('varpresets', 'icon', {}, 'home'), i => i.id === 'home')[0] ?? null;
    const missing = { id: 'missing-variable-0000', name: 'Deleted variable', type: 'string' };
    const out = [];
    if (bool) {
      const [yes, no] = pick(await autocomplete('varpresets', 'value1', { variable: bool.id }), () => true, 2);
      out.push(
        w('varpresets', 'Yes/No · no presets: Yes and No', { variable: bool }),
        w('varpresets', 'Yes/No · labels · green', { variable: bool, color: 'green', ...buttons([[yes, 'On'], [no, 'Off']]) }),
        w('varpresets', 'Yes/No · yellow (dark text when lit) · compact', { variable: bool, color: 'yellow', layout: 'compact', ...buttons([[yes], [no]]) }),
      );
    }
    if (num) {
      const current = (await value(num))?.value;
      const n = typeof current === 'number' ? current : 0;
      const steps = await Promise.all([n - 1, n, n + 1, n + 2].map(x => value(num, String(x))));
      out.push(
        w('varpresets', 'Number · 4 buttons · icon · compact', { variable: num, icon: home, layout: 'compact', ...buttons(steps.map(s => [s])) }),
        w('varpresets', 'Number · typed title · orange · labels', { variable: num, title: 'Typed title', color: 'orange', ...buttons([[steps[0], 'Lower'], [steps[1], 'Now'], [steps[2], 'Higher']]) }),
        w('varpresets', 'Number · none matches · red', { variable: num, color: 'red', ...buttons([[steps[2]], [steps[3]]]) }),
      );
    }
    if (text) {
      const current = await value(text);
      const [home2, away] = await Promise.all(['Home', 'Away'].map(q => value(text, q)));
      out.push(
        w('varpresets', 'Text · current value + 2 · purple · icon', { variable: text, color: 'purple', icon: home, ...buttons([[current], [home2], [away]]) }),
        w('varpresets', 'Text · long labels', { variable: text, ...buttons([[current, 'A label long enough for two lines'], [away, 'Out for the whole day']]) }),
      );
      if (num) out.push(w('varpresets', 'Presets of another type (text on a number)', { variable: num, ...buttons([[home2], [away]]) }));
    }
    out.push(
      w('varpresets', 'Deleted variable', { variable: missing, ...buttons([[{ id: 'string:"Home"', name: 'Home', value: 'Home', type: 'string' }]]) }),
      w('varpresets', 'Nothing picked'),
    );
    return { cols: 3, widgets: out };
  },

  async keypad() {
    // The state from a speaker's repeat mode, a list like an alarm's state that's harmless to change (never an alarm's
    // or a lock's: a tap sets it for real), a yes/no variable (a tap sets it, as on the Variables dashboard), and flows
    // that look harmless to start by hand. The codes are made on the app's side as on its settings page, once: Test 1234
    // and Test 123456, their digits in their names.
    const codes = `/api/app/${APP_ID}/keypad-codes`;
    const have = (await homeyApi('GET', codes)).codes.map(c => c.name);
    for (const digits of ['1234', '123456']) {
      if (!have.includes(`Test ${digits}`)) await homeyApi('POST', codes, { name: `Test ${digits}`, code: digits });
    }
    const codeItem = async name => pick(await autocomplete('keypad', 'code', {}, name), i => i.name === name)[0] ?? null;
    const [code, code6] = await Promise.all([codeItem('Test 1234'), codeItem('Test 123456')]);
    const anyCode = pick(await autocomplete('keypad', 'code', {}, ''), i => i.id === 'any')[0] ?? null;
    const sources = await autocomplete('keypad', 'state');
    const repeat = pick(sources, i => /:speaker_repeat$/.test(i.id))[0] ?? null;
    const yesNo = pick(sources, i => i.id.startsWith('var:') && i.type === 'boolean')[0] ?? null;
    const flows = pick(await autocomplete('keypad', 'flow1'), i => !RISKY_FLOW.test(`${i.name} ${i.description ?? ''}`), 2);
    const icon = id => ({ id, name: EN.flows.icons[id] ?? id });
    const values = async state => pick(await autocomplete('keypad', 'value1', { state: state.id }), () => true, 4);
    const out = [];
    if (repeat) {
      const [off, track, playlist] = await values(repeat);
      out.push(
        w('keypad', 'Repeat · no buttons set up: one per value, all behind 1234', { state: repeat, code }),
        w('keypad', 'Repeat · Off without the code · icons · colours', {
          state: repeat, code, value1: off, label1: 'Off', icon1: icon('power'), color1: 'grey', code1: false,
          value2: track, icon2: icon('music'), value3: playlist, icon3: icon('star'), color3: 'purple',
        }),
        w('keypad', 'Repeat · keypad always · Off without the code', {
          state: repeat, code, keypad: 'always', value1: off, label1: 'Off', icon1: icon('power'), color1: 'grey', code1: false,
          value2: track, icon2: icon('music'), value3: playlist, icon3: icon('star'), color3: 'purple',
        }),
        w('keypad', 'Repeat · keypad always · compact · one button behind 1234', {
          state: repeat, code, keypad: 'always', layout: 'compact', value1: off, icon1: icon('power'), color1: 'grey', code1: false,
          value2: track, icon2: icon('music'), color2: 'green',
        }),
        w('keypad', 'Repeat · Any code (1234 or 123456: OK) · a button only for the Flow card', {
          state: repeat, code: anyCode, value1: off, icon1: icon('power'), color1: 'grey', code1: false,
          value2: track, icon2: icon('music'), color2: 'green', label3: 'Only the Flow card', icon3: icon('star'), color3: 'purple',
        }),
        w('keypad', 'Repeat · compact · Vivid · 123456 · title', {
          state: repeat, code: code6, layout: 'compact', colorStyle: 'deep', title: 'Typed title',
          value1: off, icon1: icon('power'), color1: 'grey', code1: false, value2: track, icon2: icon('music'), color2: 'green', value3: playlist, icon3: icon('star'), color3: 'orange',
        }),
      );
    }
    if (yesNo) {
      const [yes, no] = await values(yesNo);
      out.push(
        w('keypad', 'Yes/No variable · Yes and No · no code set', { state: yesNo }),
        w('keypad', 'Yes/No variable · labels · Yes behind 1234 · red', { state: yesNo, code, value1: yes, label1: 'Allow', icon1: icon('tv'), color1: 'red', value2: no, label2: 'Stop', icon2: icon('power'), color2: 'grey', code2: false }),
      );
    }
    if (flows.length) {
      out.push(w('keypad', 'Flows · no state · the first behind 1234', {
        title: 'Flows', code, flow1: flows[0], icon1: icon('play'), color1: 'blue', ...(flows[1] ? { flow2: flows[1], color2: 'orange', code2: false } : {}),
      }));
    }
    out.push(
      w('keypad', 'Deleted device', {
        state: { id: `cap:${MISSING}:speaker_repeat`, name: 'Deleted device · Repeat' }, code,
        value1: { id: 'string:"none"', name: 'Off', value: 'none', type: 'string' },
      }),
      w('keypad', 'A code that was removed · keypad always', {
        title: 'Removed code', code: { id: 'removed-code-0000', name: 'Removed' }, keypad: 'always',
        ...(flows[0] ? { flow1: flows[0] } : {}),
      }),
      w('keypad', 'Nothing picked'),
    );
    return { cols: 3, widgets: out };
  },

  async flows() {
    // Only flows that look harmless to start by hand.
    const flows = pick(await autocomplete('flows', 'flow1'), i => !RISKY_FLOW.test(`${i.name} ${i.description ?? ''}`), 8);
    const icon = id => ({ id, name: EN.flows.icons[id] ?? id });
    const colours = ['blue', 'red', 'orange', 'yellow', 'green', 'purple', 'grey', 'blue'];
    const icons = ['sun', 'moon', 'music', 'bulb', 'bed', 'coffee', 'tv', 'sparkles'];
    const button = (n, flow, extra = {}) => ({ [`flow${n}`]: flow, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`${k}${n}`, v])) });
    const all = Object.assign({}, ...flows.map((f, i) => button(i + 1, f, { color: colours[i], icon: icon(icons[i]) })));
    return { cols: 2, widgets: [
      w('flows', '1 column · every colour', { ...all }),
      w('flows', '2 columns · every colour', { columns: '2', ...all }),
      w('flows', 'No icons (play) · renamed', { ...button(1, flows[0], { name: 'Renamed flow' }), ...button(2, flows[1]), ...button(3, flows[2], { color: 'grey' }) }),
      w('flows', 'Gap and a deleted flow', { ...button(1, flows[0], { icon: icon('heart') }), ...button(3, { id: 'flow:missing-flow-0000', name: 'Deleted flow' }) }),
      w('flows', 'Nothing picked'),
    ] };
  },

  async shortcuts() {
    // Its own test dashboard first (marked, as it's on it), then the other test dashboards: the user's own aren't linked.
    const self = { id: `${PREFIX}shortcuts`, name: testName('shortcuts') };
    const boards = pick(await autocomplete('shortcuts', 'dashboard1'), i => i.id.startsWith(PREFIX) && i.id !== self.id, 7);
    const icon = id => ({ id, name: EN.flows.icons[id] ?? id });
    const colours = ['blue', 'red', 'orange', 'yellow', 'green', 'purple', 'grey'];
    const icons = ['bulb', 'thermometer', 'lock', 'camera', 'music', 'home', 'sparkles'];
    const tile = (n, dashboard, extra = {}) => ({ [`dashboard${n}`]: dashboard, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`${k}${n}`, v])) });
    const all = Object.assign(tile(1, self), ...boards.map((d, i) => tile(i + 2, d, { color: colours[i], icon: icon(icons[i]) })));
    const other = boards[0] ?? self;
    return { cols: 2, widgets: [
      w('shortcuts', 'Defaults (2 columns) · this dashboard marked · every colour', all),
      w('shortcuts', '1 column', { columns: '1', ...all }),
      renaming('shortcuts', 'Rename tiles · one typed', { ...tile(1, self), ...tile(2, other) }, [], { [other.id]: 'Renamed dashboard' }),
      w('shortcuts', 'Gap and a deleted dashboard', { ...tile(1, other), ...tile(3, { id: 'missing-dashboard-0000', name: 'Deleted dashboard' }) }),
      w('shortcuts', 'Nothing picked'),
    ] };
  },

  price: () => ({ cols: 3, widgets: [
    w('price', 'Defaults (12 h)'),
    w('price', '24 h', { hours: '24' }),
    w('price', '36 h', { hours: '36' }),
    w('price', '12 h · not by level', { tint: false }),
    w('price', '24 h · spot prices', { hours: '24', priceCosts: false }),
    w('price', '36 h · spot · not by level', { hours: '36', priceCosts: false, tint: false }),
  ] }),

  timers: () => ({ cols: 4, widgets: [
    w('timers', 'Defaults (5/10/15/30)'),
    w('timers', 'Named · 30 s and 1 h 30', { minutes1: 0.5, label1: 'Egg', minutes2: 7, label2: 'Pasta', minutes3: 90, label3: 'Bread', minutes4: 12, label4: 'Pizza' }),
    w('timers', 'Two presets · silent', { minutes1: 3, minutes2: 45, minutes3: 0, minutes4: 0, sound: false }),
    w('timers', 'One preset', { minutes1: 25, label1: 'Focus', minutes2: 0, minutes3: 0, minutes4: 0 }),
  ] }),

  async locks() {
    const locks = where(d => has(d, 'locked'));
    const contacts = where(d => has(d, 'alarm_contact') && !has(d, 'locked'));
    const garages = where(d => has(d, 'garagedoor_closed'));
    // The capability that opens (unlatches) a lock, from the widget's own autocomplete: only when a lock has one.
    const [openCapability] = pick(await autocomplete('locks', 'openCapability'));
    return { cols: 3, widgets: [
      w('locks', 'Locks · summary', {}, locks),
      w('locks', 'Locks · list · unlock allowed', { view: 'list', allowUnlock: true }, locks),
      openCapability && w('locks', `Locks · list · Open with ${openCapability.id}`, { view: 'list', allowUnlock: true, openCapability }, locks),
      w('locks', 'Doors and windows · summary', {}, contacts),
      w('locks', 'Everything · list', { view: 'list' }, [...locks, ...garages, ...contacts]),
      w('locks', 'One lock · list', { view: 'list' }, locks.slice(0, 1)),
      w('locks', 'With a deleted device', {}, [...locks, MISSING]),
      w('locks', 'Everything · 12-hour times', { timeFormat: '12' }, [...locks, ...garages, ...contacts]),
      w('locks', 'Everything · list · 24-hour times', { view: 'list', timeFormat: '24' }, [...locks, ...garages, ...contacts]),
      renaming('locks', 'Rename tiles (the list shows)', {}, locks, locks[0] ? { [locks[0]]: 'Typed name' } : {}),
    ].filter(Boolean) };
  },

  async curtains() {
    const ids = where(d => ['windowcoverings_set', 'windowcoverings_state', 'windowcoverings_closed', 'windowcoverings_tilt_set'].some(c => has(d, c)));
    const note = ids.length ? '' : ' (no curtains on this Homey)';
    const set = ids.length ? ids : [MISSING];
    return { cols: 2, widgets: [
      w('curtains', `Defaults${note}`, {}, set),
      w('curtains', `Reverse of last move · inverted${note}`, { between: 'reverse', invert: true }, set),
      w('curtains', `No state line${note}`, { showState: false }, set),
      w('curtains', `Exact ends (0%)${note}`, { ends: '0' }, set),
      w('curtains', `Ends within 2%${note}`, { ends: '2' }, set),
      w('curtains', `Ends within 10%${note}`, { ends: '10' }, set),
      w('curtains', `Wide ends (15%)${note}`, { ends: '15' }, set),
      w('curtains', `Open at 100%, also tilt-only blinds${note}`, { openAt: 'end' }, set),
      w('curtains', `Open at 50% (vertical blinds)${note}`, { openAt: 'middle' }, set),
      w('curtains', `Grouped by room${note}`, { groupByZone: true }, set),
      w('curtains', 'A deleted device', {}, [MISSING]),
      renaming('curtains', `Rename tiles${note}`, {}, set, { [set[0]]: 'Typed name' }),
    ] };
  },

  async media() {
    const speakers = await autocomplete('media', 'device');
    if (!speakers.length) return { cols: 2, widgets: [w('media', 'No speakers on this Homey')] };
    // The first speaker with a TV source card.
    let tv;
    for (const device of speakers) {
      const buttons = pick(await autocomplete('media', 'button1', { device: device.id }), () => true, 100);
      tv ??= { device, buttons };
      if (buttons.some(b => /home_theater|tv_input/.test(b.id))) { tv = { device, buttons }; break; }
    }
    const sp = n => speakers[n % speakers.length];
    const card = re => tv.buttons.find(b => b.id.startsWith('card:') && re.test(b.id)) ?? null;
    const flow = tv.buttons.find(b => b.id.startsWith('flow:') && /sonos|music|noise/i.test(`${b.name} ${b.description}`)) ?? null;
    const icon = id => ({ id, name: EN.flows.icons[id] ?? id });
    const buttons = {
      button1: card(/home_theater|tv_input/), button1Icon: icon('tv'), button1Name: 'TV',
      button2: card(/line_in/) ?? card(/:play$/), button2Icon: icon('speaker'),
      button3: flow, button3Icon: icon('music'),
    };
    // Four, each named, the last without an icon.
    const four = { ...buttons, button2Name: 'Line-in', button3Name: 'Music flow', button4: card(/:pause$|:stop$/) ?? card(/./), button4Name: 'Typed name' };
    // Eight: the four, then harmless flows (a tap starts them), with and without icons.
    const more = pick(tv.buttons, b => b.id.startsWith('flow:') && b.id !== flow?.id && !RISKY_FLOW.test(`${b.name} ${b.description ?? ''}`), 4);
    const eight = { ...four };
    more.forEach((b, i) => {
      eight[`button${i + 5}`] = b;
      if (i % 2 === 0) eight[`button${i + 5}Icon`] = icon(i ? 'sun' : 'moon');
    });
    return { cols: 3, widgets: [
      w('media', 'Defaults', { device: sp(0) }),
      w('media', 'Volume buttons · step 10 · max 40 %', { device: sp(1), volumeLayout: 'buttons', volumeStep: '10', maxVolume: 40 }),
      w('media', 'No progress · shuffle · no switching', { device: sp(2), showProgress: false, showShuffle: true, switchSpeakers: false }),
      w('media', 'Buttons (TV, card, flow)', { device: tv.device, ...buttons }),
      w('media', 'Volume buttons · shuffle in overlay · buttons', { device: tv.device, volumeLayout: 'buttons', showShuffle: true, ...buttons }),
      w('media', 'Step 2 · no progress · volume buttons', { device: sp(3), volumeStep: '2', showProgress: false, volumeLayout: 'buttons' }),
      w('media', 'Large', { device: sp(0), layout: 'large' }),
      w('media', 'Large · volume buttons · shuffle · buttons', { device: tv.device, layout: 'large', volumeLayout: 'buttons', showShuffle: true, ...buttons }),
      w('media', 'Four named buttons (the last without an icon)', { device: tv.device, ...four }),
      w('media', 'Eight buttons · volume buttons · shuffle', { device: tv.device, volumeLayout: 'buttons', showShuffle: true, ...eight }),
      w('media', 'Large · tapping the art doesn\'t switch layout', { device: sp(1), layout: 'large', layoutTap: false }),
      w('media', 'Nothing picked'),
    ] };
  },

  clock: () => ({ cols: 4, widgets: [
    w('clock', 'Defaults (weather)'),
    w('clock', 'No weather', { showWeather: false }),
    w('clock', ''), // no title
    w('clock', '24-hour', { timeFormat: '24' }),
    w('clock', '12-hour', { timeFormat: '12' }),
  ] }),

  // Web Page: a 550 × 512 map gadget at the Homey's location, a page that may be tapped, and
  // the messages. No page here starts anything: a tap at most follows a link inside the frame.
  webpage: () => {
    const gadget = zoom => `https://gadgets.buienradar.nl/gadget/zoommap/?lat={lat}&lng={lon}&overname=2&zoom=${zoom}&naam=Home&size=3&voor=1`;
    const size = { pageWidth: 550, pageHeight: 512 };
    return { cols: 3, widgets: [
      wide(w('webpage', 'Map gadget · 550 × 512', { url: gadget(8), ...size })),
      w('webpage', 'Defaults (no address)'),
      w('webpage', 'Map gadget · 550 × 512 · four zoom buttons', {
        url: gadget(8), ...size, refresh: 15,
        b1Name: 'Country', b1Url: gadget(6), b2Name: 'Province', b2Url: gadget(8), b3Name: 'Region', b3Url: gadget(11), b4Name: 'City', b4Url: gadget(13),
      }),
      w('webpage', 'Map gadget · unscaled (page width 0)', { url: gadget(8), pageHeight: 512 }),
      w('webpage', 'example.com · may be tapped', { url: 'https://example.com', pageHeight: 240, interactive: true }),
      w('webpage', 'javascript: address (refused)', { url: 'javascript:alert(1)' }),
    ] };
  },

  // Notes: typed messages, `Test …` notes only a Flow card writes to (until one does, they show the typed message),
  // and variables. The `Note` one shows whatever a Flow last wrote.
  async textline() {
    const vars = pick(await autocomplete('textline', 'variable'), i => i.id !== 'none', 1);
    const missing = { id: 'missing-variable-0000', name: 'Deleted variable' };
    const icon = id => ({ id, name: EN.flows.icons[id] ?? id });
    const long = 'A long typed message that does not fit on one line of the tile, so it has to be cut off or scroll';
    return { cols: 3, widgets: [
      w('textline', 'Defaults (nothing typed)'),
      w('textline', 'Typed · icon · blue', { message: 'Back at 5', icon: icon('bell'), color: 'blue' }),
      w('textline', 'Typed · yellow tile', { message: 'Bins out tonight', icon: icon('home'), color: 'yellow' }),
      w('textline', 'Typed long · cut off · large · centred', { message: long, size: 'large', align: 'center' }),
      w('textline', 'Typed long · scroll · small', { message: long, overflow: 'scroll', size: 'small', icon: icon('home') }),
      w('textline', 'Typed long · more lines · icon', { message: `${long}\nA second line typed`, overflow: 'wrap', icon: icon('home') }),
      w('textline', 'Typed · more lines · large · centred · green', { message: 'Back at 5\nFeed the cat', overflow: 'wrap', size: 'large', align: 'center', color: 'green' }),
      ...['default', 'orange', 'red', 'purple', 'blue', 'green'].map(color =>
        w('textline', `Post-it · ${color}`, { style: 'postit', message: 'Buy milk,\neggs and rye bread', color })),
      w('textline', 'Post-it · long · right', { style: 'postit', message: long, align: 'right' }),
      w('textline', 'Flow · note Note', { source: 'flow' }),
      w('textline', 'Flow · Test note · typed fallback', { source: 'flow', board: 'Test note', message: 'Nothing written yet' }),
      w('textline', vars.length ? `Variable · ${vars[0].name}` : 'Variable (none on this Homey)', { source: 'variable', variable: vars[0] ?? null }),
      w('textline', 'Variable · deleted', { source: 'variable', variable: missing }),
      w('textline', 'Variable · nothing picked', { source: 'variable' }),
    ] };
  },

  // Days Since: `Test · …` counters, which the app keeps (shared by name: a tap on one widget shows on the others with
  // that counter). They start as Not started; tap them, or back-date them with the Flow card *Set … to … days ago*.
  dayssince: () => {
    const icon = id => ({ id, name: EN.flows.icons[id] ?? id });
    const counter = (n, name, iconId, amber, red) => ({
      [`counter${n}`]: { id: `Test · ${name}`, name: `Test · ${name}` },
      ...(iconId ? { [`icon${n}`]: icon(iconId) } : {}), [`amber${n}`]: amber, [`red${n}`]: red,
    });
    const household = { ...counter(1, 'Plants', 'leaf', 5, 7), ...counter(2, 'Vacuum filter', 'vacuum', 75, 90),
      ...counter(3, 'Bedsheets', 'bed', 12, 14), ...counter(4, 'Fish', 'paw', 2, 3) };
    const eight = ['Towels', 'Fridge', 'Gutters', 'Descale', 'Smoke alarm', 'Oven', 'Car wash', 'Haircut']
      .reduce((s, name, i) => ({ ...s, ...counter(i + 1, name, ['washer', 'snowflake', 'home', 'coffee', 'bell', 'flame', 'car', 'star'][i], 0, 0) }), {});
    return { cols: 3, widgets: [
      w('dayssince', 'Defaults · one counter (Plants)', counter(1, 'Plants', 'leaf', 5, 7)),
      w('dayssince', 'Household · amber and red', household),
      w('dayssince', 'Days only · the same counters', { units: 'days', ...household }),
      w('dayssince', 'Only amber and red · the same counters', { show: 'due', ...household }),
      w('dayssince', 'Only red · the same counters', { show: 'overdue', ...household }),
      w('dayssince', 'Eight · no colours (0 and 0)', eight),
      w('dayssince', 'No icons · Plants red after 2 days (the app takes the last loaded)', {
        ...counter(1, 'Plants', null, 1, 2), icon1: { id: 'none', name: 'None' }, ...counter(2, 'Fish', null, 2, 3), icon2: { id: 'none', name: 'None' } }),
      w('dayssince', 'Nothing picked'),
    ] };
  },

  // Four columns: a clock, a spacer of the height in its title, another clock, so the second row shows the gap Homey
  // adds and how far each spacer moves it down.
  spacer: () => {
    const heights = [32, 16, 48, 76]; // the default, the least (0 showed the iOS app's loading placeholder), more, a clock's height
    const clock = title => w('clock', title, { showWeather: false });
    return { cols: 4, widgets: [
      ...heights.map(h => clock(`${h} px below${h === 32 ? ' (default)' : ''}`)),
      ...heights.map(h => w('spacer', '', h === 32 ? {} : { height: h })),
      ...heights.map(() => clock('')),
    ] };
  },

  async stack() {
    // Not its own test dashboard (with --native): a stack inside a stack shows nothing.
    const boards = pick(await autocomplete('stack', 'dashboard'), i => !/^0 /.test(i.description ?? '') && i.name !== testName('stack'), 3);
    if (!boards.length) return { cols: 2, widgets: [w('stack', 'No Homey dashboard with our widgets, or no API key')] };
    const b = n => boards[n % boards.length];
    return { cols: 2, widgets: [
      w('stack', `${b(0).name} · defaults`, { dashboard: b(0) }),
      w('stack', `${b(1).name} · 10 s · large dots above`, { dashboard: b(1), interval: '10', dotsPosition: 'above', dotsSize: 'large' }),
      w('stack', `${b(2).name} · never rotates · no smart · no dots`, { dashboard: b(2), interval: 'never', smart: false, showDots: false }),
      w('stack', `${b(0).name} · 15 s · resumes after 30 s · small above`, { dashboard: b(0), interval: '15', resumeAfter: '30', dotsPosition: 'above' }),
      w('stack', `${b(1).name} · 1 min · resumes after 2 min`, { dashboard: b(1), interval: '60', resumeAfter: '120' }),
      w('stack', `${b(2).name} · 5 min · resumes after 5 min · large dots`, { dashboard: b(2), interval: '300', resumeAfter: '300', dotsSize: 'large' }),
      w('stack', 'Nothing picked'),
    ] };
  },

  // A Popups widget is a quiet row, so a clock above and below shows where it is. Send a popup to the screen name
  // "Test" (or "Screen") from a Flow: it opens in the phone app's browser (--native) or over the web dashboard.
  popups: () => ({ cols: 2, widgets: [
    w('clock', 'Above: a Popups widget named Test', { showWeather: false }),
    w('clock', 'Above: a Popups widget with the default name', { showWeather: false }),
    w('popups', '', { name: 'Test' }),
    w('popups', ''),
    w('clock', 'Below it', { showWeather: false }),
    w('clock', 'Below it', { showWeather: false }),
  ] }),
};

// ---------------------------------------------------------------- write

if (opts.apps && (opts.native || positionals.length)) throw new Error('--apps builds a web dashboard of its own: no --native or widget types with it');
/** Widgets Homey's own dashboards don't offer (deprecated there): left out with --native. */
const WEB_ONLY = Object.keys(widgetDefs).filter(t => widgetDefs[t].deprecated === true);
if (opts.native && positionals.some(t => WEB_ONLY.includes(t))) throw new Error(`Web dashboards only: ${positionals.filter(t => WEB_ONLY.includes(t)).join(', ')}`);
const types = (opts.apps ? [] : positionals.length ? positionals : Object.keys(widgetDefs)).filter(t => !opts.native || !WEB_ONLY.includes(t));
for (const t of types) if (!BUILD[t]) throw new Error(`Unknown widget type: ${t} (known: ${Object.keys(BUILD).join(', ')})`);
const missingBuilders = Object.keys(widgetDefs).filter(t => !BUILD[t]);
if (missingBuilders.length) console.warn(`No test dashboard for: ${missingBuilders.join(', ')}`);
/** Whether a type's test dashboard is rebuilt or removed this run. */
const replacing = type => types.includes(type) || (opts.remove && !positionals.length);

function testName(type) {
  return `${NATIVE_PREFIX}${widgetDefs[type]?.name?.en ?? type}`;
}

// ---------------------------------------------------------------- other apps' widgets

/** Preferred autocomplete items, by setting id (a widget's own): DataVista's line chart gets temperature and humidity. */
const APP_PICKS = {
  datasource1: i => /:measure_temperature$/.test(i.id),
  datasource2: i => /:measure_humidity$/.test(i.id),
};

/** Another app's autocomplete items (Homey's `homey:app:<appId>:<widgetId>` id), as the page asks for them. */
async function appAutocomplete(id, settingId) {
  const items = await homeyApi('GET', `/api/manager/dashboards/appwidget/${encodeURIComponent(id)}/autocomplete?${new URLSearchParams({ settingId, query: '' })}`);
  return (Array.isArray(items) ? items : []).map(({ image, ...item }) => item);
}

/** `Test · Other apps`: every widget of the apps `--apps` names, a column per app, in the order given. */
async function buildApps() {
  const all = Object.values(await homeyApi('GET', '/api/manager/dashboards/appwidget') ?? {})
    .filter(x => !x.deprecated && !x.id.startsWith(`homey:app:${APP_ID}:`));
  const appOf = x => x.id.split(':')[2];
  const names = opts.apps.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
  const apps = names.map(n => {
    const found = all.filter(x => x.ownerName?.toLowerCase() === n || appOf(x).toLowerCase() === n);
    if (!found.length) throw new Error(`No widgets from an app called ${n} (apps with widgets: ${[...new Set(all.map(x => x.ownerName))].join(', ')})`);
    return found;
  });
  const placed = [];
  for (const [col, widgets] of apps.entries()) {
    for (const def of widgets) {
      const settings = Object.fromEntries((def.settings ?? []).filter(s => s.value !== undefined).map(s => [s.id, s.value]));
      const autos = (def.settings ?? []).filter(s => s.type === 'autocomplete');
      const filled = [];
      for (const s of autos.filter((s, i) => i === 0 || APP_PICKS[s.id])) {
        const items = await appAutocomplete(def.id, s.id);
        const item = (APP_PICKS[s.id] && items.find(APP_PICKS[s.id])) ?? (i => i && (items.find(x => x.type === 'variable') ?? i))(items[0]);
        if (item) { settings[s.id] = item; filled.push(item.name); }
      }
      // Widgey's WiFi QR code is empty without a network: a made-up one.
      if (def.settings?.some(s => s.id === 'ssid')) Object.assign(settings, { ssid: 'Test network', password: 'not-a-real-password' });
      const title = `${def.ownerName} · ${def.name}${filled.length ? ` · ${filled.join(', ')}` : autos.length ? ' · nothing to pick' : ''}`;
      placed.push({ id: `apps-${placed.length + 1}`, col, type: def.id, title: title.slice(0, 60), settings, deviceIds: [] });
      console.log(`  ${def.id}${filled.length ? ` (${filled.join(', ')})` : ''}`);
    }
  }
  return { type: 'apps', name: 'Test · Other apps', cols: apps.length, placed };
}

/** Every listed type's test dashboard: the builder's widgets and their Vivid copies, numbered (`id`). */
async function buildAll() {
  const out = [];
  for (const type of types) {
    const { cols, widgets } = await BUILD[type]();
    widgets.push(...deepVariants(type, widgets));
    out.push({ type, name: testName(type), cols, placed: widgets.map((x, i) => ({ id: `${type.slice(0, 20)}-${i + 1}`, ...x })) });
  }
  return out;
}

/** The typed names of the test widgets `dropped()` names are replaced by `typed` (instance → tile key → name); the user's own are kept. */
async function writeTileNames(dropped, typed) {
  const saved = await homeyApi('GET', TILE_NAMES);
  const names = Object.fromEntries(Object.entries(saved && typeof saved === 'object' ? saved : {})
    .filter(([instance]) => !dropped(instance)));
  for (const [instance, map] of Object.entries(typed)) {
    if (Object.keys(map).length) names[instance] = { names: map, updatedAt: Date.now() };
  }
  await homeyApi('PUT', TILE_NAMES, { value: names });
}

async function writeWeb(built) {
  const saved = await homeyApi('GET', SETTING);
  const current = Array.isArray(saved) ? saved : [];
  const replace = new Set([
    ...current.filter(d => d.id.startsWith(PREFIX) && replacing(d.id.slice(PREFIX.length))).map(d => d.id),
    ...built.map(b => PREFIX + b.type),
  ]);
  const typed = {};
  const dashboards = built.map(({ type, name, cols, placed }) => {
    for (const { id, tileNames } of placed) if (tileNames) typed[`web-${PREFIX}${type}-${id}`] = tileNames;
    console.log(`${name}: ${placed.length} widgets`);
    const widgets = placed.map(({ tileNames, col, ...x }) => x);
    // Other apps' widgets come with their column; the rest are spread across.
    const laid = placed.some(x => x.col !== undefined)
      ? Array.from({ length: cols }, (_, i) => widgets.filter((x, j) => placed[j].col === i))
      : columns(widgets, cols);
    return { id: PREFIX + type, name, theme: 'auto', columns: laid, section: SECTION.id };
  });
  // The user's dashboards first, as they were; then the test ones in the manifest's order.
  const order = [...Object.keys(widgetDefs), 'apps'].map(t => PREFIX + t);
  const tests = [...current.filter(d => d.id.startsWith(PREFIX) && !replace.has(d.id)), ...dashboards]
    .map(d => ({ ...d, section: SECTION.id }))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const next = [...current.filter(d => !d.id.startsWith(PREFIX)), ...tests];
  if (next.length > MAX_WEB_DASHBOARDS) throw new Error(`That would make ${next.length} web dashboards; at most ${MAX_WEB_DASHBOARDS}`);
  // The section first, so the app never reads a test dashboard in one it doesn't know (it'd show under Your dashboards).
  const front = await homeyApi('GET', WEB_FRONT_SETTING);
  // Where it is when it's there already (the user may have moved or renamed it), else last.
  const sections = front && Array.isArray(front.sections) ? front.sections : [];
  const has = sections.some(x => x && x.id === SECTION.id);
  const kept = !tests.length ? sections.filter(x => !x || x.id !== SECTION.id) : has ? sections : [...sections, SECTION];
  await homeyApi('PUT', WEB_FRONT_SETTING, { value: { ...(front && typeof front === 'object' ? front : {}), sections: kept } });
  await homeyApi('PUT', SETTING, { value: next });
  await writeTileNames(instance => [...replace].some(id => instance.startsWith(`web-${id}-`)), typed);
  console.log(`${opts.remove ? 'Removed' : 'Saved'}; ${next.length} web dashboards on the Homey now.`);
}

/** A UUID (version 8, which the dashboards' id pattern allows) that's the same for the same key on every run. */
function stableUuid(key) {
  const h = createHash('sha256').update(`${APP_ID}:${key}`).digest('hex');
  const variant = (8 + (parseInt(h[16], 16) & 3)).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * A widget as a Homey dashboard keeps it: the manifest's defaults under the builder's settings (only the manifest's
 * ids, as the web dashboards' `normalize()` keeps them), one device for a singular devices setting.
 */
function nativeWidget(uuid, { type, title, settings, deviceIds }) {
  const def = widgetDefs[type];
  const ids = (def.settings || []).map(s => s.id);
  const defaults = Object.fromEntries((def.settings || []).filter(s => s.value !== undefined).map(s => [s.id, s.value]));
  const own = Object.fromEntries(Object.entries(settings).filter(([k]) => ids.includes(k)));
  return {
    id: uuid, title, titleHidden: !title, titleModified: true, type: 'app_webview',
    data: {
      appWidgetId: `homey:app:${APP_ID}:${type}`,
      settings: { ...defaults, ...own },
      deviceIds: def.devices?.singular ? deviceIds.slice(0, 1) : deviceIds,
    },
  };
}

async function writeNative(built) {
  const all = Object.values(await homeyApi('GET', DASHBOARDS) ?? {});
  const typeOf = new Map(Object.keys(widgetDefs).map(t => [testName(t), t]));
  // Without widget types named, every `Test · …` dashboard goes or is replaced, also one of a type no longer built.
  const old = all.filter(d => typeOf.has(d.name)
    ? replacing(typeOf.get(d.name))
    : !positionals.length && String(d.name ?? '').startsWith(NATIVE_PREFIX));
  const dropped = new Set(old.flatMap(d => (d.columns ?? []).flatMap(c => (c.widgets ?? []).map(x => x.id))));
  const typed = {};
  let count = all.length;
  for (const { type, name, cols, placed } of built) {
    const widgets = placed.map(({ id, tileNames, ...x }) => {
      const uuid = stableUuid(`${PREFIX}${type}-${id}`);
      if (tileNames) typed[uuid] = tileNames;
      dropped.add(uuid);
      return nativeWidget(uuid, x);
    });
    const body = { name, columns: columns(widgets, cols).map((list, i) => ({ id: stableUuid(`${PREFIX}${type}-col${i + 1}`), widgets: list })) };
    // Updated in place (its id, its place in the Homey app, a Smart Stack pointing at it); a second one by that name goes.
    const [existing, ...extra] = old.filter(d => d.name === name);
    if (existing) await homeyApi('PUT', `${DASHBOARDS}${existing.id}`, body);
    else { await homeyApi('POST', DASHBOARDS, body); count++; }
    for (const d of extra) { await homeyApi('DELETE', `${DASHBOARDS}${d.id}`); count--; }
    console.log(`${name}: ${widgets.length} widgets (${existing ? 'updated' : 'created'})`);
  }
  for (const d of old) {
    if (built.some(b => b.name === d.name)) continue;
    await homeyApi('DELETE', `${DASHBOARDS}${d.id}`);
    console.log(`${d.name}: removed`);
    count--;
  }
  await writeTileNames(instance => dropped.has(instance), typed);
  console.log(`${opts.remove ? 'Removed' : 'Saved'}; ${count} Homey dashboards now.`);
}

const built = opts.remove ? [] : opts.apps ? [await buildApps()] : await buildAll();
await (opts.native ? writeNative(built) : writeWeb(built));
await close();
