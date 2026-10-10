// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('lights'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const cap = (value: unknown) => ({ value, setable: true });
const bulb = (on = true, dim = 0.35) => ({
  id: 'bulb', name: 'Kitchen', icon: 'data:image/svg+xml;base64,AA==',
  caps: { onoff: cap(on), dim: cap(dim), light_temperature: cap(0.7), light_mode: cap('temperature') },
});
const spots = (dim = 0) => ({ id: 'spots', name: 'Spots', icon: null, caps: { dim: cap(dim) } });
const hueGo = (temperature = true) => ({
  id: 'hue', name: 'Hue Go', icon: null,
  caps: {
    onoff: cap(false), dim: cap(0.6), light_hue: cap(220 / 360), light_saturation: cap(1), light_mode: cap('color'),
    ...(temperature ? { light_temperature: cap(0.24) } : {}),
  },
});

function widget(devices: any[], onSet: any = vi.fn(async () => {}), groupByZone = false, palette?: string, barMin?: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createLightsWidget(root, { onSet, groupByZone, palette, barMin });
  w.setState(devices);
  const tile = (id: string) => root.querySelector<HTMLElement>(`.lc-tile[data-device="${id}"]`)!;
  /** The bar's value in percent. */
  const value = (id: string) => tile(id).querySelector('.lc-bar')!.getAttribute('aria-valuenow');
  const x = (id: string) => tile(id).style.getPropertyValue('--lc-x');
  /** A mouse press and release on the bar at `fraction` of its width (the bar is 100 px wide at x 0). */
  const barAt = (id: string, fraction: number) => {
    const bar = tile(id).querySelector<HTMLElement>('.lc-bar')!;
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 28, right: 100, bottom: 28 }) as DOMRect;
    const ev = (type: string) => new win.PointerEvent(type, { pointerType: 'mouse', clientX: fraction * 100, bubbles: true });
    bar.dispatchEvent(ev('pointerdown'));
    bar.dispatchEvent(ev('pointerup'));
    bar.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  return { w, root, tile, value, x, barAt, onSet };
}

describe('render', () => {
  it('shows the brightness on the bar, 0 when off', () => {
    const { value, tile, x } = widget([bulb(true, 0.35), bulb(false), spots(0)].map((d, i) => ({ ...d, id: `l${i}` })));
    expect([value('l0'), value('l1'), value('l2')]).toEqual(['35', '0', '0']);
    expect(tile('l0').classList.contains('on')).toBe(true);
    expect(tile('l1').classList.contains('on')).toBe(false);
    expect([x('l0'), x('l1')]).toEqual(['0.35', '0']);
  });

  it('shows the chip only for lights with a colour or a colour temperature', () => {
    const { tile } = widget([bulb(), spots(0.5), hueGo()]);
    const chip = (id: string) => tile(id).querySelector<HTMLElement>('.lc-chip')!;
    expect(chip('bulb').style.display).toBe('');
    expect(chip('bulb').getAttribute('aria-label')).toBe('Colour temperature');
    expect(chip('spots').style.display).toBe('none');
    expect(chip('hue').style.display).toBe('');
    expect(chip('hue').getAttribute('aria-label')).toBe('Colour');
  });

  it("shows a hue circle on a colour light's chip and a thermometer on the others, in the light's colour", () => {
    const { w, tile } = widget([bulb(), hueGo()]);
    const glyph = (id: string) => tile(id).querySelector<HTMLElement>('.lc-chip-glyph')!;
    expect(glyph('bulb').classList.contains('hue')).toBe(false);
    expect(glyph('hue').classList.contains('hue')).toBe(true);
    expect(glyph('hue').style.getPropertyValue('--lc-mask')).not.toBe(glyph('bulb').style.getPropertyValue('--lc-mask'));
    // The glyph is drawn in --lc-light, the light's current colour.
    expect(tile('hue').style.getPropertyValue('--lc-light')).toBe('hsl(220 100% 62%)');
    w.pushChange({ deviceId: 'hue', capabilityId: 'light_hue', value: 0 });
    expect(tile('hue').style.getPropertyValue('--lc-light')).toBe('hsl(0 100% 62%)');
  });

  it('marks missing devices', () => {
    const { tile } = widget([{ id: 'gone', missing: true }]);
    expect(tile('gone').classList.contains('missing')).toBe(true);
    expect(tile('gone').textContent).toBe('Unavailable');
  });

  it('follows realtime changes', () => {
    const { w, value } = widget([bulb(true, 0.35)]);
    w.pushChange({ deviceId: 'bulb', capabilityId: 'dim', value: 0.8 });
    expect(value('bulb')).toBe('80');
    w.pushChange({ deviceId: 'bulb', capabilityId: 'onoff', value: false });
    expect(value('bulb')).toBe('0');
  });
});

describe('tap', () => {
  it('toggles the light', () => {
    const { tile, onSet, value } = widget([bulb(false), spots(0)]);
    tile('bulb').click();
    tile('spots').click();
    expect(onSet).toHaveBeenCalledWith('bulb', { onoff: true });
    expect(onSet).toHaveBeenCalledWith('spots', { onoff: true });
    expect(value('bulb')).toBe('35');
    expect(value('spots')).toBe('100');
  });

  it('toggles a light without dim (a plug or a switch), which has no bar', () => {
    const plug = { id: 'plug', name: 'Socket', icon: null, caps: { onoff: cap(false) } };
    const { tile, onSet, value } = widget([plug]);
    expect(tile('plug').classList.contains('missing')).toBe(false);
    expect(tile('plug').classList.contains('no-dim')).toBe(true);
    tile('plug').click();
    expect(onSet).toHaveBeenCalledWith('plug', { onoff: true });
    expect(tile('plug').classList.contains('on')).toBe(true);
    expect(value('plug')).toBe('100');
  });

  it('turns a light without onoff back on to its last brightness', () => {
    const { w, tile, value } = widget([spots(0.4)]);
    tile('spots').click(); // off
    w.pushChange({ deviceId: 'spots', capabilityId: 'dim', value: 0 });
    vi.advanceTimersByTime(11000);
    tile('spots').click(); // on again
    expect(value('spots')).toBe('40');
  });

  it('toggles from the keyboard: the tile is a focusable group that takes Enter and Space', () => {
    const { tile, onSet } = widget([bulb(false)]);
    expect(tile('bulb').getAttribute('role')).toBe('group'); // not a button: it holds the chip and the slider
    expect(tile('bulb').getAttribute('aria-label')).toBe('Kitchen');
    expect(tile('bulb').getAttribute('tabindex')).toBe('0');
    tile('bulb').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onSet).toHaveBeenLastCalledWith('bulb', { onoff: true });
    tile('bulb').dispatchEvent(new win.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(onSet).toHaveBeenLastCalledWith('bulb', { onoff: false });
    tile('bulb').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(onSet).toHaveBeenCalledTimes(2);
  });

  it('shows the failure and goes back', async () => {
    const { tile, value, root } = widget([bulb(false)], vi.fn(async () => { throw new Error('no'); }));
    tile('bulb').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(value('bulb')).toBe('0');
    expect(root.querySelector('.lc-message')!.textContent).toBe('Could not change Kitchen.');
  });
});

describe('bar', () => {
  it('sets the brightness where it is let go, without toggling', () => {
    const { barAt, onSet, value } = widget([bulb(false)]);
    barAt('bulb', 0.62);
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith('bulb', { dim: 0.62 });
    expect(value('bulb')).toBe('62');
  });

  it('keeps the tiles in place while rendering, so a drag keeps its pointer capture', () => {
    const { w, root } = widget([bulb(), spots(0.5)]);
    const first = root.querySelector('.lc-tile')!;
    const inserted = vi.spyOn(first.parentNode!, 'insertBefore');
    const appended = vi.spyOn(first.parentNode!, 'appendChild');
    w.pushChange({ deviceId: 'bulb', capabilityId: 'dim', value: 0.8 });
    expect(inserted).not.toHaveBeenCalled();
    expect(appended).not.toHaveBeenCalled();
    w.setState([spots(0.5), bulb()]); // a new order still applies
    expect([...root.querySelectorAll('.lc-tile')].map(t => t.getAttribute('data-device'))).toEqual(['spots', 'bulb']);
  });

  it('turns off at 0', () => {
    const { barAt, onSet, value } = widget([bulb(true)]);
    barAt('bulb', 0.002);
    expect(onSet).toHaveBeenCalledWith('bulb', { dim: 0 });
    expect(value('bulb')).toBe('0');
  });

  it('stops at 1 % with barMin 1, so the light stays on', () => {
    const { barAt, onSet, value, tile } = widget([bulb(true)], undefined, false, undefined, '1');
    barAt('bulb', 0.002);
    expect(onSet).toHaveBeenCalledWith('bulb', { dim: 0.01 });
    expect(value('bulb')).toBe('1');
    expect(tile('bulb').classList.contains('on')).toBe(true);
  });

  it('still turns off from a tap on the tile with barMin 1', () => {
    const { tile, onSet } = widget([bulb(true)], undefined, false, undefined, '1');
    tile('bulb').click();
    expect(onSet).toHaveBeenCalledWith('bulb', { onoff: false });
  });

});

describe('swatch panel', () => {
  const open = (tile: (id: string) => HTMLElement, id: string) => tile(id).querySelector<HTMLElement>('.lc-chip')!.click();
  const panelOf = (root: HTMLElement) => root.querySelector<HTMLElement>('.lc-panel')!;
  const shownPanel = (root: HTMLElement) => panelOf(root).style.display !== 'none';
  const swatches = (root: HTMLElement) => [...panelOf(root).querySelectorAll<HTMLElement>('.lc-swatch')];

  it('opens on the chip without toggling, with the colours and the whites', () => {
    const { tile, root, onSet } = widget([hueGo()]);
    expect(shownPanel(root)).toBe(false);
    open(tile, 'hue');
    expect(onSet).not.toHaveBeenCalled();
    expect(shownPanel(root)).toBe(true);
    expect(tile('hue').querySelector('.lc-chip')!.classList.contains('active')).toBe(true);
    expect(swatches(root)).toHaveLength(7 + 5);
    expect(panelOf(root).querySelector('.lc-close')).not.toBeNull();
  });

  it('opens on a touch tap on the chip, but not on a swipe across it, and never toggles', () => {
    const { tile, root, onSet } = widget([hueGo()]);
    const chip = tile('hue').querySelector<HTMLElement>('.lc-chip')!;
    const touch = (type: string, x: number) => {
      const e = new win.Event(type, { bubbles: true, cancelable: true });
      e.changedTouches = [{ clientX: x, clientY: 10 }];
      chip.dispatchEvent(e);
    };
    // A swipe that starts and ends on the chip is the dashboard's.
    touch('touchstart', 10); touch('touchmove', 40); touch('touchend', 40);
    expect(shownPanel(root)).toBe(false);
    // A short swipe (past TAP_SLOP, inside the browser's own limit) still gets the browser's click: ignored.
    touch('touchstart', 10); touch('touchmove', 23); touch('touchend', 23);
    chip.click();
    expect(shownPanel(root)).toBe(false);
    touch('touchstart', 10); touch('touchend', 13);
    expect(shownPanel(root)).toBe(true);
    // The same from the keyboard, which doesn't reach the tile either.
    chip.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(shownPanel(root)).toBe(false);
    expect(onSet).not.toHaveBeenCalled();
    expect(tile('hue').classList.contains('pressing')).toBe(false);
  });

  it('sets a colour, turning the light on and tinting the tile, and closes', () => {
    const { tile, root, onSet } = widget([hueGo()]);
    open(tile, 'hue');
    swatches(root)[0].click(); // red
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith('hue', { hue: 0, saturation: 1 });
    expect(shownPanel(root)).toBe(false);
    expect(tile('hue').classList.contains('on')).toBe(true);
    expect(tile('hue').style.getPropertyValue('--lc-light')).toBe('hsl(0 100% 62%)');
  });

  it('sets a white as a colour temperature', () => {
    const { tile, root, onSet } = widget([hueGo()]);
    open(tile, 'hue');
    swatches(root)[7 + 4].click(); // the warmest white
    expect(onSet).toHaveBeenCalledWith('hue', { temperature: 1 });
  });

  it('offers a plain white to a colour light without temperature', () => {
    const { tile, root, onSet } = widget([hueGo(false)]);
    open(tile, 'hue');
    expect(swatches(root)).toHaveLength(8);
    swatches(root)[7].click();
    expect(onSet).toHaveBeenCalledWith('hue', { hue: 0, saturation: 0 });
  });

  it('uses the warm palette: red first, the whites from warm to cool', () => {
    const { tile, root, onSet } = widget([hueGo()], undefined, false, 'warm');
    open(tile, 'hue');
    expect(swatches(root)).toHaveLength(7 + 5);
    swatches(root)[0].click();
    expect(onSet).toHaveBeenLastCalledWith('hue', { hue: 0, saturation: 1 });
    open(tile, 'hue');
    swatches(root)[6].click(); // the palest amber
    expect(onSet).toHaveBeenLastCalledWith('hue', { hue: 44 / 360, saturation: 0.5 });
    open(tile, 'hue');
    swatches(root)[7 + 4].click(); // the last white is the coolest
    expect(onSet).toHaveBeenLastCalledWith('hue', { temperature: 0 });
  });

  it('uses the dusk palette, starting at indigo', () => {
    const { tile, root, onSet } = widget([hueGo()], undefined, false, 'dusk');
    open(tile, 'hue');
    swatches(root)[0].click();
    expect(onSet).toHaveBeenLastCalledWith('hue', { hue: 240 / 360, saturation: 0.8 });
  });

  it('falls back to the bright palette for an unknown one', () => {
    const { tile, root, onSet } = widget([hueGo()], undefined, false, 'nope');
    open(tile, 'hue');
    swatches(root)[3].click();
    expect(onSet).toHaveBeenLastCalledWith('hue', { hue: 120 / 360, saturation: 1 });
  });

  it('offers only the whites to a light with only a colour temperature', () => {
    const { tile, root, onSet } = widget([bulb()]);
    open(tile, 'bulb');
    expect(swatches(root)).toHaveLength(5);
    swatches(root)[1].click();
    expect(onSet).toHaveBeenCalledWith('bulb', { temperature: 0.25 });
  });

  it('rings the current colour, and follows a pick', () => {
    const { tile, root, w } = widget([hueGo(), bulb()]);
    open(tile, 'hue');
    const current = () => swatches(root).findIndex(s => s.classList.contains('current'));
    expect(current()).toBe(4); // blue, 220°
    w.pushChange({ deviceId: 'hue', capabilityId: 'light_mode', value: 'temperature' });
    expect(current()).toBe(7 + 1); // 0.24: the 0.25 white
    swatches(root)[2].click(); // yellow: closes
    open(tile, 'hue');
    expect(current()).toBe(2);
    open(tile, 'bulb'); // another light's panel
    expect(swatches(root)).toHaveLength(5);
    expect(current()).toBe(-1); // 0.7 matches no white
  });

  it('closes on the close button, the chip again, or after 8 s', () => {
    const { tile, root, onSet } = widget([hueGo()]);
    open(tile, 'hue');
    panelOf(root).querySelector<HTMLElement>('.lc-close')!.click();
    expect(shownPanel(root)).toBe(false);
    open(tile, 'hue');
    open(tile, 'hue');
    expect(shownPanel(root)).toBe(false);
    open(tile, 'hue');
    vi.advanceTimersByTime(8100);
    expect(shownPanel(root)).toBe(false);
    expect(onSet).not.toHaveBeenCalled();
  });

  it('closes when its light goes missing', () => {
    const { tile, root, w } = widget([hueGo()]);
    open(tile, 'hue');
    w.setState([{ id: 'hue', missing: true }]);
    expect(shownPanel(root)).toBe(false);
  });
});

describe('group by room', () => {
  const stue = { id: 'z1', name: 'Stue' };
  const kokken = { id: 'z2', name: 'Køkken' };
  const lamp = (id: string, zone: any, on: boolean, dim: number, extra: any = {}) =>
    ({ id, name: id, icon: null, zone, caps: { onoff: cap(on), dim: cap(dim), ...extra } });
  const lights = () => [
    lamp('a', stue, true, 0.2),
    lamp('b', kokken, false, 0.5),
    lamp('c', stue, true, 0.6, { light_hue: cap(0), light_saturation: cap(1), light_mode: cap('color') }),
    lamp('d', stue, false, 0.9, { light_temperature: cap(0.5) }),
    { id: 'e', missing: true },
  ];
  const ids = (root: HTMLElement) => [...root.querySelectorAll('.lc-tile')].map(t => t.getAttribute('data-device'));

  it('is off by default', () => {
    const { root } = widget(lights());
    expect(ids(root)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('shows a room with two or more lights as one tile, where its first light is', () => {
    const { root, tile, value } = widget(lights(), undefined, true);
    expect(ids(root)).toEqual(['zone:z1', 'b', 'e']);
    expect(tile('zone:z1').textContent).toBe('Stue');
    expect(tile('b').textContent).toBe('b'); // alone in its room: its own name
    expect(tile('zone:z1').classList.contains('on')).toBe(true);
    expect(value('zone:z1')).toBe('40'); // the average of the lights that are on
    expect(tile('zone:z1').style.getPropertyValue('--lc-light')).toBe('rgb(239 198 152)'); // a, the first on: no colour, so the default warm white
  });

  it('turns every light off when any is on, then all on', () => {
    const { tile, onSet } = widget(lights(), undefined, true);
    tile('zone:z1').click();
    expect(onSet.mock.calls).toEqual([['a', { onoff: false }], ['c', { onoff: false }], ['d', { onoff: false }]]);
    expect(tile('zone:z1').classList.contains('on')).toBe(false);
    onSet.mockClear();
    tile('zone:z1').click();
    expect(onSet.mock.calls.map(c => c[1])).toEqual([{ onoff: true }, { onoff: true }, { onoff: true }]);
  });

  it('sets the brightness of every light from the bar', () => {
    const { barAt, onSet, value } = widget(lights(), undefined, true);
    barAt('zone:z1', 0.7);
    expect(onSet.mock.calls).toEqual([['a', { dim: 0.7 }], ['c', { dim: 0.7 }], ['d', { dim: 0.7 }]]);
    expect(value('zone:z1')).toBe('70');
  });

  it('sends a colour to the colour lights and a white to all that can show one', () => {
    const { tile, root, onSet } = widget(lights(), undefined, true);
    const open = () => tile('zone:z1').querySelector<HTMLElement>('.lc-chip')!.click();
    const swatches = () => [...root.querySelectorAll<HTMLElement>('.lc-panel .lc-swatch')];
    open();
    expect(swatches()).toHaveLength(7 + 5);
    swatches()[3].click(); // green
    expect(onSet.mock.calls).toEqual([['c', { hue: 120 / 360, saturation: 1 }]]);
    onSet.mockClear();
    open();
    swatches()[7].click(); // the coolest white
    expect(onSet.mock.calls).toEqual([['c', { hue: 0, saturation: 0 }], ['d', { temperature: 0 }]]);
  });

  it('follows realtime changes of its lights', () => {
    const { w, value } = widget(lights(), undefined, true);
    w.pushChange({ deviceId: 'a', capabilityId: 'onoff', value: false });
    expect(value('zone:z1')).toBe('60');
  });

  it('keeps lights without a known room on their own tiles', () => {
    const { root } = widget([lamp('a', null, true, 1), lamp('b', null, true, 1)], undefined, true);
    expect(ids(root)).toEqual(['a', 'b']);
  });
});
