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

function widget(devices: any[], onSet: any = vi.fn(async () => {})) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createLightsWidget(root, { onSet });
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

  it('shows the temperature chip only for lights with a colour temperature', () => {
    const { tile } = widget([bulb(), spots(0.5)]);
    expect(tile('bulb').querySelector<HTMLElement>('.lc-chip')!.style.display).toBe('');
    expect(tile('spots').querySelector<HTMLElement>('.lc-chip')!.style.display).toBe('none');
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

  it('turns off at 0', () => {
    const { barAt, onSet, value } = widget([bulb(true)]);
    barAt('bulb', 0.002);
    expect(onSet).toHaveBeenCalledWith('bulb', { dim: 0 });
    expect(value('bulb')).toBe('0');
  });

  it('sets the temperature after a tap on the chip, then goes back to brightness', () => {
    const { tile, barAt, onSet, value } = widget([bulb(true)]);
    tile('bulb').querySelector<HTMLElement>('.lc-chip')!.click();
    expect(onSet).not.toHaveBeenCalled(); // the chip doesn't toggle the light
    expect(tile('bulb').classList.contains('temp')).toBe(true);
    expect(value('bulb')).toBe('70');
    barAt('bulb', 0.2);
    expect(onSet).toHaveBeenCalledWith('bulb', { temperature: 0.2 });
    vi.advanceTimersByTime(6100);
    expect(tile('bulb').classList.contains('temp')).toBe(false);
    expect(value('bulb')).toBe('35');
  });
});
