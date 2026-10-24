import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import PersonalApiKey from '../lib/PersonalApiKey.js';
import TileNameService, { TILE_NAMES_EVENT, TILE_NAMES_SETTING, tileNameRoutes } from '../lib/TileNameService.js';
import WebDashboardService, { MAX_DASHBOARDS, passesDeviceFilter, settingSections, WEB_BACKUP_FORMAT, WEB_DASHBOARDS_SETTING, WEB_ENABLED_SETTING, WEB_FRONT_SETTING, WEB_REMOTE_SETTING } from '../lib/WebDashboardService.js';
import { widgetAutocompletes } from '../lib/widgetAutocompletes.js';
import { DEVICE_WRITES, pageKeyUse, routeKeyUse } from '../lib/widgetRoutes.js';
import WebPassword from '../lib/WebPassword.js';
import PopupService from '../lib/PopupService.js';
import api from '../api.js';

vi.mock('homey-api', () => homeyApiMock);

const app = JSON.parse(readFileSync('app.json', 'utf8'));

function setup(autocompletes = {}, enabled = true) {
  const homey = fakeHomey(fakeApi({}));
  homey.manifest = { ...homey.manifest, widgets: app.widgets };
  if (enabled) homey.settings.set(WEB_ENABLED_SETTING, true);
  const log = vi.fn();
  const tileNames = new TileNameService(homey);
  const web = new WebDashboardService(homey, log, autocompletes, tileNames);
  const popups = new PopupService(homey, { cameras: {} as any, web }, log);
  homey.app = { web, tileNames, webPassword: new WebPassword(homey, log), popups, log, debug: vi.fn() };
  return { homey, web, log, tileNames };
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
    expect(web.describe()).toEqual({ enabled: true, remote: false, dashboards: 1, widgets: 0 });
  });

  it("keeps a wide widget's span within the columns and its place in each column it covers", () => {
    const { web } = setup();
    const saved = web.save({
      columns: [
        [{ id: 'a', type: 'cameras', span: 2.2, at: [1] }, { id: 'b', type: 'timers', span: 9, at: ['x', -4, 99] }],
        [{ id: 'c', type: 'clock' }, { id: 'd', type: 'clock' }],
        [{ id: 'e', type: 'price', span: 3, at: [0, 0] }],
      ],
    });
    const [[a, b], [c], [e]] = saved.columns;
    expect(a).toMatchObject({ span: 2, at: [1] });
    expect(b).toMatchObject({ span: 3, at: [1, 0] }); // three columns at most; a bad index is its own, a large one the end
    expect(c).not.toHaveProperty('span');
    expect(e).not.toHaveProperty('span'); // the last column: nothing to its right
    expect(e).not.toHaveProperty('at');
    expect(web.save({ columns: [[{ type: 'clock', span: 3 }], [], []] }).columns[0][0]).toMatchObject({ span: 3, at: [0, 0] });
    expect(web.save({ columns: [[{ type: 'clock', span: 1, at: [0] }], []] }).columns[0][0]).not.toHaveProperty('at');
  });

  it('keeps a wide widget in a duplicate and a backup', () => {
    const { web } = setup();
    const d = web.save({ name: 'Wide', columns: [[{ id: 'a', type: 'cameras', span: 2, at: [1] }], [{ id: 'b', type: 'clock' }]] });
    const { dashboard: copy } = web.duplicate(d.id);
    expect(copy.columns[0][0]).toMatchObject({ span: 2, at: [1] });
    const file = web.backup();
    web.remove(d.id);
    web.restore(file);
    expect(web.list().find(x => x.id === d.id)!.columns[0][0]).toMatchObject({ span: 2, at: [1] });
  });

  it('has at least one column and at most six', () => {
    const { web } = setup();
    expect(web.save({ columns: [] }).columns).toEqual([[]]);
    expect(web.save({ columns: Array.from({ length: 9 }, () => []) }).columns).toHaveLength(6);
    expect(() => web.save(null)).toThrow();
  });

  // Any key holder can store a dashboard (`PUT /web/dashboards`, a backup): each value keeps to its type and size.
  it("keeps each setting to its type and size, and the dashboard's name, title, widgets and devices to their counts", () => {
    const { web, homey } = setup();
    homey.manifest = {
      ...homey.manifest,
      widgets: {
        ...app.widgets,
        probe: {
          devices: { singular: false },
          settings: [
            { id: 'n', type: 'number', value: 5, min: 0, max: 10 },
            { id: 't', type: 'text', value: 'x' },
            { id: 'a', type: 'autocomplete', value: null },
            { id: 'c', type: 'colorpicker', value: '#fff' },
          ],
        },
      },
    };
    const probe = (w: object) => web.save({ columns: [[{ type: 'probe', ...w }]] }).columns[0][0];
    const settings = (s: object) => probe({ settings: s }).settings;
    expect(settings({ n: '' }).n).toBeNull();
    expect(settings({ n: null }).n).toBeNull();
    expect(settings({ n: '7' }).n).toBe(7);
    expect(settings({ n: -3 }).n).toBe(0);
    expect(settings({ n: 'x' }).n).toBe(5); // not a number: the default
    expect(settings({ n: Infinity }).n).toBe(5);
    expect(settings({ t: 'y'.repeat(5000) }).t).toHaveLength(2000);
    expect(settings({ t: 42 }).t).toBe('x');
    expect(settings({ a: null }).a).toBeNull();
    expect(settings({ a: { id: 'x' } }).a).toBeNull(); // no name: not a choice, so the default
    expect(settings({ c: '#000' }).c).toBe('#fff'); // a type it doesn't know keeps the default
    expect(settings(JSON.parse('{"n": 1, "__proto__": {"polluted": true}, "extra": 1}'))).toEqual({ n: 1, t: 'x', a: null, c: '#fff' });

    const ids = Array.from({ length: 120 }, (_, i) => `d${i}`);
    const widget = probe({ id: '../x', title: ` ${'T'.repeat(80)} `, deviceIds: [...ids, '../bad', 7, 'd0'] });
    expect(widget.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(widget.title).toHaveLength(60);
    expect(widget.deviceIds).toEqual(ids.slice(0, 100));

    const big = web.save({ name: 'N'.repeat(80), columns: Array.from({ length: 6 }, () => Array.from({ length: 12 }, () => ({ type: 'clock' }))) });
    expect(big.name).toHaveLength(60);
    expect(big.columns.flat()).toHaveLength(60); // at most 60 widgets
    expect(big.columns.map(c => c.length)).toEqual([12, 12, 12, 12, 12, 0]);
  });

  it('drops a stored dashboard it cannot read, and refuses one past 64', () => {
    const { web, homey, log } = setup();
    homey.settings.set(WEB_DASHBOARDS_SETTING, [null, 'x', { id: '../x', name: 'Bad id', columns: [] }, { name: 'No id' }, { id: 'ok', name: 'Kept', columns: [[]] }]);
    expect(web.list().map(d => d.name)).toEqual(['Kept']);
    expect(log).toHaveBeenCalledWith('Web dashboards: dropped a saved dashboard:', 'A dashboard needs an id');
    expect(log).toHaveBeenCalledWith('Web dashboards: dropped a saved dashboard:', 'Not a dashboard');
    homey.settings.set(WEB_DASHBOARDS_SETTING, Array.from({ length: MAX_DASHBOARDS }, (_, i) => ({ id: `d${i}`, columns: [[]] })));
    expect(() => web.save({ name: 'One more', columns: [[]] })).toThrow(/At most 64/);
    expect(web.save({ id: 'd3', name: 'Replaced', columns: [[]] }).name).toBe('Replaced'); // a stored one is still replaced
  });

  it('keeps at most 20 sections, each id once, names cut at 60', () => {
    const { web } = setup();
    const sections = [{ id: 's0', name: 'Again' }, ...Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `${'S'.repeat(70)}${i}` })), { id: '../x', name: 'Bad' }];
    const { front } = web.saveFront({ sections });
    expect(front.sections).toHaveLength(20);
    expect(front.sections[0]).toEqual({ id: 's0', name: 'Again' });
    expect(front.sections.map(s => s.id)).toEqual(['s0', ...Array.from({ length: 19 }, (_, i) => `s${i + 1}`)]);
    expect(front.sections[1].name).toHaveLength(60);
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
        { type: 'homey:app:..:plants' },
        { type: 'homey:app:.:plants' },
        { type: 'homey:app:.hidden:plants' },
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
      tiles: [{ id: 'lights', name: 'Lights' }, { id: 'gone', missing: true }, { id: 'home', name: 'Dashboard' }],
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
      { id: 'home', name: 'Dashboard', description: '1 widgets' }, // no name: en.json's "Dashboard"
      { id: 'home-1', name: 'Home', description: '2 widgets' },
      { id: 'lights', name: 'Lights', description: '0 widgets' },
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
    expect(types.map(t => t.type).sort()).toEqual(Object.keys(app.widgets).sort());
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
      // Every route in the manifest is a handler read here (or the spread tile names route, which uses no key), so a
      // handler written in another form fails here instead of being skipped.
      const read = [...handlers.map(h => h.match(/^\w+/)![0]), ...(source.includes('...tileNameRoutes') ? Object.keys(tileNameRoutes) : [])];
      expect([id, read.sort()]).toEqual([id, Object.keys(app.widgets[id]?.api ?? {}).sort()]);
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
    expect(web.front()).toEqual({ widgets: true, sections: [] });
    // Ids it doesn't name keep their order after the named ones; unknown and repeated ids are ignored.
    const res = await api.putWebFront({ homey, body: { order: [c.id, 'nope', a.id, c.id] } });
    expect(res.dashboards.map(d => d.name)).toEqual(['C', 'A', 'B']);
    expect(web.list().map(d => d.id)).toEqual([c.id, a.id, b.id]);
    expect(res.front).toEqual({ widgets: true, sections: [] });
    expect((await api.putWebFront({ homey, body: { widgets: false } })).front).toEqual({ widgets: false, sections: [] });
    expect(web.list().map(d => d.id)).toEqual([c.id, a.id, b.id]); // no order: left as it is
    expect(web.front()).toEqual({ widgets: false, sections: [] });
  });

  it('keeps sections, puts dashboards in them, and takes them out of one deleted', async () => {
    const { homey, web } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map(name => web.save({ name, columns: [[]] }));
    const res = await api.putWebFront({
      homey,
      body: {
        sections: [{ id: 'tests', name: '  Tests  ' }, { id: 'tests', name: 'Again' }, { id: 'bad id!', name: 'X' }, { id: 'rooms', name: 7 }],
        placement: { [a.id]: 'tests', [c.id]: 'nope', [b.id]: 'rooms' },
        order: [b.id, c.id, a.id],
      },
    });
    expect(res.front).toEqual({ widgets: true, sections: [{ id: 'tests', name: 'Tests' }, { id: 'rooms', name: '' }] });
    expect(web.list().map(d => [d.name, d.section])).toEqual([['B', 'rooms'], ['C', undefined], ['A', 'tests']]);
    expect(web.list()[1]).not.toHaveProperty('section');
    // A save from the editor keeps it; a placement of null takes it out.
    web.save({ ...web.list()[2], name: 'A2' });
    expect(web.list()[2].section).toBe('tests');
    web.saveFront({ placement: { [b.id]: null } });
    expect(web.list()[0]).not.toHaveProperty('section');
    // Deleting a section (the list without it) leaves its dashboards in none; the carousel's choice stays.
    web.saveFront({ widgets: false });
    expect(web.saveFront({ sections: [{ id: 'rooms', name: 'Rooms' }] }).front).toEqual({ widgets: false, sections: [{ id: 'rooms', name: 'Rooms' }] });
    expect(web.list().map(d => d.section)).toEqual([undefined, undefined, undefined]);
    // At most 20.
    web.saveFront({ sections: Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `S${i}` })) });
    expect(web.front().sections).toHaveLength(20);
  });

  it('copies a dashboard into its section, and a restore brings the sections its dashboards are in', () => {
    const { web } = setup();
    const a = web.save({ name: 'A', columns: [[]] });
    web.saveFront({ sections: [{ id: 'tests', name: 'Tests' }], placement: { [a.id]: 'tests' } });
    expect(web.duplicate(a.id).dashboard.section).toBe('tests');
    const backup = web.backup([a.id]);
    expect(backup.front.sections).toEqual([{ id: 'tests', name: 'Tests' }]);
    web.saveFront({ sections: [{ id: 'other', name: 'Other' }] });
    web.restore(backup); // not `complete`: the section is added after those here
    expect(web.front().sections).toEqual([{ id: 'other', name: 'Other' }, { id: 'tests', name: 'Tests' }]);
    expect(web.list().find(d => d.id === a.id)!.section).toBe('tests');
    web.restore({ ...backup, complete: true }); // the file's front page as it is
    expect(web.front().sections).toEqual([{ id: 'tests', name: 'Tests' }]);
  });
});

describe('web dashboards: duplicate', () => {
  it('copies a dashboard right after it, with the tile names of its widgets', async () => {
    const { homey, web, tileNames } = setup();
    const a = web.save({ name: 'Hall', theme: 'dark', background: 'ocean', columns: [[{ id: 'w1', type: 'lights', deviceIds: ['d1'], settings: { renameTiles: true } }], [{ id: 'w2', type: 'timers' }]] });
    const b = web.save({ name: 'Kitchen', columns: [[]] });
    tileNames.set(`web-${a.id}-w1`, 'd1', 'Porch');
    const res = await api.postWebDashboardCopy({ homey, params: { id: a.id } });
    expect(res.dashboard.id).not.toBe(a.id);
    expect(res.dashboard).toEqual({ ...a, id: res.dashboard.id, name: 'Hall (copy)' }); // homey.__ is undefined here: the English fallback
    expect(web.list().map(d => d.id)).toEqual([a.id, res.dashboard.id, b.id]);
    expect(res.dashboards).toEqual(web.list());
    expect(tileNames.get(`web-${res.dashboard.id}-w1`).names).toEqual({ d1: 'Porch' });
    expect(homey.api.realtime).toHaveBeenLastCalledWith(TILE_NAMES_EVENT, { instance: `web-${res.dashboard.id}-w1`, names: { d1: 'Porch' } });
    tileNames.set(`web-${res.dashboard.id}-w1`, 'd1', 'Front door'); // the copy's names are its own
    expect(tileNames.get(`web-${a.id}-w1`).names).toEqual({ d1: 'Porch' });
    expect(tileNames.get(`web-${res.dashboard.id}-w2`).names).toEqual({});
  });

  it("names the copy in Homey's language, and refuses an unknown dashboard and a 65th", () => {
    const { homey, web } = setup();
    homey.__ = (key: string, tokens?: Record<string, string>) => (key === 'web.copyName' ? `${tokens!.name} (kopi)` : key === 'web.untitled' ? 'Dashboard' : undefined);
    const a = web.save({ name: '', columns: [[]] });
    expect(web.duplicate(a.id).dashboard.name).toBe('Dashboard (kopi)');
    expect(() => web.duplicate('nope')).toThrow(/No such dashboard/);
    for (let i = web.list().length; i < 64; i++) web.save({ name: `D${i}`, columns: [[]] });
    expect(() => web.duplicate(a.id)).toThrow(/At most 64/);
  });

  it('needs the session while a password is set', async () => {
    const { homey, web } = setup();
    const a = web.save({ name: 'Hall', columns: [[]] });
    await homey.app.webPassword.setPassword('correct horse');
    await expect(api.postWebDashboardCopy({ homey, params: { id: a.id } })).rejects.toThrow(/password required/);
    const { token } = await homey.app.webPassword.login('correct horse');
    await expect(api.postWebDashboardCopy({ homey, query: { session: token }, params: { id: a.id } })).resolves.toHaveProperty('dashboard');
  });
});

describe('web dashboards: backup and restore', () => {
  it('backs up the dashboards, the front page and their tile names, and restores them as they were', async () => {
    const { homey, web, tileNames } = setup();
    const a = web.save({ name: 'Hall', columns: [[{ id: 'w1', type: 'lights', deviceIds: ['d1'] }]] });
    const b = web.save({ name: 'Kitchen', background: 'sand', columns: [[{ id: 'w1', type: 'timers' }], []] });
    web.saveFront({ order: [b.id, a.id], widgets: false });
    tileNames.set(`web-${a.id}-w1`, 'd1', 'Porch');
    tileNames.set('native-widget', 'd1', 'Mine'); // a Homey dashboard widget's: not in the backup
    tileNames.set('web-gone-w1', 'd1', 'Old'); // a deleted web dashboard's: not in it either
    const backup = JSON.parse(JSON.stringify(await api.getWebBackup({ homey })));
    expect(backup).toMatchObject({ format: WEB_BACKUP_FORMAT, version: 1, app: '0.3.0', front: { widgets: false } });
    expect(backup.dashboards.map((d: any) => d.name)).toEqual(['Kitchen', 'Hall']);
    expect(backup.tileNames).toEqual({ [`web-${a.id}-w1`]: { d1: 'Porch' } });
    expect(Number.isNaN(Date.parse(backup.exportedAt))).toBe(false);

    // Everything changes, then the backup puts it back: its dashboards' old names go, a Homey dashboard's and a dashboard
    // made since stay, with their names.
    web.remove(a.id);
    const later = web.save({ name: 'New', columns: [[{ id: 'w1', type: 'lights' }]] });
    web.saveFront({ widgets: true });
    tileNames.set(`web-${b.id}-w1`, 'x', 'Later');
    tileNames.set(`web-${later.id}-w1`, 'd1', 'Since');
    await expect(api.putWebBackup({ homey, body: { ...backup, complete: true } })).resolves.toEqual({ dashboards: 2, widgets: 2, skipped: 0 });
    expect(web.list().map(d => d.name)).toEqual(['Kitchen', 'New', 'Hall']); // Kitchen in place, Hall added
    expect(web.list().filter(d => d.id !== later.id)).toEqual(backup.dashboards);
    expect(web.front()).toEqual({ widgets: false, sections: [] });
    expect(tileNames.get(`web-${a.id}-w1`).names).toEqual({ d1: 'Porch' });
    expect(tileNames.get(`web-${b.id}-w1`).names).toEqual({});
    expect(tileNames.get(`web-${later.id}-w1`).names).toEqual({ d1: 'Since' });
    expect(tileNames.get('web-gone-w1').names).toEqual({ d1: 'Old' }); // not one of the file's
    expect(tileNames.get('native-widget').names).toEqual({ d1: 'Mine' });
    expect(homey.api.realtime).toHaveBeenCalledWith(TILE_NAMES_EVENT, { instance: `web-${b.id}-w1`, names: {} });
    expect(homey.api.realtime).toHaveBeenCalledWith(TILE_NAMES_EVENT, { instance: `web-${a.id}-w1`, names: { d1: 'Porch' } });
  });

  it('checks a restored dashboard as a saved one, and gives a repeated id a new one without the names', () => {
    const { homey, web, tileNames } = setup();
    const res = web.restore({
      format: WEB_BACKUP_FORMAT,
      version: 1,
      dashboards: [
        { id: 'one', name: 'First', columns: [[{ id: 'w1', type: 'nope' }, { id: 'w2', type: 'timers', settings: { bogus: 1 } }]] },
        { id: 'one', name: 'Second', columns: [[{ id: 'w2', type: 'timers' }]] },
        'not a dashboard',
      ],
      tileNames: JSON.parse('{"web-one-w2": {"a": "  Tea  ", "b": 1}, "native": {"a": "No"}, "__proto__": {"a": "No"}}'),
    });
    expect(res).toEqual({ dashboards: 2, widgets: 2, skipped: 0 });
    const [first, second] = web.list();
    expect(first.id).toBe('one');
    expect(first.columns[0].map(w => w.type)).toEqual(['timers']);
    expect(first.columns[0][0].settings).not.toHaveProperty('bogus');
    expect(second.id).not.toBe('one');
    expect(second.name).toBe('Second');
    expect(web.front()).toEqual({ widgets: true, sections: [] }); // none in the file: the default
    expect(homey.settings.get(TILE_NAMES_SETTING)).toEqual({ 'web-one-w2': { names: { a: 'Tea' }, updatedAt: expect.any(Number) } });
    expect(tileNames.get(`web-${second.id}-w2`).names).toEqual({});
  });

  it('refuses a file that is not a backup, and changes nothing', async () => {
    const { homey, web } = setup();
    const a = web.save({ name: 'Hall', columns: [[]] });
    for (const body of [null, {}, { format: 'other', version: 1, dashboards: [] }, { format: WEB_BACKUP_FORMAT, version: 2, dashboards: [] }, { format: WEB_BACKUP_FORMAT, version: 1 }]) {
      await expect(api.putWebBackup({ homey, body })).rejects.toThrow(/Not a Widgetkeeper backup/);
    }
    expect(web.list()).toEqual([a]);
    expect(homey.settings.get(WEB_FRONT_SETTING)).toBe(null);
  });

  it('keeps at most 64: a stored id is still replaced, a new one past them is skipped', async () => {
    const { homey, web } = setup();
    const dashboards = Array.from({ length: 70 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, columns: [[]] }));
    await expect(api.putWebBackup({ homey, body: { format: WEB_BACKUP_FORMAT, version: 1, dashboards } })).resolves.toEqual({ dashboards: 64, widgets: 0, skipped: 6 });
    expect((await api.getWebBackup({ homey })).dashboards).toHaveLength(64);
    expect(web.list()[63].id).toBe('d63');
    const again = [{ id: 'd70', name: 'New', columns: [[]] }, { id: 'd5', name: 'Five', columns: [[]] }];
    await expect(api.putWebBackup({ homey, body: { format: WEB_BACKUP_FORMAT, version: 1, dashboards: again } })).resolves.toEqual({ dashboards: 1, widgets: 0, skipped: 1 });
    expect(web.list()[5].name).toBe('Five');
  });

  it('backs up only the chosen dashboards, with their tile names', async () => {
    const { homey, web, tileNames } = setup();
    const a = web.save({ name: 'Hall', columns: [[{ id: 'w1', type: 'lights' }]] });
    const b = web.save({ name: 'Kitchen', columns: [[{ id: 'w1', type: 'lights' }]] });
    const c = web.save({ name: 'Garden', columns: [[]] });
    tileNames.set(`web-${a.id}-w1`, 'd1', 'Porch');
    tileNames.set(`web-${b.id}-w1`, 'd1', 'Hob');
    const backup = await api.getWebBackup({ homey, query: { ids: `${c.id},${a.id},nope` } });
    expect(backup.dashboards.map(d => d.name)).toEqual(['Hall', 'Garden']); // in their stored order
    expect(backup.tileNames).toEqual({ [`web-${a.id}-w1`]: { d1: 'Porch' } });
    expect((await api.getWebBackup({ homey, query: { ids: '' } })).dashboards).toEqual([]);
    expect((await api.getWebBackup({ homey })).dashboards).toHaveLength(3);
  });

  it('restores one dashboard in place and leaves the others, their names and the front page as they are', () => {
    const { homey, web, tileNames } = setup();
    const a = web.save({ name: 'Hall', columns: [[{ id: 'w1', type: 'lights' }]] });
    const b = web.save({ name: 'Kitchen', columns: [[{ id: 'w1', type: 'lights' }]] });
    web.saveFront({ widgets: false });
    tileNames.set(`web-${a.id}-w1`, 'd1', 'Porch');
    tileNames.set(`web-${b.id}-w1`, 'd1', 'Hob');
    const backup = web.backup([a.id]);

    web.save({ ...a, name: 'Hall, broken', columns: [[{ id: 'w2', type: 'timers' }]] });
    tileNames.set(`web-${a.id}-w1`, 'd1', 'Wrong');
    tileNames.set(`web-${a.id}-w2`, 'x', 'Gone');
    tileNames.set(`web-${b.id}-w1`, 'd1', 'Oven');
    const realtime = homey.api.realtime as any;
    realtime.mockClear();
    expect(web.restore({ ...backup, front: { widgets: true } })).toEqual({ dashboards: 1, widgets: 1, skipped: 0 });
    expect(web.list().map(d => d.name)).toEqual(['Hall', 'Kitchen']);
    expect(web.list()[0]).toEqual(backup.dashboards[0]);
    expect(web.front()).toEqual({ widgets: false, sections: [] }); // not `complete`
    expect(tileNames.get(`web-${a.id}-w1`).names).toEqual({ d1: 'Porch' });
    expect(tileNames.get(`web-${a.id}-w2`).names).toEqual({});
    expect(tileNames.get(`web-${b.id}-w1`).names).toEqual({ d1: 'Oven' });
    expect(realtime.mock.calls.map((c: any[]) => c[1].instance).sort()).toEqual([`web-${a.id}-w1`, `web-${a.id}-w2`]);

    // A dashboard deleted since comes back at the end.
    web.remove(a.id);
    expect(web.restore(backup)).toEqual({ dashboards: 1, widgets: 1, skipped: 0 });
    expect(web.list().map(d => d.name)).toEqual(['Kitchen', 'Hall']);
  });

  it('is for the web dashboards page: refused while they are off, and needs the session while a password is set', async () => {
    const off = setup({}, false);
    await expect(api.getWebBackup({ homey: off.homey })).rejects.toThrow(/turned off/);
    await expect(api.putWebBackup({ homey: off.homey, body: off.web.backup() })).rejects.toThrow(/turned off/);
    const { homey, web } = setup();
    web.save({ name: 'Hall', columns: [[]] });
    await homey.app.webPassword.setPassword('correct horse');
    await expect(api.getWebBackup({ homey })).rejects.toThrow(/password required/);
    await expect(api.putWebBackup({ homey, body: web.backup() })).rejects.toThrow(/password required/);
    const { token } = await homey.app.webPassword.login('correct horse');
    expect((await api.getWebBackup({ homey, query: { session: token } })).dashboards).toHaveLength(1);
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

  /** The Homey's own address and id (`homey.cloud`), which the fake Homey lacks. */
  function withCloud(homey: any) {
    homey.cloud = { getLocalAddress: async () => '192.168.1.20:80', getHomeyId: async () => 'abc123' };
    return homey;
  }

  it('refuses the page away from home (?away=1) until remote access is on', async () => {
    const { homey, web } = setup();
    withCloud(homey);
    web.save({ name: 'Kept', columns: [[]] });
    const away = { away: '1' };
    const res = await api.getWebSetup({ homey, query: away });
    expect(res).toMatchObject({ disabled: true, away: true });
    expect(res).not.toHaveProperty('dashboards');
    expect((res as any).strings.web.offAway).toBeTruthy();
    await expect(api.getWebDevices({ homey, query: { type: 'lights', ...away } })).rejects.toThrow(/turned off away from home/);
    await expect(api.postWebLogin({ homey, query: away, body: { password: 'x' } })).rejects.toThrow(/turned off/);
    // At home it works as before, with the limit the page keeps to.
    await expect(api.getWebSetup({ homey, query: {} })).resolves.toMatchObject({ dashboards: expect.any(Array), maxDashboards: MAX_DASHBOARDS });
    expect(web.describe()).toMatchObject({ enabled: true, remote: false });
    homey.settings.set(WEB_REMOTE_SETTING, true);
    await expect(api.getWebSetup({ homey, query: away })).resolves.toHaveProperty('dashboards');
    await expect(api.getWebDevices({ homey, query: { type: 'lights', ...away } })).resolves.toBeTruthy();
  });

  it("gives the settings page both addresses: the home network's and Homey's cloud relay's", async () => {
    const { homey } = setup();
    withCloud(homey);
    const page = `/app/${(homey.manifest as any).id}/settings/dashboard.html`;
    expect(await api.getWebAddress({ homey })).toEqual({
      url: `http://192.168.1.20${page}`,
      remoteUrl: `https://abc123.connect.athom.com${page}`,
    });
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

  it("keeps Keep screen on's silent video a small MP4", () => {
    const js = readFileSync('settings/dashboard.js', 'utf8');
    const m = js.match(/const KEEP_AWAKE_VIDEO = 'data:video\/mp4;base64,([A-Za-z0-9+/=]+)';/);
    expect(m).toBeTruthy();
    const mp4 = Buffer.from(m![1], 'base64');
    expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(mp4.length).toBeLessThan(4096);
  });

  it('bundles the socket.io-client version installed', () => {
    const { version } = JSON.parse(readFileSync('node_modules/socket.io-client/package.json', 'utf8'));
    expect(readFileSync('settings/socket.io.js', 'utf8').slice(0, 200)).toContain(`socket.io-client ${version} `);
  });

  // dev/mock-web-api.js answers the dev pages' /web/setup with its own copy of the editor's sections.
  it("the dev mock's settingSections() agrees with the app's on every widget's settings in every language", () => {
    const mock = new Function(`${readFileSync('dev/mock-web-api.js', 'utf8')}
return mockSettingSections;`)();
    for (const [type, widget] of Object.entries<any>(app.widgets)) {
      for (const lang of ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar']) {
        expect(mock(widget.settings || [], lang), `${type} (${lang})`).toEqual(settingSections(widget.settings || [], lang));
      }
    }
  });
});

describe('web dashboards: popups (wk-084)', () => {
  it('lists, pictures and answers popups for the page, like its other routes', async () => {
    const { homey } = setup();
    homey.cloud = { getHomeyId: async () => 'homey-id' };
    const asked = homey.app.popups.ask({ target: 'all', text: 'Open the garage?', seconds: 30 });
    await new Promise(r => setTimeout(r, 0));
    const listed = await api.getWebPopups({ homey, query: {} });
    expect(listed.popups.map((p: any) => p.text)).toEqual(['Open the garage?']);
    expect((await api.getWebSetup({ homey, query: {} })).popups!.popups).toHaveLength(1);
    const { id } = listed.popups[0];
    await expect(api.getWebPopupImage({ homey, query: {}, params: { id } })).rejects.toThrow('Not found'); // no picture
    expect(await api.postWebPopupAnswer({ homey, query: {}, params: { id }, body: { answer: true } })).toEqual({ ok: true, answer: true });
    await expect(asked).resolves.toEqual({ answer: true, answered: true });
    // Turned off, the page's routes refuse as the rest do.
    const off = setup({}, false);
    await expect(api.getWebPopups({ homey: off.homey, query: {} })).rejects.toThrow(/turned off/);
    await expect(api.postWebPopupAnswer({ homey: off.homey, query: {}, params: { id }, body: { answer: true } })).rejects.toThrow(/turned off/);
  });

  it('lets the prompt page in with the popup token only, web dashboards on or off', async () => {
    const { homey } = setup({}, false);
    await homey.app.popups.show({ target: 'name:hall', text: 'Dinner', seconds: 30 });
    const { id, token } = homey.app.popups.forScreen('hall').popups[0];
    const page = await api.postPopup({ homey, params: { id }, body: { t: token, strings: true } });
    expect(page).toMatchObject({ closed: false, kind: 'message', text: 'Dinner', language: 'en' });
    expect((page as any).strings.yes).toBe('Yes');
    // A poll: how it stands, without the strings.
    const poll = await api.postPopup({ homey, params: { id }, body: { t: token } });
    expect(poll).toMatchObject({ closed: false, text: 'Dinner' });
    expect(poll).not.toHaveProperty('strings');
    await expect(api.postPopup({ homey, params: { id }, body: { t: 'nope' } })).rejects.toThrow('Not found');
    await expect(api.postPopup({ homey, params: { id }, body: {} })).rejects.toThrow('Not found');
    await expect(api.postPopupImage({ homey, params: { id }, body: {} })).rejects.toThrow('Not found');
    await expect(api.postPopupAnswer({ homey, params: { id }, body: { answer: true } })).rejects.toThrow('Not found');
  });

  it('marks exactly the prompt page routes public', () => {
    const publicRoutes = Object.entries(app.api).filter(([, r]: [string, any]) => r.public).map(([name]) => name).sort();
    expect(publicRoutes).toEqual(['postPopup', 'postPopupAnswer', 'postPopupImage']);
  });
});

describe("web dashboards: a device change needs the page's own key to control devices", () => {
  /** Routes that change something, but neither with the stored key nor on a device (app data, logs, a video stream). */
  const NEUTRAL = new Set([
    'cameras POST /video/offer', 'cameras POST /video/keepalive', 'cameras POST /report', 'media POST /report',
    'timers POST /start', 'timers POST /action', 'dayssince POST /reset', 'dayssince POST /undo',
  ]);

  // A device change left out of DEVICE_WRITES would let a page whose key may not control devices do it with the app's token.
  it('classifies every route that changes something: the stored key, a device, or neither', () => {
    const unclassified: string[] = [];
    const routes = new Set<string>();
    for (const [id, w] of Object.entries(app.widgets) as [string, any][]) {
      for (const r of Object.values(w.api ?? {}) as { method: string, path: string }[]) {
        const route = `${id} ${r.method} ${r.path}`;
        routes.add(route);
        if (r.method === 'GET' || r.path === '/names' || route === 'stack POST /call') continue;
        if (!routeKeyUse(id, r.method, r.path, { id: '' }) && !DEVICE_WRITES.includes(route) && !NEUTRAL.has(route)) unclassified.push(route);
      }
    }
    expect(unclassified).toEqual([]);
    for (const route of [...DEVICE_WRITES, ...NEUTRAL]) expect(routes).toContain(route);
    expect(pageKeyUse('locks', 'POST', '/open', {})).toBe('devices');
    expect(pageKeyUse('flows', 'POST', '/trigger', {})).toBe('flows');
    expect(pageKeyUse('timers', 'POST', '/start', {})).toBe(null);
    expect(pageKeyUse('stack', 'POST', '/call', { type: 'locks', method: 'POST', path: '/open' })).toBe('devices');
    expect(pageKeyUse('stack', 'POST', '/call', { type: 'media', method: 'POST', path: '/button', body: { id: 'card:x' } })).toBe('cards');
  });

  it("refuses a device change unless the page's own key may control devices", async () => {
    const { homey } = setup();
    const open = vi.fn(async () => undefined);
    const set = vi.fn(async () => undefined);
    const trigger = vi.fn(async () => undefined);
    homey.app.locks = { open, set };
    homey.app.quickActions = { trigger };
    homey.app.apiKey = new PersonalApiKey(homey, vi.fn());
    keyApis.set('apps-only', { sessions: { getSessionMe: async () => ({ scopes: ['homey.app.control'] }) } });
    keyApis.set('devices', { sessions: { getSessionMe: async () => ({ scopes: ['homey.device.control'] }) } });
    keyApis.set('full', { sessions: { getSessionMe: async () => ({ scopes: ['homey'] }) } });
    const call = (type: string, path: string, body: object, key?: string) =>
      api.postWebCall({ homey, body: { type, method: 'POST', path, body, key } });
    const lock = { deviceId: 'd', capabilityId: 'open_lock' };
    await expect(call('locks', '/open', lock, 'apps-only')).rejects.toThrow(/may not change devices \(keyScope\)/);
    await expect(call('locks', '/open', lock)).rejects.toThrow(/may not change devices \(keyInvalid\)/);
    await expect(call('locks', '/open', lock, 'nope')).rejects.toThrow(/keyInvalid/);
    await expect(call('quickactions', '/trigger', { deviceId: 'd' }, 'apps-only')).rejects.toThrow(/keyScope/);
    // Through a Smart Stack on the page too; a stack inside a stack isn't a route at all.
    await expect(call('stack', '/call', { type: 'locks', method: 'POST', path: '/open', body: lock }, 'apps-only')).rejects.toThrow(/keyScope/);
    await expect(call('stack', '/call', { type: 'stack', method: 'POST', path: '/call', body: { type: 'locks', method: 'POST', path: '/open', body: lock } }, 'apps-only'))
      .rejects.toThrow(/Not a widget route/);
    expect(open).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    await expect(call('locks', '/open', lock, 'devices')).resolves.toEqual({ ok: true });
    await expect(call('stack', '/call', { type: 'locks', method: 'POST', path: '/set', body: { deviceId: 'd', capabilityId: 'locked', value: false } }, 'full'))
      .resolves.toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith('d', 'open_lock');
    expect(set).toHaveBeenCalledWith('d', 'locked', false);
    for (const k of ['apps-only', 'devices', 'full']) keyApis.delete(k);
  });
});

describe('web dashboards: autocompletes by their own names only', () => {
  it("refuses a setting name that's only an object's property", async () => {
    const listener = vi.fn(async () => [{ name: 'One', id: '1' }]);
    const { homey, web } = setup({ values: { slot1: listener } });
    for (const setting of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      await expect(web.autocomplete('values', setting, 'q', {})).rejects.toThrow(/No autocomplete/);
      await expect(api.postWebAutocomplete({ homey, query: {}, body: { type: 'values', setting, query: 'q' } })).rejects.toThrow(/No autocomplete/);
    }
    expect(listener).not.toHaveBeenCalled();
  });
});
