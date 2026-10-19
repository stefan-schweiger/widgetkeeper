// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => {
  for (const id of ['lights', 'curtains', 'quickactions', 'sensoralarms', 'values', 'sparklines', 'locks', 'cameras', 'variables', 'roomhealth', 'valuematrix', 'shortcuts'] as const) win = loadWidget(id);
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const cap = (value: unknown) => ({ value, setable: true, lastUpdated: Date.now() });
const living = { id: 'z1', name: 'Living room' };
const light = (id: string, name: string) => ({ id, name, icon: null, zone: living, caps: { onoff: cap(false), dim: cap(0.5) } });
const valueCap = { title: 'Temperature', type: 'number', units: '°C', decimals: 1, min: null, max: null, values: null, icon: null };
const value = (deviceId: string, name: string) => ({ deviceId, capabilityId: 'measure_temperature', name, capability: valueCap, value: 21 });
const roomSensor = (id: string, zone: string, room: string, measures: object = { temperature: { capabilityId: 'measure_temperature', value: 21 } }) =>
  ({ id, name: `Sensor ${id}`, zone: { id: zone, name: room }, measures });

/**
 * Per widget: how it's made, the state it gets (two tiles: `a` and `b`, or a grouped room), the tile keys, the
 * element that shows a tile's name, and the tap that would act on the tile (`act`, called through the spy).
 */
const CASES: Record<string, { create: string, state: any, keys: string[], own: string[], name: string, opts?: object, tile: string, act: string }> = {
  lights: {
    create: 'createLightsWidget', state: [light('a', 'Lamp'), light('b', 'Spot')], opts: { groupByZone: true },
    keys: ['zone:z1'], own: ['Living room'], name: '.lc-name', tile: '.lc-tile', act: 'onSet',
  },
  curtains: {
    create: 'createCurtainsWidget', act: 'onSet', tile: '.ct-tile', name: '.ct-name',
    state: ['a', 'b'].map(id => ({ id, name: `Curtain ${id}`, kind: 'curtain', zone: null, caps: { windowcoverings_set: cap(0) } })),
    keys: ['a', 'b'], own: ['Curtain a', 'Curtain b'],
  },
  quickactions: {
    create: 'createQuickActionsWidget', act: 'onTrigger', tile: '.qa-tile', name: '.qa-name',
    state: ['a', 'b'].map(id => ({ id, name: `Lamp ${id}`, icon: null, quickAction: { capabilityId: 'onoff', value: false, actionable: true, momentary: false, icon: null } })),
    keys: ['a', 'b'], own: ['Lamp a', 'Lamp b'],
  },
  sensoralarms: {
    create: 'createSensorAlarmsWidget', act: '', tile: '.sa-tile', name: '.sa-name',
    state: ['a', 'b'].map(id => ({ id, name: `Sensor ${id}`, icon: null, alarms: [] })),
    keys: ['a', 'b'], own: ['Sensor a', 'Sensor b'],
  },
  values: {
    create: 'createValuesWidget', act: '', tile: '.vt-tile', name: '.vt-name',
    // The same value twice: the second tile's key is `#2`, whatever its position.
    state: [value('a', 'Fridge'), value('a', 'Fridge')], keys: ['a:measure_temperature', 'a:measure_temperature#2'], own: ['Fridge', 'Fridge'],
  },
  sparklines: {
    create: 'createSparklinesWidget', act: '', tile: '.sl-tile', name: '.sl-name', opts: { now: () => Date.now() },
    state: [{ ...value('a', 'Fridge'), points: [] }, { ...value('b', 'Freezer'), points: [] }],
    keys: ['a:measure_temperature', 'b:measure_temperature'], own: ['Fridge', 'Freezer'],
  },
  locks: {
    create: 'createLocksWidget', act: 'onSet', tile: '.lk-row', name: '.lk-name', opts: { view: 'list' },
    state: { devices: ['a', 'b'].map(id => ({ id, name: `Door ${id}`, icon: null, caps: { locked: cap(false) } })), language: 'en' },
    keys: ['a', 'b'], own: ['Door a', 'Door b'],
  },
  cameras: {
    create: 'createCamerasWidget', act: '', tile: '.cw-tile', name: '.cw-name', opts: { api: vi.fn(() => new Promise(() => {})) },
    state: ['a', 'b'].map(id => ({ id, name: `Cam ${id}`, icon: null, image: null, video: null, videos: [], h265: [] })),
    keys: ['a', 'b'], own: ['Cam a', 'Cam b'],
  },
  variables: {
    create: 'createVariablesWidget', act: 'onSet', tile: '.vr-row', name: '.vr-name',
    // The same variable twice, as Device Values: the second row's key is `#2`.
    state: [{ id: 'a', name: 'Guests', type: 'boolean', value: false }, { id: 'a', name: 'Guests', type: 'boolean', value: false }],
    keys: ['a', 'a#2'], own: ['Guests', 'Guests'],
  },
  roomhealth: {
    create: 'createRoomHealthWidget', act: '', tile: '.rh-room', name: '.rh-name',
    // A cell per room: the key is the zone's.
    state: [roomSensor('a', 'z1', 'Living room'), roomSensor('b', 'z2', 'Kitchen')], keys: ['zone:z1', 'zone:z2'], own: ['Living room', 'Kitchen'],
  },
  valuematrix: {
    create: 'createValueMatrixWidget', act: '', tile: '.vm-row:not(.vm-head)', name: '.vm-name', opts: { columns: [{ capabilityId: 'measure_temperature' }] },
    // A row per room: the key is the zone's.
    state: { columns: [], devices: [['a', 'z1', 'Living room'], ['b', 'z2', 'Kitchen']].map(([id, zone, room]) => ({ id, name: `Sensor ${id}`, zone: { id: zone, name: room }, values: { measure_temperature: 21 } })) },
    keys: ['zone:z1', 'zone:z2'], own: ['Living room', 'Kitchen'],
  },
  shortcuts: {
    create: 'createShortcutsWidget', act: 'onOpen', tile: '.sc-row', name: '.sc-name', opts: { tiles: [{ id: 'a' }, { id: 'b' }] },
    // A pill per web dashboard: the key is the dashboard's id.
    state: { current: null, tiles: [{ id: 'a', name: 'Lights' }, { id: 'b', name: 'Sensors' }] }, keys: ['a', 'b'], own: ['Lights', 'Sensors'],
  },
};

function mount(id: string, opts: object = {}) {
  const c = CASES[id];
  const root = document.createElement('div');
  document.body.append(root);
  const spy = vi.fn(async () => {});
  const w = win[c.create](root, { ...c.opts, ...(c.act ? { [c.act]: spy } : {}), ...opts });
  w.setState(c.state);
  const names = () => [...root.querySelectorAll<HTMLElement>(c.name)].map(n => n.textContent);
  const fields = () => [...root.querySelectorAll<HTMLInputElement>('.wk-rename')];
  const tiles = () => [...root.querySelectorAll<HTMLElement>(c.tile)];
  return { w, root, names, fields, tiles, spy, c };
}

describe.each(Object.keys(CASES))('tile names: %s', (id) => {
  it('shows the typed names, and the own names without one', () => {
    const { w, names, fields, c } = mount(id);
    expect(names()).toEqual(c.own);
    expect(fields()).toHaveLength(0);
    w.setNames({ [c.keys[c.keys.length - 1]]: 'Typed' });
    expect(names()).toEqual([...c.own.slice(0, -1), 'Typed']);
    w.setNames({});
    expect(names()).toEqual(c.own);
  });

  it('renames on the tiles: a field per tile, saved on change, and taps do nothing meanwhile', async () => {
    const onRename = vi.fn(async () => {});
    const { w, root, fields, tiles, names, spy, c } = mount(id, { renameTiles: true, onRename });
    expect(root.classList.contains('renaming')).toBe(true);
    w.setNames({ [c.keys[0]]: 'Sofa lights' });
    expect(fields().map(f => f.placeholder)).toEqual(c.own);
    expect(fields()[0].value).toBe('Sofa lights');

    const last = fields()[fields().length - 1];
    last.value = '  Reading  ';
    last.dispatchEvent(new Event('change'));
    expect(onRename).toHaveBeenLastCalledWith(c.keys[c.keys.length - 1], 'Reading');
    expect(names()[names().length - 1]).toBe('Reading');

    fields()[0].value = '';
    fields()[0].dispatchEvent(new Event('change'));
    expect(onRename).toHaveBeenLastCalledWith(c.keys[0], '');

    // A tap on the tile, or on the field, does nothing to the device.
    for (const target of [tiles()[0], fields()[0]]) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    expect(root.querySelector('.sa-panel:not([style*="none"]) .sa-row')).toBeNull();
  });

  it.runIf(!!CASES[id].act && id !== 'locks')('acts on a tap outside rename mode (so the check above means something)', () => {
    const { tiles, spy } = mount(id);
    tiles()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });

  it('puts the name back when it could not be saved', async () => {
    const onRename = vi.fn(async () => { throw new Error('offline'); });
    const { fields, names, c } = mount(id, { renameTiles: true, onRename });
    fields()[0].value = 'Nope';
    fields()[0].dispatchEvent(new Event('change'));
    await vi.runAllTicks();
    await Promise.resolve();
    expect(names()[0]).toBe(c.own[0]);
  });

  it('Escape puts the field back without saving', () => {
    const onRename = vi.fn(async () => {});
    const { fields } = mount(id, { renameTiles: true, onRename });
    const field = fields()[0];
    field.focus();
    field.value = 'Half typed';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(field.value).toBe('');
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe('tile names in context', () => {
  it('Locks and Doors: the summary uses the typed name', () => {
    const { w, root } = mount('locks', { view: 'summary' });
    w.setNames({ a: 'Shed' });
    expect(root.querySelector('.lk-sub')!.textContent).toBe('Shed, Door b');
  });

  it('Device Values: the names stay with the value when the slots are reordered', () => {
    const { w, names } = mount('values');
    w.setState([value('a', 'Fridge'), value('b', 'Freezer')]);
    w.setNames({ 'b:measure_temperature': 'Ice' });
    expect(names()).toEqual(['Fridge', 'Ice']);
    w.setState([value('b', 'Freezer'), value('a', 'Fridge')]);
    expect(names()).toEqual(['Ice', 'Fridge']);
  });

  it("Room Health: a room's label uses the typed name", () => {
    const { w, root } = mount('roomhealth');
    w.setState([roomSensor('a', 'z1', 'Living room', { co2: { capabilityId: 'measure_co2', value: 1400 } })]);
    w.setNames({ 'zone:z1': 'Lounge' });
    expect(root.querySelector('.rh-room')!.getAttribute('aria-label')).toMatch(/^Lounge: Stuffy, /);
  });

  it('Light Controls: two widgets grouping the same room each keep their own name', () => {
    const one = mount('lights');
    const two = mount('lights');
    one.w.setNames({ 'zone:z1': 'Sofa lights' });
    expect(one.names()).toEqual(['Sofa lights']);
    expect(two.names()).toEqual(['Living room']);
  });
});
