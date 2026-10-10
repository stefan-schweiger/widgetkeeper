// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';
import { touch as fireTouch } from './helpers/touch.js';

let win: any;
beforeAll(() => { win = loadWidget('quickactions'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const qa = (capabilityId: string, value: unknown, extra: object = {}) => ({ capabilityId, value, actionable: true, momentary: false, icon: null, ...extra });
const lamp = (value = false) => ({ id: 'lamp', name: 'Lamp', icon: 'data:image/svg+xml;base64,AA==', quickAction: qa('onoff', value) });
const door = (value = true) => ({ id: 'door', name: 'Door', icon: null, quickAction: qa('locked', value) });
const alarm = () => ({ id: 'alarm', name: 'Alarm', icon: null, quickAction: qa('button', false, { momentary: true }) });
const sensor = () => ({ id: 'sensor', name: 'Sensor', icon: null, quickAction: null });

function widget(devices: any[], onTrigger: any = vi.fn(async () => {}), activeStyle?: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createQuickActionsWidget(root, { onTrigger, activeStyle });
  w.setState(devices);
  const tile = (id: string) => root.querySelector<HTMLButtonElement>(`.qa-tile[data-device="${id}"]`)!;
  const tiles = () => [...root.querySelectorAll<HTMLButtonElement>('.qa-tile')];
  return { w, root, tile, tiles, onTrigger };
}

describe('render', () => {
  it('shows one tile per device, in order', () => {
    const { tiles } = widget([door(), lamp(), sensor()]);
    expect(tiles().map(t => t.querySelector('.qa-name')!.textContent)).toEqual(['Door', 'Lamp', 'Sensor']);
  });

  it('highlights the whole tile while the quick action is on', () => {
    const { tile } = widget([lamp(false), door(true)]);
    expect(tile('lamp').classList.contains('active')).toBe(false);
    expect(tile('door').classList.contains('active')).toBe(true);
  });

  it('uses the active style from the settings, blue tint by default', () => {
    expect(widget([lamp()]).root.dataset.activeStyle).toBe('tint');
    expect(widget([lamp()], undefined, 'lighter').root.dataset.activeStyle).toBe('lighter');
    expect(widget([lamp()], undefined, 'bogus').root.dataset.activeStyle).toBe('tint');
  });

  it('uses the device icon, or the fallback', () => {
    const { tile } = widget([lamp(), door()]);
    expect(tile('lamp').querySelector('.qa-icon')!.classList.contains('fallback')).toBe(false);
    expect(tile('door').querySelector('.qa-icon')!.classList.contains('fallback')).toBe(true);
  });

  it("uses the capability's own icon when it has one", () => {
    const icon = 'data:image/svg+xml;base64,QUJD';
    const { tile } = widget([{ ...lamp(), quickAction: qa('clean_full', false, { icon }) }]);
    expect((tile('lamp').querySelector('.qa-action') as HTMLElement).style.getPropertyValue('--qa-mask')).toBe(`url("${icon}")`);
  });

  it('disables devices without a quick action, and missing ones', () => {
    const { tiles } = widget([sensor(), { id: 'gone', missing: true }, lamp()]);
    expect(tiles().map(t => t.disabled)).toEqual([true, true, false]);
    expect(tiles()[1].textContent).toBe('Unavailable');
    expect((tiles()[0].querySelector('.qa-action') as HTMLElement).style.display).toBe('none');
  });

  it('updates tiles in place', () => {
    const { w, tiles } = widget([lamp(), door()]);
    const before = tiles();
    w.pushChange({ deviceId: 'lamp', capabilityId: 'onoff', value: true });
    w.setState([door(false), lamp(true)]);
    expect(tiles()).toEqual([before[1], before[0]]);
    expect(tiles()[1].classList.contains('active')).toBe(true);
  });
});

describe('tap', () => {
  it('sends the opposite value and shows it right away', async () => {
    const { tile, onTrigger } = widget([lamp(false), door(true)]);
    tile('lamp').click();
    tile('door').click();
    expect(onTrigger).toHaveBeenCalledWith('lamp', true);
    expect(onTrigger).toHaveBeenCalledWith('door', false);
    expect(tile('lamp').classList.contains('active')).toBe(true);
    expect(tile('door').classList.contains('active')).toBe(false);
  });

  it('falls back to the reported value when the device never confirms', async () => {
    const { tile } = widget([lamp(false)]);
    tile('lamp').click();
    await vi.advanceTimersByTimeAsync(11e3);
    expect(tile('lamp').classList.contains('active')).toBe(false);
  });

  it('a realtime change replaces the optimistic value', async () => {
    const { w, tile } = widget([lamp(false)]);
    tile('lamp').click();
    w.pushChange({ deviceId: 'lamp', capabilityId: 'onoff', value: false });
    tile('lamp').click(); // from the shown value: on → off
    expect(tile('lamp').classList.contains('active')).toBe(false);
  });

  it('flashes a momentary button and always sends true', async () => {
    const { tile, onTrigger } = widget([alarm()]);
    tile('alarm').click();
    expect(onTrigger).toHaveBeenCalledWith('alarm', true);
    expect(tile('alarm').classList.contains('active')).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(tile('alarm').classList.contains('active')).toBe(false);
  });

  it('reverts, shakes and says so when it fails', async () => {
    const onTrigger = vi.fn(async () => { throw new Error('nope'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tile, root } = widget([lamp(false)], onTrigger);
    tile('lamp').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(tile('lamp').classList.contains('active')).toBe(false);
    expect(tile('lamp').classList.contains('shake')).toBe(true);
    expect(root.querySelector('.qa-message')!.textContent).toBe('Could not change Lamp.');
  });

  it('taps on touch, but leaves drags to the dashboard', () => {
    const { tile, onTrigger } = widget([lamp(false)]);
    const touch = (type: string, x: number, y: number) => fireTouch(tile('lamp'), type, x, y);
    touch('touchstart', 10, 10);
    touch('touchmove', 10, 40);
    touch('touchend', 10, 40);
    expect(onTrigger).not.toHaveBeenCalled();
    touch('touchstart', 10, 10);
    expect(tile('lamp').classList.contains('pressing')).toBe(true);
    touch('touchend', 14, 12);
    tile('lamp').click(); // the click a browser may still send after a touch is ignored
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith('lamp', true);
  });

  it('does nothing on a disabled tile', () => {
    const { tile, onTrigger } = widget([sensor()]);
    tile('sensor').click();
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
