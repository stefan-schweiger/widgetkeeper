// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

const IDS = ['lights', 'curtains', 'quickactions', 'sensoralarms', 'values', 'sparklines', 'locks', 'cameras', 'variables', 'roomhealth', 'valuematrix'] as const;

let win: any;
beforeAll(() => {
  for (const id of IDS) { win = loadWidget(id); loadMount(id); }
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); document.head.innerHTML = ''; document.body.innerHTML = ''; });

const cap = (value: unknown) => ({ value, setable: true, lastUpdated: Date.now() });
const valueCap = { title: 'Temperature', type: 'number', units: '°C', decimals: 1, min: null, max: null, values: null, icon: null };
const value = (deviceId: string, name: string) => ({ deviceId, capabilityId: 'measure_temperature', name, capability: valueCap, value: 21 });

/** Per widget: how it's made, two tiles (`a` and `b`, keyed `keys`), the same with `a` missing, and its name element. */
const CASES: Record<typeof IDS[number], { create: string, state: any, gone: any, keys: string[], name: string, opts?: object }> = {
  lights: {
    create: 'createLightsWidget', name: '.lc-name', keys: ['a', 'b'],
    state: ['a', 'b'].map(id => ({ id, name: `Lamp ${id}`, icon: null, zone: null, caps: { onoff: cap(false), dim: cap(0.5) } })),
    gone: [{ id: 'a', missing: true }, { id: 'b', name: 'Lamp b', icon: null, zone: null, caps: { onoff: cap(false), dim: cap(0.5) } }],
  },
  curtains: {
    create: 'createCurtainsWidget', name: '.ct-name', keys: ['a', 'b'],
    state: ['a', 'b'].map(id => ({ id, name: `Curtain ${id}`, kind: 'curtain', zone: null, caps: { windowcoverings_set: cap(0) } })),
    gone: [{ id: 'a', missing: true }, { id: 'b', name: 'Curtain b', kind: 'curtain', zone: null, caps: { windowcoverings_set: cap(0) } }],
  },
  quickactions: {
    create: 'createQuickActionsWidget', name: '.qa-name', keys: ['a', 'b'],
    state: ['a', 'b'].map(id => ({ id, name: `Lamp ${id}`, icon: null, quickAction: { capabilityId: 'onoff', value: false, actionable: true, momentary: false, icon: null } })),
    gone: [{ id: 'a', missing: true }, { id: 'b', name: 'Lamp b', icon: null, quickAction: { capabilityId: 'onoff', value: false, actionable: true, momentary: false, icon: null } }],
  },
  sensoralarms: {
    create: 'createSensorAlarmsWidget', name: '.sa-name', keys: ['a', 'b'],
    state: ['a', 'b'].map(id => ({ id, name: `Sensor ${id}`, icon: null, alarms: [] })),
    gone: [{ id: 'a', missing: true }, { id: 'b', name: 'Sensor b', icon: null, alarms: [] }],
  },
  values: {
    create: 'createValuesWidget', name: '.vt-name', keys: ['a:measure_temperature', 'b:measure_temperature'],
    state: [value('a', 'Fridge'), value('b', 'Freezer')],
    gone: [{ deviceId: 'a', capabilityId: 'measure_temperature', missing: true }, value('b', 'Freezer')],
  },
  sparklines: {
    create: 'createSparklinesWidget', name: '.sl-name', keys: ['a:measure_temperature', 'b:measure_temperature'], opts: { now: () => Date.now() },
    state: [{ ...value('a', 'Fridge'), points: [] }, { ...value('b', 'Freezer'), points: [] }],
    gone: [{ deviceId: 'a', capabilityId: 'measure_temperature', missing: true }, { ...value('b', 'Freezer'), points: [] }],
  },
  locks: {
    create: 'createLocksWidget', name: '.lk-name', keys: ['a', 'b'], opts: { view: 'list' },
    state: { devices: ['a', 'b'].map(id => ({ id, name: `Door ${id}`, icon: null, caps: { locked: cap(true) } })), language: 'en' },
    gone: { devices: [{ id: 'a', missing: true }, { id: 'b', name: 'Door b', icon: null, caps: { locked: cap(true) } }], language: 'en' },
  },
  cameras: {
    create: 'createCamerasWidget', name: '.cw-name', keys: ['a', 'b'], opts: { api: vi.fn(() => new Promise(() => {})) },
    state: ['a', 'b'].map(id => ({ id, name: `Cam ${id}`, icon: null, image: null, video: null, videos: [], h265: [] })),
    gone: [{ id: 'a', missing: true }, { id: 'b', name: 'Cam b', icon: null, image: null, video: null, videos: [], h265: [] }],
  },
  variables: {
    create: 'createVariablesWidget', name: '.vr-name', keys: ['a', 'b'],
    state: ['a', 'b'].map(id => ({ id, name: `Flag ${id}`, type: 'boolean', value: false })),
    gone: [{ id: 'a', missing: true }, { id: 'b', name: 'Flag b', type: 'boolean', value: false }],
  },
  roomhealth: {
    // Sensors without a zone are rooms of their own, keyed by the device, so a missing one keeps its cell.
    create: 'createRoomHealthWidget', name: '.rh-name', keys: ['a', 'b'],
    state: ['a', 'b'].map(id => ({ id, name: `Sensor ${id}`, zone: null, measures: { temperature: { capabilityId: 'measure_temperature', value: 21 } } })),
    gone: [{ id: 'a', missing: true }, { id: 'b', name: 'Sensor b', zone: null, measures: { temperature: { capabilityId: 'measure_temperature', value: 21 } } }],
  },
  valuematrix: {
    // Devices without a zone are rows of their own, keyed by the device, so a missing one keeps its row.
    create: 'createValueMatrixWidget', name: '.vm-name', keys: ['a', 'b'], opts: { columns: [{ capabilityId: 'measure_temperature' }] },
    state: { columns: [], devices: ['a', 'b'].map(id => ({ id, name: `Sensor ${id}`, zone: null, values: { measure_temperature: 21 } })) },
    gone: { columns: [], devices: [{ id: 'a', missing: true }, { id: 'b', name: 'Sensor b', zone: null, values: { measure_temperature: 21 } }] },
  },
};

function mount(id: typeof IDS[number], opts: object = {}) {
  const c = CASES[id];
  const root = document.createElement('div');
  document.body.append(root);
  const w = win[c.create](root, { ...c.opts, ...opts });
  w.setState(c.state);
  const names = () => [...root.querySelectorAll<HTMLElement>(c.name)].map(n => n.textContent);
  const fields = () => [...root.querySelectorAll<HTMLInputElement>('.wk-rename')];
  return { w, root, names, fields, c };
}

describe.each(IDS)('tile names fixes: %s', (id) => {
  it('a failed save keeps a newer name that came meanwhile', async () => {
    let fail: (err: Error) => void = () => {};
    const onRename = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
    const { w, fields, names, c } = mount(id, { renameTiles: true, onRename });
    fields()[0].value = 'Mine';
    fields()[0].dispatchEvent(new Event('change'));
    expect(names()[0]).toBe('Mine');
    // Another screen renamed it while this save was on its way.
    w.setNames({ [c.keys[0]]: 'Theirs' });
    fail(new Error('offline'));
    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();
    expect(names()[0]).toBe('Theirs');
  });

  it('a failed save keeps its name when the app sent that name meanwhile (only the answer was lost)', async () => {
    let fail: (err: Error) => void = () => {};
    const onRename = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
    const { w, fields, names, c } = mount(id, { renameTiles: true, onRename });
    w.setNames({ [c.keys[0]]: 'Old' });
    fields()[0].value = 'Mine';
    fields()[0].dispatchEvent(new Event('change'));
    // The app saved it (its realtime event came), but the answer to this save never arrived.
    w.setNames({ [c.keys[0]]: 'Mine' });
    fail(new Error('timeout'));
    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();
    expect(names()[0]).toBe('Mine');
  });

  it('a failed save puts the old name back while nothing newer came', async () => {
    let fail: (err: Error) => void = () => {};
    const onRename = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
    const { w, fields, names, c } = mount(id, { renameTiles: true, onRename });
    w.setNames({ [c.keys[0]]: 'Old' });
    fields()[0].value = 'Mine';
    fields()[0].dispatchEvent(new Event('change'));
    fail(new Error('offline'));
    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();
    expect(names()[0]).toBe('Old');
  });

  it('hides the rename field of a tile whose device went missing', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(`widgets/${id}/public/widget.css`, 'utf8');
    document.head.append(style);
    const { w, root, fields, c } = mount(id, { renameTiles: true, onRename: vi.fn(async () => {}) });
    expect(fields()).toHaveLength(2);
    w.setState(c.gone);
    const shown = fields().filter(f => root.contains(f) && getComputedStyle(f).display !== 'none');
    expect(shown.map(f => f.placeholder)).toEqual([fields()[1].placeholder]);
  });

  it('reads the names with /state, in one request', async () => {
    const c = CASES[id];
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    document.body.append(frame);
    const api = vi.fn(async (method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/state?')) return { state: c.state, tileNames: { [c.keys[1]]: 'Typed' } };
      return new Promise(() => {}); // snapshots and the like: never answered here
    });
    const Homey = {
      api, on: vi.fn(), ready: vi.fn(), setHeight: vi.fn(), hapticFeedback: vi.fn(),
      getSettings: () => ({ view: 'list', slot1: { id: c.keys[0] }, slot2: { id: c.keys[1] }, col1: { id: 'measure_temperature' } }),
      getDeviceIds: () => ['a', 'b'],
      getWidgetInstanceId: () => 'w1',
      __: (key: string) => key,
    };
    const mountName = readFileSync(`widgets/${id}/public/mount.js`, 'utf8').match(/window\.(mount\w+Widget) =/)![1];
    (window as any)[mountName](Homey, { root, frame });
    await vi.advanceTimersByTimeAsync(10);
    expect(api.mock.calls.filter(([method, path]) => method === 'GET' && /^\/(state|names)\?/.test(path)).map(([, path]) => path.replace(/\?.*&instance=/, '?…&instance=')))
      .toEqual(['/state?…&instance=w1']);
    expect([...root.querySelectorAll(c.name)].map(n => n.textContent)).toContain('Typed');
  });

  it('mounts when getWidgetInstanceId throws, and keeps the names under `default`', async () => {
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    document.body.append(frame);
    const api = vi.fn(async (_method: string, _path: string) => {
      throw new Error('offline');
    });
    const Homey = {
      api, on: vi.fn(), ready: vi.fn(), setHeight: vi.fn(), hapticFeedback: vi.fn(),
      getSettings: () => ({ renameTiles: true, slot1: { id: 'd1:measure_temperature' }, col1: { id: 'measure_temperature' } }),
      getDeviceIds: () => ['d1'],
      getWidgetInstanceId: () => { throw new Error('not here'); },
      __: (key: string) => key,
    };
    const mountName = readFileSync(`widgets/${id}/public/mount.js`, 'utf8').match(/window\.(mount\w+Widget) =/)![1];
    expect(() => (window as any)[mountName](Homey, { root, frame })).not.toThrow();
    await vi.advanceTimersByTimeAsync(2000);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    expect(api.mock.calls.some(([method, path]) => method === 'GET' && path.startsWith('/state?') && path.endsWith('&instance=default'))).toBe(true);
  });
});

