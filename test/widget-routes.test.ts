import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeApi, fakeHomey } from './helpers/fakeHomey.js';
import { spyApp, type ServiceCall } from './helpers/spyApp.js';
import { WEB_APIS } from '../api.js';
import { callWidgetRoute } from '../lib/widgetRoutes.js';
import { widgetAutocompletes } from '../lib/widgetAutocompletes.js';

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));

/** A fake Homey whose app is `spyApp()`'s, with the real manifest's widget routes. */
function setup() {
  const homey = fakeHomey(fakeApi({}));
  homey.manifest = { ...homey.manifest, widgets: manifest.widgets };
  const spies = spyApp();
  homey.app = spies.app;
  const call = (type: string, method: string, path: string, query: Record<string, unknown> = {}, body: unknown = {}) =>
    callWidgetRoute(homey, WEB_APIS, type, method, path, query, body);
  return { homey, call, ...spies };
}

const names = { instance: 'w1', key: 'd1', name: 'Sofa' };
const setName = (type: string): Route => [type, 'POST', '/names', {}, names, [['tileNames.set', ['w1', 'd1', 'Sofa']]]];

type Route = [type: string, method: string, path: string, query: Record<string, string>, body: object, calls: ServiceCall[]];

/**
 * Every widget route: the query or body a widget sends, and the service calls the handler makes of it (query values
 * arrive as strings, ids as comma-separated lists).
 */
const ROUTES: Route[] = [
  ['cameras', 'GET', '/state', { deviceIds: 'c1,,c2' }, {}, [['cameras.getState', [['c1', 'c2']]]]],
  ['cameras', 'GET', '/snapshot', { deviceId: 'c1' }, {}, [['cameras.getSnapshot', ['c1']]]],
  ['cameras', 'POST', '/video/offer', {}, { videoId: 'v1', offer: 'v=0' }, [['cameras.offer', ['v1', 'v=0']]]],
  ['cameras', 'POST', '/video/keepalive', {}, { videoId: 'v1', streamId: 'video_v1' }, [['cameras.keepAlive', ['v1', 'video_v1']]]],
  ['cameras', 'POST', '/report', {}, { text: 'played' }, []],
  setName('cameras'),
  ['charts', 'GET', '/state', { charts: 'd1:measure_power~24h,d2:measure_temperature' }, {},
    [['sparklines.getState', [['d1:measure_power'], '24h']], ['sparklines.getState', [['d2:measure_temperature'], undefined]]]],
  ['clock', 'GET', '/clock', { weather: '1' }, {}, [['weather.getForecast', []]]],
  ['curtains', 'GET', '/state', { deviceIds: 'k1' }, {}, [['curtains.getState', [['k1']]]]],
  ['curtains', 'POST', '/set', {}, { deviceId: 'k1', action: 'up', position: 0.5, extra: 1 }, [['curtains.set', ['k1', { action: 'up', position: 0.5 }]]]],
  setName('curtains'),
  ['dayssince', 'GET', '/state', { counters: JSON.stringify([{ name: 'Filter', amber: 30, red: 60, extra: 1 }]) }, {},
    [['daysSince.sync', [[{ name: 'Filter', amber: 30, red: 60 }]]]]],
  ['dayssince', 'POST', '/reset', {}, { name: 'Filter' }, [['daysSince.reset', ['Filter', true]]]],
  ['dayssince', 'POST', '/undo', {}, { name: 'Filter', at: 5 }, [['daysSince.undo', ['Filter', 5]]]],
  ['electricity', 'GET', '/snapshot', { deviceId: 'm1', costs: '0' }, {}, [['electricity.getSnapshot', ['m1', { costs: false }]]]],
  ['flows', 'GET', '/state', { ids: 'flow:a,advancedflow:b' }, {}, [['flows.getState', [['flow:a', 'advancedflow:b']]]]],
  ['flows', 'POST', '/trigger', {}, { id: 'flow:a' }, [['flows.trigger', ['flow:a']]]],
  ['heatmap', 'GET', '/history', { deviceId: 'd1', capabilityId: 'alarm_motion', days: '14' }, {}, [['heatmap.getHistory', ['d1', 'alarm_motion', 14]]]],
  ['lightrooms', 'GET', '/state', { deviceIds: 'l1' }, {}, [['lights.getState', [['l1']]], ['lights.zoneIcons', [['z1']]]]],
  ['lightrooms', 'POST', '/set', {}, { deviceId: 'l1', dim: 0.5, onoff: true, extra: 1 },
    [['lights.set', ['l1', { dim: 0.5, onoff: true, temperature: undefined, hue: undefined, saturation: undefined }]]]],
  ['lightrooms', 'GET', '/moods', { zones: 'z1,z2' }, {}, [['lights.getMoods', [['z1', 'z2']]]]],
  ['lightrooms', 'POST', '/mood', {}, { id: 'm1' }, [['lights.setMood', ['m1']]]],
  ['lights', 'GET', '/state', { deviceIds: 'l1,l2' }, {}, [['lights.getState', [['l1', 'l2']]]]],
  ['lights', 'POST', '/set', {}, { deviceId: 'l1', temperature: 0.2, hue: 0.5, saturation: 1 },
    [['lights.set', ['l1', { dim: undefined, onoff: undefined, temperature: 0.2, hue: 0.5, saturation: 1 }]]]],
  ['lights', 'GET', '/moods', { zones: 'z1' }, {}, [['lights.getMoods', [['z1']]]]],
  ['lights', 'POST', '/mood', {}, { id: 'm1' }, [['lights.setMood', ['m1']]]],
  setName('lights'),
  ['locks', 'GET', '/state', { deviceIds: 'k1', open: 'button.open' }, {}, [['locks.getState', [['k1'], 'button.open']]]],
  ['locks', 'POST', '/set', {}, { deviceId: 'k1', capabilityId: 'locked', value: true }, [['locks.set', ['k1', 'locked', true]]]],
  ['locks', 'POST', '/open', {}, { deviceId: 'k1', capabilityId: 'button.open' }, [['locks.open', ['k1', 'button.open']]]],
  setName('locks'),
  ['media', 'GET', '/state', { deviceId: 's1', cards: '1' }, {}, [['media.getState', ['s1', { cards: true }]]]],
  ['media', 'GET', '/speakers', {}, {}, [['media.listSpeakers', []]]],
  ['media', 'POST', '/set', {}, { deviceId: 's1', capabilityId: 'volume_set', value: 0.3, maxVolume: 50 }, [['media.set', ['s1', 'volume_set', 0.3, 50]]]],
  ['media', 'POST', '/button', {}, { deviceId: '', id: 'flow:f1' }, [['media.runButton', ['', 'flow:f1']]]],
  ['media', 'GET', '/art', { deviceId: 's1' }, {}, [['media.getArt', ['s1']]]],
  ['media', 'POST', '/report', {}, { text: 'played' }, []],
  ['pollen', 'GET', '/pollen', {}, {}, [['pollen.getPollen', []]]],
  ['popups', 'GET', '/state', { name: 'Hall' }, {}, [['popups.forScreen', ['Hall']]]],
  ['price', 'GET', '/price', { costs: '0', hours: '36' }, {}, [['electricity.getSnapshot', [null, { costs: false, futureHours: 36 }]]]],
  ['quickactions', 'GET', '/state', { deviceIds: 'q1' }, {}, [['quickActions.getState', [['q1']]]]],
  ['quickactions', 'POST', '/trigger', {}, { deviceId: 'q1', value: true }, [['quickActions.trigger', ['q1', true]]]],
  setName('quickactions'),
  ['roomhealth', 'GET', '/state', { deviceIds: 'r1,r2' }, {}, [['roomHealth.getState', [['r1', 'r2']]]]],
  setName('roomhealth'),
  ['sensoralarms', 'GET', '/state', { deviceIds: 'a1' }, {}, [['sensorAlarms.getState', [['a1']]]]],
  setName('sensoralarms'),
  ['sensordots', 'GET', '/state', { deviceIds: 'a1,a2' }, {}, [['sensorAlarms.getState', [['a1', 'a2']]]]],
  ['shortcuts', 'GET', '/state', { ids: 'd1,d2', instance: 'web-x-w' }, {}, [['web.shortcuts', [['d1', 'd2'], 'web-x-w']], ['tileNames.get', ['web-x-w']]]],
  setName('shortcuts'),
  ['sparklines', 'GET', '/state', { slots: 'd1:measure_power', span: '24h' }, {}, [['sparklines.getState', [['d1:measure_power'], '24h']]]],
  setName('sparklines'),
  ['stack', 'GET', '/pages', { dashboardId: 'dash1' }, {}, [['stack.getPages', ['dash1']]]],
  ['stack', 'POST', '/call', {}, { type: 'timers', method: 'POST', path: '/start', body: { instance: 'w1', minutes: 5, label: 'Tea' } },
    [['timers.startTimer', ['w1', 5, 'Tea']]]],
  ['textline', 'GET', '/state', { board: 'Kitchen', variable: 'v1' }, {}, [['textLines.get', ['Kitchen']], ['variables.getState', [['v1']]]]],
  ['thermostat', 'GET', '/state', { deviceId: 't1', sensor: 's1:measure_temperature' }, {},
    [['thermostat.getState', ['t1']], ['values.getState', [['s1:measure_temperature']]]]],
  ['thermostat', 'POST', '/apply', {}, { deviceId: 't1', values: [{ capabilityId: 'target_temperature', value: 21 }] },
    [['thermostat.apply', ['t1', [{ capabilityId: 'target_temperature', value: 21 }]]]]],
  ['timers', 'GET', '/state', { instance: 'w1' }, {}, [['timers.getState', ['w1']]]],
  ['timers', 'POST', '/start', {}, { instance: 'w1', minutes: 5, label: 'Tea' }, [['timers.startTimer', ['w1', 5, 'Tea']]]],
  ['timers', 'POST', '/action', {}, { instance: 'w1', id: 't1', action: 'pause' }, [['timers.act', ['w1', 't1', 'pause']]]],
  ['valuematrix', 'GET', '/state', { deviceIds: 'a,b', capabilityIds: 'measure_temperature,measure_humidity' }, {},
    [['valueMatrix.getState', [['a', 'b'], ['measure_temperature', 'measure_humidity']]]]],
  setName('valuematrix'),
  ['values', 'GET', '/state', { slots: 'a:measure_temperature,b:measure_power', seconds: ',measure_humidity' }, {},
    [['values.getState', [['a:measure_temperature', 'b:measure_power'], ['', 'measure_humidity']]]]],
  setName('values'),
  ['variables', 'GET', '/state', { ids: 'v1,v2' }, {}, [['variables.getState', [['v1', 'v2']]]]],
  ['variables', 'POST', '/set', {}, { id: 'v1', value: true }, [['variables.set', ['v1', true]]]],
  setName('variables'),
  ['varpresets', 'GET', '/state', { id: 'v1' }, {}, [['variables.getState', [['v1']]]]],
  ['varpresets', 'POST', '/set', {}, { id: 'v1', value: 3 }, [['variables.set', ['v1', 3]]]],
  ['weather', 'GET', '/forecast', {}, {}, [['weather.getForecast', []]]],
  ['webpage', 'GET', '/location', {}, {}, []],
];

describe('widget routes: from the request to the service', () => {
  it('has a case for every route in the manifests', () => {
    const want = Object.entries<any>(manifest.widgets).flatMap(([type, w]) => Object.values<any>(w.api ?? {}).map(r => `${type} ${r.method} ${r.path}`));
    const have = new Set(ROUTES.map(([type, method, path]) => `${type} ${method} ${path}`));
    expect(want.filter(r => !have.has(r))).toEqual([]);
  });

  it.each(ROUTES)('%s %s %s', async (type, method, path, query, body, calls) => {
    const { call, calls: made } = setup();
    await call(type, method, path, query, body);
    expect(made).toEqual(calls);
  });

  it('turns the query into what the services take', async () => {
    const { call, calls } = setup();
    await call('electricity', 'GET', '/snapshot', {});
    await call('heatmap', 'GET', '/history', { deviceId: 'd1', capabilityId: 'measure_power' });
    await call('price', 'GET', '/price', {});
    await call('media', 'GET', '/state', { deviceId: 's1' });
    await call('clock', 'GET', '/clock', {});
    await call('textline', 'GET', '/state', { variable: 'none' });
    expect(calls).toEqual([
      ['electricity.getSnapshot', [null, { costs: true }]],
      ['heatmap.getHistory', ['d1', 'measure_power', 7]],
      ['electricity.getSnapshot', [null, { costs: true, futureHours: 24 }]],
      ['media.getState', ['s1', { cards: false }]],
    ]);
  });

  it.each([
    ['cameras', 'GET', '/snapshot', {}, {}, /deviceId required/],
    ['cameras', 'POST', '/video/offer', {}, { videoId: 'v1' }, /videoId and offer required/],
    ['curtains', 'POST', '/set', {}, { action: 'up' }, /Missing deviceId/],
    ['dayssince', 'GET', '/state', { counters: '{not json' }, {}, /Invalid counters/],
    ['dayssince', 'GET', '/state', { counters: JSON.stringify([{ name: '' }]) }, {}, /Invalid counters/],
    ['flows', 'POST', '/trigger', {}, {}, /Missing id/],
    ['heatmap', 'GET', '/history', { deviceId: 'd1' }, {}, /required/],
    ['lights', 'POST', '/set', {}, { dim: 1 }, /Missing deviceId/],
    ['locks', 'POST', '/open', {}, {}, /Missing deviceId/],
    ['media', 'GET', '/state', {}, {}, /Missing deviceId/],
    ['media', 'POST', '/button', {}, { id: 'flow:f1' }, /Missing deviceId/],
    ['quickactions', 'POST', '/trigger', {}, {}, /Missing deviceId/],
    ['thermostat', 'POST', '/apply', {}, { deviceId: 't1' }, /Missing values/],
    ['timers', 'GET', '/state', {}, {}, /Missing instance/],
    ['timers', 'POST', '/action', {}, { instance: 'w1', id: 't1', action: 'explode' }, /Unknown action/],
    ['variables', 'POST', '/set', {}, { value: true }, /Missing id/],
    ['varpresets', 'GET', '/state', {}, {}, /Missing id/],
  ] as const)('%s %s %s refuses a request without what it needs', async (type, method, path, query, body, error) => {
    const { call, calls } = setup();
    await expect(call(type, method, path, query, body)).rejects.toThrow(error);
    expect(calls).toEqual([]);
  });
});

describe('widget autocompletes: from the setting to the service', () => {
  const settings = {
    device: { id: 'd1' }, variable: { id: 'v1' }, slot3: { id: 'd3:measure_power' },
  };

  /** Each listener whose list depends on another setting, and the call it makes. */
  const DEPENDENT: [widget: string, setting: string, call: ServiceCall][] = [
    ['thermostat', 'b2Temp', ['thermostat.listTemperatures', ['d1', 'q']]],
    ['thermostat', 'b3Mode', ['thermostat.listEnumOptions', ['d1', 'q']]],
    ['thermostat', 'b1Extra', ['thermostat.listEnumOptions', ['d1', 'q']]],
    ['heatmap', 'capability', ['heatmap.listCapabilities', ['d1', 'q']]],
    ['values', 'second3', ['values.listSecondValues', ['d3:measure_power', 'q', 3]]],
    ['varpresets', 'value2', ['variables.listPresetValues', ['v1', 'q']]],
    ['media', 'button2', ['media.listButtons', ['d1', 'q']]],
    ['textline', 'variable', ['variables.listVariables', ['q', { types: ['string'] }]]],
  ];

  it.each(DEPENDENT)('%s %s reads the setting it depends on', async (widget, setting, expected) => {
    const { app, calls } = spyApp();
    await widgetAutocompletes(app as any)[widget][setting]('q', settings);
    expect(calls).toEqual([expected]);
  });

  it('passes what was typed to its service, one call each', async () => {
    const { app, calls } = spyApp();
    const table = widgetAutocompletes(app as any);
    for (const [widget, listeners] of Object.entries(table)) {
      for (const [setting, listener] of Object.entries(listeners)) {
        calls.length = 0;
        await listener('typed', settings);
        expect([widget, setting, calls.length, calls.some(([, args]) => args.includes('typed'))]).toEqual([widget, setting, 1, true]);
      }
    }
  });
});

describe('the pages call routes that exist', () => {
  const routes = Object.values<any>(manifest.api).map(r => `${r.method} ${r.path.replace(/:\w+/g, '*')}`);
  /** A path as written in a page: `${…}` parts are any value. */
  const route = (method: string, path: string) => `${method} ${path.replace(/\$\{[^}]*\}/g, '*')}`;

  it('the web dashboards page (`request()`)', () => {
    const js = readFileSync('settings/dashboard.js', 'utf8');
    const used = [...js.matchAll(/\brequest\('(GET|POST|PUT|DELETE)', [`'](\/[^`'?]*)/g)].map(m => route(m[1], m[2]));
    expect(used.length).toBeGreaterThanOrEqual(15);
    expect(used.filter(r => !routes.includes(r))).toEqual([]);
  });

  it('the app settings page (`Homey.api()`)', () => {
    const html = readFileSync('settings/index.html', 'utf8');
    const used = [...html.matchAll(/Homey\.api\('(GET|POST|PUT|DELETE)', [`'](\/[^`'?$]*)/g)].map(m => route(m[1], m[2]));
    expect(used.length).toBeGreaterThanOrEqual(6);
    expect(used.filter(r => !routes.includes(r))).toEqual([]);
  });

  it("the popup prompt page (`call()`, POST /popup/:id…)", () => {
    const js = readFileSync('settings/popup.js', 'utf8');
    expect(js).toContain('`/api/app/${appId}/popup/${encodeURIComponent(id)}${path}`');
    const used = [...js.matchAll(/\bcall\('([^']*)'/g)].map(m => `POST /popup/*${m[1]}`);
    expect([...new Set(used)].sort()).toEqual(['POST /popup/*', 'POST /popup/*/answer', 'POST /popup/*/image']);
    expect(used.filter(r => !routes.includes(r))).toEqual([]);
  });
});
