// Builds one web dashboard per widget type on the active Homey (the one `npx homey select` picked), each with the
// widget in its different configurations, for testing: `Test · <widget>`, id `test-<widget>`. Re-running replaces
// those and keeps every other web dashboard. Devices, flows, variables and the rest are picked on the Homey by their
// capabilities and classes, never by name, so nothing about the house is in here.
//
//   npm run test-dashboards                 every widget type
//   npm run test-dashboards -- lights media only those
//   npm run test-dashboards -- --remove     removes the test dashboards
//
// It writes the app setting `webDashboards` through the Homey CLI's login (the web dashboards' own API wants the
// password's session too), so the app's `normalize()` checks it on the next read, as for any saved dashboard.
// The "Rename tiles" widgets get a name already typed on a tile, in the app setting `tileNames`.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const APP_ID = JSON.parse(readFileSync(new URL('../.homeycompose/app.json', import.meta.url), 'utf8')).id;
const EN = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));
const SETTING = `/api/manager/apps/app/${APP_ID}/setting/webDashboards`;
/** The typed tile names (lib/TileNameService.ts), by widget instance: a web dashboard widget's is `web-<dashboard>-<widget>`. */
const TILE_NAMES = `/api/manager/apps/app/${APP_ID}/setting/tileNames`;
const PREFIX = 'test-';
const MISSING = 'missing-device-0000'; // a device id that doesn't exist: the widgets' missing state

const { values: opts, positionals } = parseArgs({ options: { remove: { type: 'boolean' } }, allowPositionals: true });

// One login through the Homey CLI's own code, reused for every request: `homey api raw` logs in anew each time, and
// Homey answers a burst of logins with `Too many requests` for minutes.
const { createHomeyApiClient, disposeHomeyApiClient } = await import(pathToFileURL(require.resolve('homey/lib/api/ApiCommandRuntime.mjs')).href);
const client = await login();

/**
 * The CLI's login (through Athom's cloud); while that says `Too many requests`, tries again every 10 minutes, for an
 * hour. `HOMEY_TOKEN` (a personal API key) and `HOMEY_ADDRESS` (`http://<the Homey's IP>`) skip the cloud.
 */
async function login(tries = 7) {
  const { HOMEY_TOKEN: token, HOMEY_ADDRESS: address } = process.env;
  if (token && address) return createHomeyApiClient({ token, address });
  try {
    return await createHomeyApiClient({});
  } catch (err) {
    if (tries <= 1 || err?.statusCode !== 429) throw err;
    console.log('The Athom cloud is rate limiting the login; trying again in 10 minutes.');
    await new Promise(resolve => setTimeout(resolve, 600000));
    return login(tries - 1);
  }
}

/** A request to the Homey's web API, as the CLI's logged-in user. */
async function homeyApi(method, path, body) {
  return client.call({ method, path, ...(body === undefined ? {} : { body }) });
}

/** A widget's autocomplete items, as Homey's widget settings ask for them (`settings` as `{key: id}`). */
async function autocomplete(widget, settingId, settings = {}, query = '') {
  const p = new URLSearchParams({ settingId, query });
  for (const [k, id] of Object.entries(settings)) p.set(`settings[${k}][id]`, id);
  const items = await homeyApi('GET', `/api/manager/dashboards/appwidget/${encodeURIComponent(`homey:app:${APP_ID}:${widget}`)}/autocomplete?${p}`);
  return (Array.isArray(items) ? items : []).map(({ image, ...item }) => item);
}

// ---------------------------------------------------------------- the Homey's things

const widgetDefs = Object.fromEntries(readdirSync(new URL('../widgets/', import.meta.url))
  .filter(id => existsSync(new URL(`../widgets/${id}/widget.compose.json`, import.meta.url)))
  .map(id => [id, JSON.parse(readFileSync(new URL(`../widgets/${id}/widget.compose.json`, import.meta.url), 'utf8'))]));

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

/** The first n autocomplete items that pass, `None` and the like left out. */
const pick = (items, fn = () => true, n = 1) => items.filter(i => i.id !== 'none' && fn(i)).slice(0, n);

/** `{slot1: …, slot2: …}` from a list of items (null where a slot stays empty). */
const slots = (prefix, items) => Object.fromEntries(items.map((item, i) => [`${prefix}${i + 1}`, item ?? null]));

// ---------------------------------------------------------------- one builder per widget type

const BUILD = {
  async electricity() {
    const meter = where(d => has(d, 'measure_power') && d.class === 'sensor', 1).concat(where(d => has(d, 'measure_power'), 1))[0];
    const m = meter ? [meter] : [];
    return { cols: 3, widgets: [
      w('electricity', 'Defaults', {}, m),
      w('electricity', 'Compact', { layout: 'compact' }, m),
      w('electricity', '60 min · smooth · separate usage · purple', { liveWindow: '60', smooth: true, separateUsage: true, usageColor: 'purple' }, m),
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
    const named = counted.slice(0, 4);
    const nameOf = id => devices.find(d => d.id === id)?.name ?? '';
    return { cols: 3, widgets: [
      w('sensoralarms', 'Defaults · alarm sensors', {}, counted),
      w('sensoralarms', 'Motion and contact counted', { includeStates: true }, [...states, ...counted.slice(0, 2)]),
      w('sensoralarms', 'Motion and contact not counted', {}, states),
      w('sensoralarms', 'Renamed: Device = Tile', { names: named.map((id, i) => `${nameOf(id)} = Sensor ${i + 1}`).join('\n') }, named),
      w('sensoralarms', 'Renamed by position, one kept', { names: 'First tile\n\nThird tile' }, named.slice(0, 3)),
      w('sensoralarms', 'No alarms · deleted device', {}, [...none, MISSING]),
      renaming('sensoralarms', 'Rename tiles · over the names setting', { names: 'First tile' }, named.slice(0, 2), { [named[0]]: 'Typed name' }),
    ] };
  },

  async sensordots() {
    const motion = where(d => (has(d, 'alarm_motion') || has(d, 'alarm_presence')) && cls(d) !== 'camera');
    const contact = where(d => has(d, 'alarm_contact'));
    const cams = where(d => cls(d) === 'camera');
    return { cols: 2, widgets: [
      w('sensordots', 'Defaults · everything', {}, [...contact, ...motion, ...cams]),
      w('sensordots', 'Title · green idle, red active', { title: 'Doors and motion', idleColor: 'green', activeColor: 'red' }, [...contact.slice(0, 5), ...motion.slice(0, 3)]),
      w('sensordots', 'Doors only · blue idle, orange active', { title: 'Doors', idleColor: 'blue', activeColor: 'orange' }, contact),
      w('sensordots', 'Cameras · purple/yellow', { idleColor: 'purple', activeColor: 'yellow' }, cams),
      w('sensordots', 'One dot', {}, motion.slice(0, 1)),
      w('sensordots', 'Grey active · with a deleted device', { title: 'Odd ones', idleColor: 'grey', activeColor: 'grey' }, [...motion.slice(0, 2), MISSING]),
    ] };
  },

  weather: () => ({ cols: 3, widgets: [
    w('weather', 'Defaults (compact, 1 row, 1 h)'),
    w('weather', 'Detailed', { density: 'detailed' }),
    w('weather', 'Compact · 2 rows', { rows: '2' }),
    w('weather', 'Detailed · 2 rows · 3 h', { density: 'detailed', rows: '2', step: '3' }),
    w('weather', 'Compact · 2 h · vivid', { step: '2', theme: 'vivid' }),
    w('weather', 'Detailed · temperature', { density: 'detailed', theme: 'temperature' }),
    w('weather', 'Compact · sky', { theme: 'sky' }),
    w('weather', 'Detailed · sky · 2 h', { density: 'detailed', theme: 'sky', step: '2' }),
    w('weather', 'Card · 2 rows', { theme: 'card', rows: '2' }),
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
      temp && w('heatmap', 'Temperature · defaults (week, 2 h, blue)', temp),
      temp2 && w('heatmap', 'Temperature · 3 days · 1 h · red', { ...temp2, period: '3', step: '1', color: 'red' }),
      power && w('heatmap', 'Power · 7 days · 3 h · yellow', { ...power, period: 'rolling', step: '3', color: 'yellow' }),
      power && w('heatmap', 'Power · 14 days · 1 h · purple', { ...power, period: '14', step: '1', color: 'purple' }),
      motion && w('heatmap', 'Motion (boolean) · week · orange', { ...motion, color: 'orange' }),
      contact && w('heatmap', 'Contact (boolean) · 10 days · green · no scale', { ...contact, period: '10', color: 'green', showScale: false }),
      temp && w('heatmap', 'No scale, no legend', { ...temp, showScale: false, showLegend: false }),
      w('heatmap', 'Nothing picked'),
    ].filter(Boolean);
    return { cols: 3, widgets: out };
  },

  async cameras() {
    const cams = where(d => ['camera', 'doorbell'].includes(cls(d)));
    return { cols: 2, widgets: [
      w('cameras', 'One · 5 s', { refresh: '5' }, cams.slice(0, 1)),
      w('cameras', 'Two · defaults (10 s)', {}, cams.slice(1, 3)),
      w('cameras', 'Three (odd last) · 30 s', { refresh: '30' }, cams.slice(0, 3)),
      w('cameras', 'All · 60 s', { refresh: '60' }, cams),
      w('cameras', 'With a deleted camera', {}, [cams[0], MISSING].filter(Boolean)),
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
    return { cols: 2, widgets: [
      w('values', 'Temperatures · 3 columns', slots('slot', temps)),
      w('values', 'Mixed types · 2 columns · renamed', { columns: '2', ...slots('slot', mixed), name1: 'Power', name3: 'Mode' }),
      w('values', 'Batteries · fill (red < 30, yellow < 50)', { percentFill: true, redBelow: 30, yellowBelow: 50, ...slots('slot', batteries) }),
      w('values', 'Brightness (0–1 %) · fill', { percentFill: true, ...slots('slot', dims) }),
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

  async sparklines() {
    const items = await autocomplete('sparklines', 'slot1');
    const cap = c => i => i.id.endsWith(`:${c}`);
    const set = [pick(items, cap('measure_temperature'))[0], pick(items, cap('measure_power'))[0], ...pick(items, cap('measure_temperature'), 3).slice(1), pick(items, cap('measure_battery'))[0]];
    const out = ['1h', '6h', '24h', '2d', '3d', '5d', '7d'].map(span =>
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
      w('charts', 'One chart (defaults)', { chart1: temp }),
      w('charts', 'Two · area + bars', { charts: '2', chart1: temp, chart2: power, style2: 'bars' }),
      w('charts', 'Two · line, smooth 6 h + bars 7 d', { charts: '2', chart1: power, span1: '6h', style1: 'line', smooth1: true, chart2: power, span2: '7d', style2: 'bars', color2: 'orange' }),
      w('charts', 'On one chart · area + line', { charts: 'overlay', chart1: temp, color1: 'purple', chart2: power, style2: 'line', smooth2: true, color2: 'orange' }),
      w('charts', 'On one chart · bars + bars, from zero', { charts: 'overlay', chart1: power, span1: '6h', style1: 'bars', range1: 'zero', chart2: other[0] || temp, style2: 'bars' }),
      w('charts', 'Start at zero · below zero yellow', { chart1: temp, range1: 'zero', negative1: true, color1: 'purple' }),
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
      w('variables', '2 columns · step 0.5 · renamed', { columns: '2', step: 0.5, ...slots('slot', items), name1: 'Renamed first', name2: 'A long name that has to wrap onto a second line here' }),
      w('variables', 'Step 0.05 · lowest 0 · highest 1', { step: 0.05, min: 0, max: 1, ...slots('slot', items) }),
      w('variables', 'Read only · 2 columns', { readOnly: true, columns: '2', ...slots('slot', items) }),
      w('variables', 'Step 10 · gaps · deleted', { step: 10, ...slots('slot', [items[0], null, missing, items[1]]) }),
      w('variables', 'Nothing picked'),
    ] };
  },

  async flows() {
    // Only flows that look harmless to start by hand: no security, alarm, lock or siren flows.
    const risky = /secur|alarm|siren|lock|fire|smoke|left|came home|restart|rstart/i;
    const flows = pick(await autocomplete('flows', 'flow1'), i => !risky.test(`${i.name} ${i.description ?? ''}`), 8);
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
    return { cols: 3, widgets: [
      w('locks', 'Locks · summary', {}, locks),
      w('locks', 'Locks · list · unlock allowed', { view: 'list', allowUnlock: true }, locks),
      w('locks', 'Doors and windows · summary', {}, contacts),
      w('locks', 'Everything · list', { view: 'list' }, [...locks, ...garages, ...contacts]),
      w('locks', 'One lock · list', { view: 'list' }, locks.slice(0, 1)),
      w('locks', 'With a deleted device', {}, [...locks, MISSING]),
      renaming('locks', 'Rename tiles (the list shows)', {}, locks, locks[0] ? { [locks[0]]: 'Typed name' } : {}),
    ] };
  },

  async curtains() {
    const ids = where(d => ['windowcoverings_set', 'windowcoverings_state', 'windowcoverings_closed', 'windowcoverings_tilt_set'].some(c => has(d, c)));
    const note = ids.length ? '' : ' (no curtains on this Homey)';
    const set = ids.length ? ids : [MISSING];
    return { cols: 2, widgets: [
      w('curtains', `Defaults${note}`, {}, set),
      w('curtains', `Reverse of last move · inverted${note}`, { between: 'reverse', invert: true }, set),
      w('curtains', `No state line${note}`, { showState: false }, set),
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
    return { cols: 3, widgets: [
      w('media', 'Defaults', { device: sp(0) }),
      w('media', 'Volume buttons · step 10 · max 40 %', { device: sp(1), volumeLayout: 'buttons', volumeStep: '10', maxVolume: 40 }),
      w('media', 'No progress · shuffle · no switching', { device: sp(2), showProgress: false, showShuffle: true, switchSpeakers: false }),
      w('media', 'Buttons (TV, card, flow)', { device: tv.device, ...buttons }),
      w('media', 'Volume buttons · shuffle in overlay · buttons', { device: tv.device, volumeLayout: 'buttons', showShuffle: true, ...buttons }),
      w('media', 'Step 2 · no progress · volume buttons', { device: sp(3), volumeStep: '2', showProgress: false, volumeLayout: 'buttons' }),
      w('media', 'Large', { device: sp(0), layout: 'large' }),
      w('media', 'Large · volume buttons · shuffle · buttons', { device: tv.device, layout: 'large', volumeLayout: 'buttons', showShuffle: true, ...buttons }),
      w('media', 'Nothing picked'),
    ] };
  },

  clock: () => ({ cols: 4, widgets: [
    w('clock', 'Defaults (weather)'),
    w('clock', 'No weather', { showWeather: false }),
    w('clock', ''), // no title
    w('clock', 'No weather', { showWeather: false }),
  ] }),

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
      w('textline', 'Typed long · cut off · large · centred', { message: long, size: 'large', align: 'center' }),
      w('textline', 'Typed long · scroll · small', { message: long, overflow: 'scroll', size: 'small', icon: icon('home') }),
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

  // Four columns: a clock, a spacer of the height in its title, another clock, so the second row shows the gap Homey
  // adds and how far each spacer moves it down.
  spacer: () => {
    const heights = [32, 0, 16, 76]; // the default, nothing, a little, a clock's height
    const clock = title => w('clock', title, { showWeather: false });
    return { cols: 4, widgets: [
      ...heights.map(h => clock(`${h} px below${h === 32 ? ' (default)' : ''}`)),
      ...heights.map(h => w('spacer', '', h === 32 ? {} : { height: h })),
      ...heights.map(() => clock('')),
    ] };
  },

  async stack() {
    const boards = pick(await autocomplete('stack', 'dashboard'), i => !/^0 /.test(i.description ?? ''), 3);
    if (!boards.length) return { cols: 2, widgets: [w('stack', 'No Homey dashboard with our widgets, or no API key')] };
    const b = n => boards[n % boards.length];
    return { cols: 2, widgets: [
      w('stack', `${b(0).name} · defaults`, { dashboard: b(0) }),
      w('stack', `${b(1).name} · 10 s · large dots above`, { dashboard: b(1), interval: '10', dotsPosition: 'above', dotsSize: 'large' }),
      w('stack', `${b(2).name} · never rotates · no smart · no dots`, { dashboard: b(2), interval: 'never', smart: false, showDots: false }),
      w('stack', `${b(0).name} · 15 s · resumes after 30 s · small above`, { dashboard: b(0), interval: '15', resumeAfter: '30', dotsPosition: 'above' }),
      w('stack', 'Nothing picked'),
    ] };
  },
};

// ---------------------------------------------------------------- write

const types = positionals.length ? positionals : Object.keys(widgetDefs);
for (const t of types) if (!BUILD[t]) throw new Error(`Unknown widget type: ${t} (known: ${Object.keys(BUILD).join(', ')})`);
const missingBuilders = Object.keys(widgetDefs).filter(t => !BUILD[t]);
if (missingBuilders.length) console.warn(`No test dashboard for: ${missingBuilders.join(', ')}`);

const saved = await homeyApi('GET', SETTING);
const current = Array.isArray(saved) ? saved : [];
const replace = new Set(opts.remove && !positionals.length ? current.filter(d => d.id.startsWith(PREFIX)).map(d => d.id) : types.map(t => PREFIX + t));
const built = [];
const typedNames = {}; // widget instance → tile key → name
if (!opts.remove) {
  for (const type of types) {
    const { cols, widgets } = await BUILD[type]();
    const name = `Test · ${widgetDefs[type].name?.en ?? type}`;
    const placed = widgets.map((x, i) => ({ id: `${type.slice(0, 20)}-${i + 1}`, ...x }));
    for (const { id, tileNames } of placed) if (tileNames) typedNames[`web-${PREFIX}${type}-${id}`] = tileNames;
    const columnsOut = columns(placed.map(({ tileNames, ...x }) => x), cols);
    built.push({ id: PREFIX + type, name, theme: 'auto', columns: columnsOut });
    console.log(`${name}: ${widgets.length} widgets`);
  }
}
// The user's dashboards first, as they were; then the test ones in the manifest's order.
const order = Object.keys(widgetDefs).map(t => PREFIX + t);
const tests = [...current.filter(d => d.id.startsWith(PREFIX) && !replace.has(d.id)), ...built]
  .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const next = [...current.filter(d => !d.id.startsWith(PREFIX)), ...tests];
if (next.length > 30) throw new Error(`That would make ${next.length} web dashboards; at most 30`);
await homeyApi('PUT', SETTING, { value: next });
// The rebuilt (or removed) test dashboards' typed names are replaced; the user's own are kept.
const savedNames = await homeyApi('GET', TILE_NAMES);
const names = Object.fromEntries(Object.entries(savedNames && typeof savedNames === 'object' ? savedNames : {})
  .filter(([instance]) => ![...replace].some(id => instance.startsWith(`web-${id}-`))));
for (const [instance, map] of Object.entries(typedNames)) {
  if (Object.keys(map).length) names[instance] = { names: map, updatedAt: Date.now() };
}
await homeyApi('PUT', TILE_NAMES, { value: names });
await disposeHomeyApiClient(client);
console.log(`${opts.remove ? 'Removed' : 'Saved'}; ${next.length} web dashboards on the Homey now.`);
