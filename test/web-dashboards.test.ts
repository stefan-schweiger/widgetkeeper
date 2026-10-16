import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import PersonalApiKey from '../lib/PersonalApiKey.js';
import WebDashboardService, { passesDeviceFilter, WEB_DASHBOARDS_SETTING, WEB_ENABLED_SETTING } from '../lib/WebDashboardService.js';
import { widgetAutocompletes } from '../lib/widgetAutocompletes.js';
import WebPassword from '../lib/WebPassword.js';
import api from '../api.js';

vi.mock('homey-api', () => homeyApiMock);

const app = JSON.parse(readFileSync('app.json', 'utf8'));

function setup(autocompletes = {}, enabled = true) {
  const homey = fakeHomey(fakeApi({}));
  homey.manifest = { ...homey.manifest, widgets: app.widgets };
  if (enabled) homey.settings.set(WEB_ENABLED_SETTING, true);
  const log = vi.fn();
  const web = new WebDashboardService(homey, log, autocompletes);
  homey.app = { web, webPassword: new WebPassword(homey, log), log, debug: vi.fn() };
  return { homey, web, log };
}

describe('web dashboards: storage', () => {
  it('keeps a dashboard with known widgets, filling in the manifest defaults', () => {
    const { web, homey } = setup();
    const saved = web.save({
      name: '  Kitchen  ',
      columns: [[
        { type: 'timers', settings: { minutes1: 3, bogus: 1 } },
        { type: 'nope' },
      ], [
        { id: 'w1', type: 'lights', deviceIds: ['a', 'b', 'a', 7], settings: { barMin: 'x', groupByZone: true } },
      ]],
    });
    expect(saved.id).toMatch(/^[a-z0-9]+$/);
    expect(saved.name).toBe('Kitchen');
    expect(saved.theme).toBe('auto');
    expect(saved.columns[0]).toHaveLength(1); // the unknown type is dropped
    const timers = saved.columns[0][0];
    expect(timers.settings.minutes1).toBe(3);
    expect(timers.settings).not.toHaveProperty('bogus');
    expect(timers.settings.minutes2).toBe(10); // the manifest's default
    expect(timers.deviceIds).toEqual([]); // timers have no devices setting
    const lights = saved.columns[1][0];
    expect(lights.id).toBe('w1');
    expect(lights.deviceIds).toEqual(['a', 'b']);
    expect(lights.settings.barMin).toBe('0'); // not one of the dropdown's values: the default
    expect(lights.settings.groupByZone).toBe(true);
    expect(homey.settings.get(WEB_DASHBOARDS_SETTING)).toEqual([saved]);
    expect(web.list()).toEqual([saved]);
  });

  it("keeps an autocomplete choice's own fields, without the image", () => {
    const { web } = setup();
    const saved = web.save({
      columns: [[{
        type: 'thermostat',
        settings: {
          device: { id: 'd1', name: 'Aircon', description: 'Garage', image: 'data:image/png;base64,AAAA' },
          b1Temp: { name: '21°', capabilityId: 'target_temperature', value: 21 },
          b1Mode: { capabilityId: 'mode' }, // no name: not a choice
        },
      }]],
    });
    const s = saved.columns[0][0].settings;
    expect(s.device).toEqual({ id: 'd1', name: 'Aircon', description: 'Garage' });
    expect(s.b1Temp).toEqual({ name: '21°', capabilityId: 'target_temperature', value: 21 });
    expect(s.b1Mode).toBeNull(); // the manifest has no default
  });

  it('keeps one device for a singular devices setting, and clamps numbers to the range', () => {
    const { web } = setup();
    const saved = web.save({
      columns: [[
        { type: 'electricity', deviceIds: ['m1', 'm2'] },
        { type: 'media', settings: { maxVolume: 500 } },
      ]],
    });
    expect(saved.columns[0][0].deviceIds).toEqual(['m1']);
    expect(saved.columns[0][1].settings.maxVolume).toBe(100);
  });

  it('gives a widget a new id when two share one', () => {
    const { web } = setup();
    const saved = web.save({ columns: [[{ id: 'x', type: 'timers' }], [{ id: 'x', type: 'price' }]] });
    expect(saved.columns[0][0].id).toBe('x');
    expect(saved.columns[1][0].id).not.toBe('x');
  });

  it('replaces a dashboard by id, and removes one', () => {
    const { web } = setup();
    const a = web.save({ name: 'A', columns: [[]] });
    const b = web.save({ name: 'B', columns: [[], []] });
    web.save({ ...a, name: 'A2' });
    expect(web.list().map(d => d.name)).toEqual(['A2', 'B']);
    expect(web.remove(a.id)).toEqual({ removed: true });
    expect(web.remove('missing')).toEqual({ removed: false });
    expect(web.list().map(d => d.id)).toEqual([b.id]);
    expect(web.describe()).toEqual({ enabled: true, dashboards: 1, widgets: 0 });
  });

  it('has at least one column and at most six', () => {
    const { web } = setup();
    expect(web.save({ columns: [] }).columns).toEqual([[]]);
    expect(web.save({ columns: Array.from({ length: 9 }, () => []) }).columns).toHaveLength(6);
    expect(() => web.save(null)).toThrow();
  });
});

describe('web dashboards: the old Variables names', () => {
  it("reads each Variables widget's row names from the saved dashboards, by tile key", () => {
    const { web, homey } = setup();
    homey.settings.set(WEB_DASHBOARDS_SETTING, [
      { id: 'd1', name: 'Home', columns: [[
        { id: 'w1', type: 'variables', settings: {
          slot1: { id: 'a' }, name1: ' Guests ', slot2: { id: 'b' }, name2: '', slot3: { id: 'a' }, name3: 'Again',
          slot4: { id: 'none' }, name4: 'Nothing', name5: 'No slot',
        } },
        { id: 'w2', type: 'variables', settings: { slot1: { id: 'a' } } }, // no names: nothing to take over
        { id: 'w3', type: 'values', settings: { slot1: { id: 'x:y' }, name1: 'Power' } },
      ], [
        { id: 'bad id', type: 'variables', settings: { slot1: { id: 'a' }, name1: 'x' } },
      ]] },
      null,
    ]);
    expect(web.oldVariableNames()).toEqual([{ instance: 'web-d1-w1', names: { a: 'Guests', 'a#2': 'Again' } }]);
    // The dashboards as read no longer have them.
    expect(web.list()[0].columns[0][0].settings.name1).toBeUndefined();
  });
});

describe('web dashboards: what the editor needs', () => {
  it("lists the widget types with their settings in Homey's language", () => {
    const { web } = setup();
    const types = web.widgetTypes('da');
    const lights = types.find(t => t.type === 'lights')!;
    expect(lights.name).toBe('Lysstyring');
    expect(lights.transparent).toBe(true);
    expect(lights.devices).toEqual({ singular: false });
    const barMin = lights.settings.find(s => s.id === 'barMin')!;
    expect(barMin.type).toBe('dropdown');
    expect(barMin.values!.map(v => v.id)).toEqual(['0', '1']);
    expect(types.find(t => t.type === 'electricity')!.devices).toEqual({ singular: true });
    expect(types.find(t => t.type === 'timers')!.devices).toBeNull();
    expect(types).toHaveLength(Object.keys(app.widgets).length);
  });

  it("filters devices as the widget's devices setting does", () => {
    const light = { class: 'light', capabilities: ['onoff', 'dim'] };
    const plug = { class: 'socket', virtualClass: 'light', capabilities: ['onoff'] };
    const sensor = { class: 'sensor', capabilities: ['measure_temperature'] };
    expect(passesDeviceFilter(light, { class: 'light|socket', capabilities: 'onoff|dim' })).toBe(true);
    expect(passesDeviceFilter(plug, { class: 'light' })).toBe(true); // by its virtual class
    expect(passesDeviceFilter(sensor, { class: 'light|socket' })).toBe(false);
    expect(passesDeviceFilter(sensor, { capabilities: 'onoff|dim' })).toBe(false);
    expect(passesDeviceFilter(sensor, undefined)).toBe(true);
  });

  it('gives the device picker the rooms (with the zones above them) and the icons', async () => {
    const homey = fakeHomey(fakeApi({
      devices: [
        { id: 'l1', name: 'Pendant', class: 'light', capabilities: ['onoff', 'dim'], zone: 'k', iconObj: { url: '/api/icon/abc' } },
        { id: 'l2', name: 'Lamp', class: 'light', capabilities: ['onoff'], zone: 'gone', iconOverride: 'christmas-lights' },
        { id: 's1', name: 'Sensor', class: 'sensor', capabilities: ['measure_temperature'], zone: 'k' },
      ] as any,
      zones: { home: { name: 'Home', parent: null }, gf: { name: 'Ground floor', parent: 'home' }, k: { name: 'Kitchen', parent: 'gf' } } as any,
    }));
    homey.manifest = { ...homey.manifest, widgets: app.widgets };
    const web = new WebDashboardService(homey, vi.fn(), {});
    expect(await web.devices('lights')).toEqual([
      { id: 'l2', name: 'Lamp', zone: null, icon: 'https://my.homey.app/img/devices/christmas-lights.svg' },
      { id: 'l1', name: 'Pendant', zone: { id: 'k', name: 'Kitchen', path: ['Ground floor'] }, icon: '/api/icon/abc' },
    ]);
    expect((await web.devices('lights', 'kitch')).map(d => d.id)).toEqual(['l1']);
  });

  it('marks the device value slots for the value picker', () => {
    const types = setup().web.widgetTypes('en');
    const picker = (type: string) => types.find(t => t.type === type)!.settings.filter(s => s.picker === 'capability').map(s => s.id);
    expect(picker('values')).toEqual(['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6']);
    expect(picker('sparklines')).toEqual(['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6']);
    expect(picker('charts')).toEqual(['chart1', 'chart2']);
    expect(picker('flows')).toEqual([]); // other autocompletes keep the search list
  });

  it('gives the value picker each device with the values its slots may show, as they read now', async () => {
    const homey = fakeHomey(fakeApi({
      devices: [
        {
          id: 't1', name: 'Thermometer', class: 'sensor', zone: 'k', iconObj: { url: '/api/icon/t' },
          capabilities: ['measure_temperature', 'alarm_battery', 'button'],
          capabilitiesObj: {
            measure_temperature: { type: 'number', title: 'Temperature', units: '°C', decimals: 1, value: 21.46, insights: true },
            alarm_battery: { type: 'boolean', title: 'Battery alarm', value: false, insights: true },
            button: { type: 'boolean', title: 'Button', getable: false, value: null },
          },
        },
        { id: 'b1', name: 'Button', class: 'button', zone: 'k', capabilities: ['button'], capabilitiesObj: { button: { type: 'boolean', getable: false } } },
      ] as any,
      zones: { home: { name: 'Home', parent: null }, k: { name: 'Kitchen', parent: 'home' } } as any,
    }));
    homey.manifest = { ...homey.manifest, widgets: app.widgets };
    const web = new WebDashboardService(homey, vi.fn(), {});
    const values = await web.valueDevices('values');
    expect(values).toHaveLength(1); // the button has nothing to show
    expect(values[0]).toMatchObject({ id: 't1', name: 'Thermometer', zone: { id: 'k', name: 'Kitchen', path: [] }, icon: '/api/icon/t' });
    expect(values[0].caps.map(c => [c.id, c.title, c.value])).toEqual([
      ['measure_temperature', 'Temperature', 21.46], ['alarm_battery', 'Battery alarm', false],
    ]);
    // Sparklines only list logged numbers.
    expect((await web.valueDevices('sparklines'))[0].caps.map(c => c.id)).toEqual(['measure_temperature']);
    await expect(web.valueDevices('lights')).rejects.toThrow();
    await expect(web.valueDevices('__proto__')).rejects.toThrow();
  });

  it("calls an autocomplete setting's listener with the draft settings", async () => {
    const listener = vi.fn(async () => [{ name: 'One', id: '1' }]);
    const { web } = setup({ values: { slot1: listener } });
    await expect(web.autocomplete('values', 'slot1', 'on', { columns: '3' })).resolves.toEqual([{ name: 'One', id: '1' }]);
    expect(listener).toHaveBeenCalledWith('on', { columns: '3' });
    await expect(web.autocomplete('values', 'nope', '', {})).rejects.toThrow();
    await expect(web.autocomplete('__proto__', 'x', '', {})).rejects.toThrow();
  });

  it("reads the app's strings, falling back to English", async () => {
    const { web } = setup();
    expect(((await web.appStrings('da')) as any).web.edit).toBe('Redigér');
    expect(((await web.appStrings('xx')) as any).web.edit).toBe('Edit');
  });

  it('has a listener for every autocomplete setting in the manifest, and none other', () => {
    const table = widgetAutocompletes({} as any);
    const want: string[] = [];
    for (const [type, w] of Object.entries(app.widgets) as [string, any][]) {
      for (const s of w.settings ?? []) if (s.type === 'autocomplete') want.push(`${type}.${s.id}`);
    }
    const have = Object.entries(table).flatMap(([type, listeners]) => Object.keys(listeners).map(id => `${type}.${id}`));
    expect(have.sort()).toEqual(want.sort());
  });
});

describe('web dashboards: the app API', () => {
  it("hands a frame's request to its widget's API, the Smart Stack's included", async () => {
    const { homey } = setup();
    const startTimer = vi.fn(async () => ({ instance: 'web-d-w', timers: [], now: 1 }));
    homey.app.timers = { startTimer };
    await api.postWebCall({ homey, body: { type: 'timers', method: 'POST', path: '/start', query: {}, body: { instance: 'web-d-w', minutes: 5, label: '' } } });
    expect(startTimer).toHaveBeenCalledWith('web-d-w', 5, '');
    await expect(api.postWebCall({ homey, body: { type: 'timers', method: 'GET', path: '/start' } })).rejects.toThrow(/Not a widget route/);
    await expect(api.postWebCall({ homey, body: { type: 'constructor', method: 'GET', path: '/x' } })).rejects.toThrow(/Not a widget route/);
    // The stack's own routes are reachable from a web frame (a stack on a web dashboard), unlike from a stack page.
    homey.app.stack = { getPages: vi.fn(async () => ({ ok: true, pages: [] })) };
    homey.app.apiKey = new PersonalApiKey(homey, vi.fn());
    keyApis.set('page-key', { sessions: { getSessionMe: async () => ({ scopes: ['homey.dashboard.readonly'] }) } });
    await expect(api.postWebCall({ homey, body: { type: 'stack', method: 'GET', path: '/pages', query: { dashboardId: 'd' }, key: 'page-key' } }))
      .resolves.toMatchObject({ ok: true, pages: [] });
    keyApis.delete('page-key');
  });

  it("runs a route that acts with the stored key only when the page's own key may do the same", async () => {
    const { homey } = setup();
    const trigger = vi.fn(async () => ({ ok: true }));
    const setVariable = vi.fn(async () => ({ ok: true }));
    homey.app.flows = { trigger };
    homey.app.variables = { set: setVariable };
    homey.app.apiKey = new PersonalApiKey(homey, vi.fn());
    keyApis.set('weak', { sessions: { getSessionMe: async () => ({ scopes: ['homey.app.control'] }) } });
    keyApis.set('flows', { sessions: { getSessionMe: async () => ({ scopes: ['homey.flow.start'] }) } });
    const call = (type: string, path: string, body: object, key?: string) =>
      api.postWebCall({ homey, body: { type, method: 'POST', path, body, key } });
    await expect(call('flows', '/trigger', { id: 'flow:a' }, 'weak')).resolves.toEqual({ ok: false, reason: 'keyScope' });
    await expect(call('flows', '/trigger', { id: 'flow:a' })).resolves.toEqual({ ok: false, reason: 'keyInvalid' });
    await expect(call('flows', '/trigger', { id: 'flow:a' }, 'nope')).resolves.toEqual({ ok: false, reason: 'keyInvalid' });
    await expect(call('variables', '/set', { id: 'v', value: true }, 'flows')).resolves.toEqual({ ok: false, reason: 'keyScope' });
    await expect(call('varpresets', '/set', { id: 'v', value: true }, 'flows')).resolves.toEqual({ ok: false, reason: 'keyScope' });
    // Through a Smart Stack on the page, and a speaker's card (which needs homey.flow, not only flow.start).
    await expect(call('stack', '/call', { type: 'flows', method: 'POST', path: '/trigger', body: { id: 'flow:a' } }, 'weak'))
      .resolves.toEqual({ ok: false, reason: 'keyScope' });
    await expect(call('media', '/button', { deviceId: 'd', id: 'card:homey:device:d:x' }, 'flows')).resolves.toEqual({ ok: false, reason: 'keyScope' });
    expect(trigger).not.toHaveBeenCalled();
    expect(setVariable).not.toHaveBeenCalled();
    await call('flows', '/trigger', { id: 'flow:a' }, 'flows');
    expect(trigger).toHaveBeenCalledTimes(1);
    keyApis.delete('weak');
    keyApis.delete('flows');
  });
});

describe('web dashboards: turned off', () => {
  it('is off by default: the setup only says so, and every other route refuses', async () => {
    const { homey, web } = setup({}, false);
    web.save({ name: 'Kept', columns: [[]] }); // the dashboards stay while it's off
    const res = await api.getWebSetup({ homey });
    expect(res).toMatchObject({ disabled: true, language: 'en' });
    expect(res).not.toHaveProperty('dashboards');
    expect((res as any).strings.web.off).toBeTruthy();
    await expect(api.postWebCall({ homey, body: { type: 'timers', method: 'GET', path: '/state' } })).rejects.toThrow(/turned off/);
    await expect(api.putWebDashboard({ homey, body: { name: 'x' } })).rejects.toThrow(/turned off/);
    await expect(api.getWebDevices({ homey, query: { type: 'lights' } })).rejects.toThrow(/turned off/);
    expect(web.describe()).toMatchObject({ enabled: false, dashboards: 1 });
    homey.settings.set(WEB_ENABLED_SETTING, true);
    expect(web.enabled).toBe(true);
  });
});

describe('web dashboards page', () => {
  it("has en.json's strings as its fallback", () => {
    const en = JSON.parse(readFileSync('locales/en.json', 'utf8'));
    const js = readFileSync('settings/dashboard.js', 'utf8').replace(/\r\n/g, '\n');
    const table = js.match(/\n( *)const DEFAULT_STRINGS = (\{[\s\S]*?\n\1\});/);
    expect(table).toBeTruthy();
    const strings = new Function(`return ${table![2]}`)();
    expect(strings).toEqual(en.web);
  });

  it('describes every widget type on the front page', () => {
    const en = JSON.parse(readFileSync('locales/en.json', 'utf8'));
    expect(Object.keys(en.web.about).sort()).toEqual(Object.keys(app.widgets).sort());
  });

  it('bundles the socket.io-client version installed', () => {
    const { version } = JSON.parse(readFileSync('node_modules/socket.io-client/package.json', 'utf8'));
    expect(readFileSync('settings/socket.io.js', 'utf8').slice(0, 200)).toContain(`socket.io-client ${version} `);
  });
});
