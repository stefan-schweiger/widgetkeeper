import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import PersonalApiKey from '../lib/PersonalApiKey.js';
import WebDashboardService, { passesDeviceFilter, WEB_DASHBOARDS_SETTING, WEB_ENABLED_SETTING } from '../lib/WebDashboardService.js';
import { widgetAutocompletes } from '../lib/widgetAutocompletes.js';
import { routeKeyUse } from '../lib/widgetRoutes.js';
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
    expect(saved.background).toBe('default');
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

  it('keeps a known background and drops an unknown one', () => {
    const { web } = setup();
    expect(web.save({ name: 'A', background: 'ocean', columns: [[]] }).background).toBe('ocean');
    expect(web.save({ name: 'B', background: 'neon', columns: [[]] }).background).toBe('default');
    expect(web.save({ name: 'C', background: '__proto__', columns: [[]] }).background).toBe('default');
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

describe("web dashboards: other apps' widgets", () => {
  it('keeps them with plain settings (no manifest to check them against)', () => {
    const { web } = setup();
    const long = 'x'.repeat(3000);
    const saved = web.save({
      columns: [[{
        type: 'homey:app:com.example.plants:status',
        title: 'Plants',
        deviceIds: ['p1', 'p1', 'p2', 3],
        trusted: true,
        settings: {
          stage: 'beta',
          count: 3,
          inf: Infinity,
          on: false,
          none: null,
          note: long,
          device: { id: 'd1', name: 'Fern', image: 'data:image/png;base64,AAAA', nested: { a: 1 } },
          bare: { id: 'no-name' },
          list: [1, 2],
          ['k'.repeat(41)]: 1,
          constructor: 'x',
        },
      }, {
        type: 'homey:app:com.example.plants:status',
        trusted: 'yes',
      }]],
    });
    const [w, untrusted] = saved.columns[0];
    expect(w.type).toBe('homey:app:com.example.plants:status');
    expect(w.title).toBe('Plants');
    expect(w.trusted).toBe(true);
    expect(w.deviceIds).toEqual(['p1', 'p2']);
    expect(w.settings).toEqual({ stage: 'beta', count: 3, on: false, none: null, note: 'x'.repeat(2000), device: { id: 'd1', name: 'Fern' } });
    expect(untrusted).not.toHaveProperty('trusted');
    expect(untrusted.settings).toEqual({});
  });

  it("drops our own app's id in that form, a malformed one and a trusted flag on ours", () => {
    const { web } = setup();
    const saved = web.save({
      columns: [[
        { type: 'homey:app:com.thomassidor.widgetkeeper:timers' },
        { type: 'homey:app:com.example' },
        { type: 'homey:app:com.example:a/b' },
        { type: 'homey:manager:dashboards:x' },
        { type: 'timers', trusted: true },
      ]],
    });
    expect(saved.columns[0].map(w => w.type)).toEqual(['timers']);
    expect(saved.columns[0][0]).not.toHaveProperty('trusted');
  });

  it('keeps at most 60 settings', () => {
    const settings = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`s${i}`, i]));
    const saved = setup().web.save({ columns: [[{ type: 'homey:app:com.example:w', settings }]] });
    expect(Object.keys(saved.columns[0][0].settings)).toHaveLength(60);
  });

  it("lists their devices by the filter the page sends, and only the app's own with app=1", async () => {
    const homey = fakeHomey(fakeApi({
      devices: [
        { id: 'w1', name: 'Washer', class: 'other', capabilities: ['washer_state'], ownerUri: 'homey:app:com.example' },
        { id: 'w2', name: 'Other washer', class: 'other', capabilities: ['washer_state'], ownerUri: 'homey:app:com.else' },
        { id: 'l1', name: 'Lamp', class: 'light', capabilities: ['onoff'], ownerUri: 'homey:app:com.example' },
      ] as any,
      zones: {} as any,
    }));
    const web = new WebDashboardService(homey, vi.fn(), {});
    const ids = async (filter: any) => (await web.devices('homey:app:com.example:washer', '', filter)).map(d => d.id);
    expect(await ids({})).toEqual(['l1', 'w2', 'w1']);
    expect(await ids({ capabilities: 'washer_state' })).toEqual(['w2', 'w1']);
    expect(await ids({ capabilities: 'washer_state', app: true })).toEqual(['w1']);
    expect(await ids({ class: 'light|socket' })).toEqual(['l1']);
  });

  it('passes the filter on from the route', async () => {
    const { homey, web } = setup();
    const spy = vi.spyOn(web, 'devices').mockResolvedValue([]);
    await api.getWebDevices({ homey, query: { type: 'homey:app:com.example:washer', query: 'w', class: 'other', capabilities: 'a|b', app: '1' } } as any);
    expect(spy).toHaveBeenCalledWith('homey:app:com.example:washer', 'w', { class: 'other', capabilities: 'a|b', app: true });
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

describe('web dashboards: Dashboard Shortcuts', () => {
  const saved = [
    { id: 'home-1', name: 'Home', columns: [[{ id: 'w-1', type: 'shortcuts', settings: {} }, { id: 'w2', type: 'clock', settings: {} }]] },
    { id: 'home', name: '', columns: [[{ id: '1-w-1', type: 'shortcuts', settings: {} }]] },
    { id: 'lights', name: 'Lights', columns: [[]] },
  ];

  it("names each picked dashboard (missing when deleted) and finds the one holding the widget, ids with '-' and all", () => {
    const { web, homey } = setup();
    homey.settings.set(WEB_DASHBOARDS_SETTING, saved);
    // `web-home-1-w-1` could split as home + 1-w-1 too: only Home has a shortcuts widget w-1.
    expect(web.shortcuts(['lights', 'gone', 'home'], 'web-home-1-w-1')).toEqual({
      current: 'home-1',
      tiles: [{ id: 'lights', name: 'Lights' }, { id: 'gone', missing: true }, { id: 'home', name: 'Untitled' }],
    });
    expect(web.shortcuts(['lights'], 'web-home-1-w2').current).toBeNull(); // the clock, not a shortcuts widget
    expect(web.shortcuts(['lights'], 'a-homey-dashboard-widget').current).toBeNull();
    expect(web.shortcuts([], undefined)).toEqual({ current: null, tiles: [] });
  });

  it('answers through its widget route with the typed names, as a frame asks', async () => {
    const { web, homey } = setup();
    homey.settings.set(WEB_DASHBOARDS_SETTING, saved);
    homey.app.tileNames = { get: () => ({ names: { lights: 'Lamps' } }) };
    await expect(api.postWebCall({ homey, body: { type: 'shortcuts', method: 'GET', path: '/state', query: { ids: 'lights', instance: 'web-home-w' }, body: {} } }))
      .resolves.toEqual({ state: { current: null, tiles: [{ id: 'lights', name: 'Lights' }] }, tileNames: { lights: 'Lamps' } });
    expect(web.widgetTypes().map(t => t.type)).toContain('shortcuts'); // offered on the web though Homey hides it
  });

  it('lists the dashboards for its settings: None, then by name, with their widget counts', () => {
    const { web, homey } = setup();
    homey.settings.set(WEB_DASHBOARDS_SETTING, saved);
    expect(web.dashboardItems('')).toEqual([
      { id: 'none', name: 'None' },
      { id: 'home-1', name: 'Home', description: '2' },
      { id: 'lights', name: 'Lights', description: '0' },
      { id: 'home', name: 'Untitled', description: '1' },
    ]);
    expect(web.dashboardItems('lig').map(i => i.id)).toEqual(['lights']);
  });

  it('is hidden from Homey\'s own dashboards (deprecated), and its autocompletes are the dashboards and the icons', async () => {
    expect(app.widgets.shortcuts.deprecated).toBe(true);
    const app2 = { web: { dashboardItems: vi.fn(() => []) }, flows: { listIcons: vi.fn(() => []) } };
    const table = widgetAutocompletes(app2 as any);
    await table.shortcuts.dashboard3('x', {});
    await table.shortcuts.icon8('y', {});
    expect(app2.web.dashboardItems).toHaveBeenCalledWith('x');
    expect(app2.flows.listIcons).toHaveBeenCalledWith('y');
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

  it("groups the settings by their titles: a group's head, the rows under it, and numbered slots", () => {
    const types = setup().web.widgetTypes('en');
    const of = (type: string) => types.find(t => t.type === type)!;
    // The groups and slots in order (plain runs only by their place: other settings may join them), and which run a setting is in.
    const shape = (type: string) => of(type).sections.map(s => (s.kind === 'group' ? `${s.title}${s.numbered ? '#' : ''}:${s.ids.length}` : s.kind === 'slots' ? `slots:${s.ids.length}` : 'plain'))
      .filter((s, i, all) => s !== 'plain' || all[i - 1] !== 'plain');
    const plainHas = (type: string, id: string) => of(type).sections.some(s => s.kind === 'plain' && s.ids.includes(id));
    const groups = (type: string) => shape(type).filter(s => s !== 'plain');
    expect(groups('flows')).toEqual(Array.from({ length: 8 }, (_, i) => `Button\u00A0${i + 1}#:4`));
    expect(plainHas('flows', 'columns')).toBe(true);
    expect(of('flows').settings.filter(s => /^(flow|color|icon|name)1$/.test(s.id)).map(s => s.label)).toEqual(['Flow', 'Colour', 'Icon', 'Name']);
    expect(groups('timers')).toEqual(Array.from({ length: 4 }, (_, i) => `Timer\u00A0${i + 1}#:2`));
    expect(plainHas('timers', 'sound')).toBe(true);
    expect(groups('roomhealth')).toEqual(['Temperature:2', 'Humidity:2']);
    expect(plainHas('roomhealth', 'co2Max')).toBe(true);
    expect(of('roomhealth').settings.find(s => s.id === 'tempMax')!.label).toBe('Highest (°C)');
    expect(groups('stack')).toEqual(['Show page dots:3']);
    expect(groups('values')).toEqual(Array.from({ length: 6 }, (_, i) => `Tile ${i + 1}#:2`));
    expect(of('values').settings.filter(s => /^(slot|second)1$/.test(s.id)).map(s => s.label)).toEqual(['Value', 'Second value']);
    expect(groups('variables')).toEqual(['slots:10']);
    expect(of('variables').settings.find(s => s.id === 'slot3')!.label).toBe('Variable\u00A03');
    expect(groups('media')).toEqual(Array.from({ length: 4 }, (_, i) => `Button\u00A0${i + 1}#:3`)); // heads without a colon
    expect(groups('clock')).toEqual([]);
    for (const t of types) expect(t.sections.flatMap(s => s.ids), t.type).toEqual(t.settings.map(s => s.id));
  });

  it('groups the settings the same way in every language', () => {
    const { web } = setup();
    const kinds = (lang: string) => web.widgetTypes(lang).map(t => ({ type: t.type, sections: t.sections.map(s => [s.kind, s.ids, s.kind === 'group' && s.numbered]) }));
    const en = kinds('en');
    for (const lang of ['nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar']) expect(kinds(lang), lang).toEqual(en);
    // The labels are the language's: a head's after the colon, a row's without its dash.
    const flows = web.widgetTypes('de').find(t => t.type === 'flows')!;
    expect(flows.sections.find(s => s.kind === 'group')).toMatchObject({ title: 'Button\u00A01' });
    expect(flows.settings.filter(s => /^(flow|color)1$/.test(s.id)).map(s => s.label)).toEqual(['Flow', 'Farbe']);
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

describe('web dashboards: the routes that act with the stored key', () => {
  // A route left out of routeKeyUse() would let a page whose own key may do less borrow the stored key's permissions.
  it('routeKeyUse() names exactly the widget routes that answer through keyResult()', () => {
    const missed: string[] = [];
    const extra: string[] = [];
    for (const id of readdirSync('widgets')) {
      let source: string;
      try { source = readFileSync(`widgets/${id}/api.ts`, 'utf8'); } catch { continue; }
      const handlers = source.split(/\n {2}async (?=\w+\()/).slice(1);
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const name = handler.match(/^\w+/)![0];
        const route = app.widgets[id]?.api?.[name];
        if (!route) continue;
        const usesKey = handler.includes('keyResult(');
        const use = routeKeyUse(id, route.method, route.path, { id: '' });
        if (id === 'stack' && name === 'call') continue; // its page's route, checked below
        if (usesKey && !use) missed.push(`${id} ${name}`);
        if (!usesKey && use) extra.push(`${id} ${name}`);
      }
    }
    expect({ missed, extra }).toEqual({ missed: [], extra: [] });
    expect(routeKeyUse('media', 'POST', '/button', { id: 'card:x' })).toBe('cards');
    expect(routeKeyUse('stack', 'POST', '/call', { type: 'flows', method: 'POST', path: '/trigger' })).toBe('flows');
    expect(routeKeyUse('stack', 'POST', '/call', { type: 'lights', method: 'POST', path: '/set' })).toBe(null);
  });
});

describe('web dashboards: the front page', () => {
  it('reorders the dashboards and keeps whether the widgets show', async () => {
    const { homey, web } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map(name => web.save({ name, columns: [[]] }));
    expect(web.front()).toEqual({ widgets: true });
    // Ids it doesn't name keep their order after the named ones; unknown and repeated ids are ignored.
    const res = await api.putWebFront({ homey, body: { order: [c.id, 'nope', a.id, c.id] } });
    expect(res.dashboards.map(d => d.name)).toEqual(['C', 'A', 'B']);
    expect(web.list().map(d => d.id)).toEqual([c.id, a.id, b.id]);
    expect(res.front).toEqual({ widgets: true });
    expect((await api.putWebFront({ homey, body: { widgets: false } })).front).toEqual({ widgets: false });
    expect(web.list().map(d => d.id)).toEqual([c.id, a.id, b.id]); // no order: left as it is
    expect(web.front()).toEqual({ widgets: false });
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
    await expect(api.putWebFront({ homey, body: { widgets: false } })).rejects.toThrow(/turned off/);
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

  it("loads the kit from where the Homey serves it (a widget's public folder is /app/<appId>/widgets/<id>/)", () => {
    const html = readFileSync('settings/dashboard.html', 'utf8');
    expect(html).toContain('<script src="../widgets/spacer/kit.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="../widgets/spacer/kit.css">');
    expect(html).not.toContain('/public/');
  });

  it('bundles the socket.io-client version installed', () => {
    const { version } = JSON.parse(readFileSync('node_modules/socket.io-client/package.json', 'utf8'));
    expect(readFileSync('settings/socket.io.js', 'utf8').slice(0, 200)).toContain(`socket.io-client ${version} `);
  });
});
