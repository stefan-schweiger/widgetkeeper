// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('lightrooms'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const cap = (value: unknown) => ({ value, setable: true });
const kitchen = { id: 'z1', name: 'Kitchen' };
const living = { id: 'z2', name: 'Living room' };
const lamp = (id: string, zone: any, on = true, dim = 0.5, extra: object = {}) => ({
  id, name: `Lamp ${id}`, icon: null, zone, caps: { onoff: cap(on), dim: cap(dim), ...extra },
});
const temp = { light_temperature: cap(0.7), light_mode: cap('temperature') };
const hue = { light_hue: cap(220 / 360), light_saturation: cap(1), light_mode: cap('color') };

/** k1, k2 in the Kitchen (k1 on at 40 %, k2 off), l1 in the Living room (off; colour), a plug without a room, a missing one. */
const house = () => [
  lamp('k1', kitchen, true, 0.4, temp),
  lamp('l1', living, false, 0.6, { ...temp, ...hue }),
  lamp('k2', kitchen, false, 0.8),
  { id: 'plug', name: 'Plug', icon: null, zone: null, caps: { onoff: cap(true) } },
  { id: 'gone', missing: true },
];

function widget(devices: any[] = house(), opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSet = vi.fn(async () => {});
  const onMood = vi.fn(async () => {});
  const w = win.createLightRoomsWidget(root, { onSet, onMood, ...opts });
  w.setState(devices, { z1: 'data:image/svg+xml;base64,AA==' });
  const room = (key: string) => root.querySelector<HTMLElement>(`.lr-room[data-room="${key}"]`)!;
  const row = (id: string) => root.querySelector<HTMLElement>(`.lr-row[data-device="${id}"]`)!;
  const state = (key: string) => room(key).querySelector('.lr-state')!.textContent;
  const click = (node: Element) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const head = (key: string) => click(room(key).querySelector('.lr-head')!);
  /** A mouse press and release on a bar at `fraction` of its width (the bar is 100 px wide at x 0). */
  const barAt = (bar: HTMLElement, fraction: number) => {
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 28, right: 100, bottom: 28 }) as DOMRect;
    const ev = (type: string) => new win.PointerEvent(type, { pointerType: 'mouse', clientX: fraction * 100, bubbles: true });
    bar.dispatchEvent(ev('pointerdown'));
    bar.dispatchEvent(ev('pointerup'));
    click(bar);
  };
  return { w, root, room, row, state, click, head, barAt, onSet, onMood };
}

describe('rooms', () => {
  it('groups the lights by room in the order of their first light, the rest in Other last', () => {
    const { root, state } = widget();
    expect([...root.querySelectorAll('.lr-room')].map(r => (r as HTMLElement).dataset.room)).toEqual(['zone:z1', 'zone:z2', 'other']);
    expect([...root.querySelectorAll('.lr-name')].map(n => n.textContent)).toEqual(['Kitchen', 'Living room', 'Other']);
    expect(state('zone:z1')).toBe('1 of 2 on · 40%');
    expect(state('zone:z2')).toBe('Off');
    // A light without brightness: no percentage.
    expect(state('other')).toBe('All on');
  });

  it("shows the room's icon, a fallback without one", () => {
    const { room } = widget();
    expect(room('zone:z1').querySelector('.lr-icon')!.classList.contains('fallback')).toBe(false);
    expect(room('zone:z2').querySelector('.lr-icon')!.classList.contains('fallback')).toBe(true);
  });

  it('starts closed: no rows until the header opens the room, and again closes it', () => {
    const { room, row, head } = widget();
    expect(room('zone:z1').classList.contains('open')).toBe(false);
    expect(row('k1')).toBeNull();
    head('zone:z1');
    expect(room('zone:z1').classList.contains('open')).toBe(true);
    expect(room('zone:z1').querySelector('.lr-head')!.getAttribute('aria-expanded')).toBe('true');
    expect([...room('zone:z1').querySelectorAll('.lr-row')].map(r => (r as HTMLElement).dataset.device)).toEqual(['k1', 'k2']);
    head('zone:z1');
    expect(room('zone:z1').classList.contains('open')).toBe(false);
  });

  it('keeps a room open across a refresh', () => {
    const { w, room, head } = widget();
    head('zone:z2');
    w.setState(house());
    expect(room('zone:z2').classList.contains('open')).toBe(true);
  });

  it('shows a missing light in Other, as unavailable', () => {
    const { row, head } = widget();
    head('other');
    expect(row('gone').classList.contains('missing')).toBe(true);
    expect(row('gone').querySelector('.lr-row-name')!.textContent).toBe('Unavailable');
    expect(row('plug').querySelector('.lr-row-sub')!.textContent).toBe('On');
  });
});

describe('the room', () => {
  it('its switch turns every light off while any is on, without opening the room', async () => {
    const { room, click, onSet, state } = widget();
    click(room('zone:z1').querySelector('.lr-switch')!);
    expect(onSet.mock.calls).toEqual([['k1', { onoff: false }], ['k2', { onoff: false }]]);
    expect(state('zone:z1')).toBe('Off');
    expect(room('zone:z1').classList.contains('open')).toBe(false);
  });

  it('its switch turns every light on while none is', () => {
    const { room, click, onSet } = widget();
    click(room('zone:z2').querySelector('.lr-switch')!);
    expect(onSet.mock.calls).toEqual([['l1', { onoff: true }]]);
  });

  it('its bar sets every light; 0 turns them off', () => {
    const { room, barAt, onSet, state } = widget();
    barAt(room('zone:z1').querySelector<HTMLElement>(':scope > .lr-bar')!, 0.7);
    expect(onSet.mock.calls).toEqual([['k1', { dim: 0.7 }], ['k2', { dim: 0.7 }]]);
    expect(state('zone:z1')).toBe('All on · 70%');
    onSet.mockClear();
    barAt(room('zone:z1').querySelector<HTMLElement>(':scope > .lr-bar')!, 0);
    expect(onSet.mock.calls).toEqual([['k1', { dim: 0 }], ['k2', { dim: 0 }]]);
    expect(state('zone:z1')).toBe('Off');
  });

  it('is tinted with its lit lights\' colours, and follows the realtime', () => {
    const { w, room } = widget();
    expect(room('zone:z1').classList.contains('on')).toBe(true);
    expect(room('zone:z2').classList.contains('on')).toBe(false);
    w.pushChange({ deviceId: 'l1', capabilityId: 'onoff', value: true });
    expect(room('zone:z2').classList.contains('on')).toBe(true);
    expect(room('zone:z2').style.getPropertyValue('--lr-light')).toBe('hsl(220 100% 62%)');
  });
});

describe('a light', () => {
  it('a tap on its row toggles it, alone', () => {
    const { row, head, click, onSet, state } = widget();
    head('zone:z1');
    click(row('k2'));
    expect(onSet.mock.calls).toEqual([['k2', { onoff: true }]]);
    expect(state('zone:z1')).toBe('All on · 60%');
  });

  it('its slim bar dims it', () => {
    const { row, head, barAt, onSet } = widget();
    head('zone:z1');
    barAt(row('k1').querySelector<HTMLElement>('.lr-bar')!, 0.25);
    expect(onSet.mock.calls).toEqual([['k1', { dim: 0.25 }]]);
  });

  it("the chip opens Light Controls' swatches under the row: colours and whites for a colour light", () => {
    const { root, row, head, click, onSet } = widget();
    head('zone:z2');
    click(row('l1').querySelector('.lr-chip')!);
    const panel = root.querySelector('.lr-panel')!;
    expect(row('l1').nextElementSibling).toBe(panel);
    expect(panel.querySelectorAll('.lr-swatch').length).toBe(12);
    expect(onSet).not.toHaveBeenCalled(); // the chip doesn't toggle the light
    click(panel.querySelectorAll('.lr-swatch')[4]); // the default palette's blue
    expect(onSet.mock.calls).toEqual([['l1', { hue: 220 / 360, saturation: 1 }]]);
    expect(root.querySelector('.lr-panel')).toBeNull();
    expect(row('l1').classList.contains('on')).toBe(true);
  });

  it('a white swatch sets the temperature; a temperature light gets only whites', () => {
    const { root, row, head, click, onSet } = widget();
    head('zone:z1');
    click(row('k1').querySelector('.lr-chip')!);
    const swatches = root.querySelectorAll('.lr-panel .lr-swatch');
    expect(swatches.length).toBe(5);
    click(swatches[0]);
    expect(onSet.mock.calls).toEqual([['k1', { temperature: 0 }]]);
  });

  it('a light without colour has a plain dot, whose tap toggles it', () => {
    const { root, row, head, click, onSet } = widget();
    head('zone:z1');
    expect(row('k2').querySelector('.lr-chip')!.classList.contains('plain')).toBe(true);
    click(row('k2').querySelector('.lr-chip')!);
    expect(root.querySelector('.lr-panel')).toBeNull();
    expect(onSet.mock.calls).toEqual([['k2', { onoff: true }]]);
  });

  it('closing the room closes its swatches; ✕ and 8 s close them too', () => {
    const { root, row, head, click } = widget();
    head('zone:z2');
    click(row('l1').querySelector('.lr-chip')!);
    head('zone:z2');
    expect(root.querySelector('.lr-panel')).toBeNull();
    head('zone:z2');
    expect(root.querySelector('.lr-panel')).toBeNull();
    click(row('l1').querySelector('.lr-chip')!);
    click(root.querySelector('.lr-close')!);
    expect(root.querySelector('.lr-panel')).toBeNull();
    click(row('l1').querySelector('.lr-chip')!);
    vi.advanceTimersByTime(8000);
    expect(root.querySelector('.lr-panel')).toBeNull();
  });

  it('a failed change shakes the row and says so', async () => {
    const { w, root, row, head, click, onSet } = widget();
    onSet.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    head('zone:z1');
    click(row('k2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(row('k2').classList.contains('shake')).toBe(true);
    expect(root.querySelector('.lr-message')!.textContent).toBe('Could not change Lamp k2.');
    expect(w).toBeDefined();
  });
});

describe('Moods', () => {
  const moods = [{ id: 'm1', name: 'Dinner', zone: 'z1', colors: [{ temperature: 1 }] }, { id: 'm2', name: 'Party', zone: 'z2', colors: [] }];

  it("show in an open room only, that room's", () => {
    const { w, room, head } = widget();
    w.setMoods(moods);
    expect(room('zone:z1').querySelectorAll('.lr-mood').length).toBe(0);
    head('zone:z1');
    expect([...room('zone:z1').querySelectorAll('.lr-mood')].map(m => m.textContent)).toEqual(['Dinner']);
  });

  it('a tap starts the Mood; without a usable key the room shakes and says what to do', async () => {
    const { w, root, room, head, click, onMood } = widget();
    w.setMoods(moods);
    head('zone:z1');
    onMood.mockRejectedValueOnce(Object.assign(new Error('noKey'), { reason: 'noKey' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    click(room('zone:z1').querySelector('.lr-mood')!);
    expect(onMood).toHaveBeenCalledWith('m1');
    await vi.advanceTimersByTimeAsync(0);
    expect(room('zone:z1').classList.contains('shake')).toBe(true);
    expect(root.querySelector('.lr-message')!.textContent).toBe('To start Moods, add an API key in the app settings.');
  });

  it('are left out with Show Moods off', () => {
    const { w, room, head } = widget(house(), { showMoods: false });
    w.setMoods(moods);
    head('zone:z1');
    expect(room('zone:z1').querySelectorAll('.lr-mood').length).toBe(0);
  });
});

describe('the mount', () => {
  const homey = (settings: object, api: any) => ({
    api, on: vi.fn(), ready: vi.fn(), setHeight: vi.fn(), getSettings: () => settings, getDeviceIds: () => ['k1', 'l1'],
    getWidgetInstanceId: () => 'w1', __: (k: string) => k,
  });

  it("reads the lights and their rooms' icons, then the rooms' Moods", async () => {
    loadMount('lightrooms');
    const api = vi.fn(async (method: string, path: string) => (path.startsWith('/state')
      ? { lights: [lamp('k1', kitchen), lamp('l1', living)], zoneIcons: { z1: 'data:image/svg+xml;base64,AA==' } }
      : { moods: [] }));
    const root = document.createElement('div');
    document.body.append(root);
    win.mountLightRoomsWidget(homey({}, api), { root, frame: root });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.mock.calls.map(c => c[1].split('&perf')[0])).toEqual(['/state?deviceIds=k1,l1', '/moods?zones=z1,z2']);
    expect(root.querySelectorAll('.lr-room').length).toBe(2);
  });

  it('reads no Moods with Show Moods off', async () => {
    loadMount('lightrooms');
    const api = vi.fn(async () => ({ lights: [lamp('k1', kitchen)], zoneIcons: {} }));
    const root = document.createElement('div');
    document.body.append(root);
    win.mountLightRoomsWidget(homey({ showMoods: false }, api), { root, frame: root });
    await vi.advanceTimersByTimeAsync(0);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
