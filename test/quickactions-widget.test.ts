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

function widget(devices: any[], onTrigger: any = vi.fn(async () => {}), activeStyle?: string, options: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createQuickActionsWidget(root, { onTrigger, activeStyle, ...options });
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

describe('double press', () => {
  const garage = () => ({ id: 'garage', name: 'Garage', icon: null, quickAction: qa('garagedoor_closed', true) });
  const name = (tile: HTMLElement) => tile.querySelector('.qa-name')!.textContent;

  it('asks locks and garage doors for a second tap, and switches others at once', () => {
    const { tile, onTrigger } = widget([door(true), garage(), lamp(false)], undefined, undefined, { press: 'double', pressFor: 'locks' });
    tile('door').click();
    tile('garage').click();
    expect(onTrigger).not.toHaveBeenCalled();
    expect(tile('door').classList.contains('confirm')).toBe(true);
    expect(tile('door').classList.contains('active')).toBe(false); // red, not the on tint
    expect(name(tile('door'))).toBe('Tap again');
    tile('lamp').click();
    expect(onTrigger).toHaveBeenCalledWith('lamp', true);
    tile('door').click();
    expect(onTrigger).toHaveBeenCalledWith('door', false);
    expect(tile('door').classList.contains('confirm')).toBe(false);
    expect(name(tile('door'))).toBe('Door');
    expect(tile('garage').classList.contains('confirm')).toBe(true);
  });

  it('shows what the second tap will do', () => {
    const { tile } = widget([door(true)], undefined, undefined, { press: 'double', pressFor: 'locks' });
    const mask = () => (tile('door').querySelector('.qa-action') as HTMLElement).style.getPropertyValue('--qa-mask');
    const locked = mask();
    tile('door').click();
    expect(mask()).not.toBe(locked);
  });

  it('asks every tile by default, a momentary button too', () => {
    const { tile, onTrigger } = widget([lamp(false), alarm()], undefined, undefined, { press: 'double' });
    tile('lamp').click();
    tile('alarm').click();
    expect(onTrigger).not.toHaveBeenCalled();
    tile('alarm').click();
    expect(onTrigger).toHaveBeenCalledWith('alarm', true);
  });

  it('never asks on a single press', () => {
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, { press: 'single', pressFor: 'locks' });
    tile('door').click();
    expect(onTrigger).toHaveBeenCalledWith('door', false);
  });

  it('forgets the first tap after 3 s', async () => {
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, { press: 'double', pressFor: 'locks' });
    tile('door').click();
    await vi.advanceTimersByTimeAsync(3100);
    expect(tile('door').classList.contains('confirm')).toBe(false);
    expect(tile('door').classList.contains('active')).toBe(true);
    tile('door').click();
    expect(onTrigger).not.toHaveBeenCalled();
    expect(tile('door').classList.contains('confirm')).toBe(true);
  });

  it('asks again when the state changes in between', () => {
    const { w, tile, onTrigger } = widget([door(true)], undefined, undefined, { press: 'double', pressFor: 'locks' });
    tile('door').click();
    w.pushChange({ deviceId: 'door', capabilityId: 'locked', value: false }); // unlocked elsewhere
    expect(tile('door').classList.contains('confirm')).toBe(false);
    tile('door').click();
    expect(onTrigger).not.toHaveBeenCalled();
    tile('door').click();
    expect(onTrigger).toHaveBeenCalledWith('door', true);
  });

  it('takes two touch taps', () => {
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, { press: 'double', pressFor: 'locks' });
    const tap = () => { fireTouch(tile('door'), 'touchstart', 10, 10); fireTouch(tile('door'), 'touchend', 10, 10); };
    tap();
    expect(onTrigger).not.toHaveBeenCalled();
    tap();
    expect(onTrigger).toHaveBeenCalledExactlyOnceWith('door', false);
  });
});

describe('long press', () => {
  const LOCKS = { press: 'long', pressFor: 'locks' };
  const name = (tile: HTMLElement) => tile.querySelector('.qa-name')!.textContent;
  const mouse = (target: HTMLElement, type: string) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
  const key = (target: HTMLElement, type: string, k = 'Enter', repeat = false) => {
    const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: k, repeat });
    target.dispatchEvent(e);
    return e;
  };

  it('acts once the tile has been held for 600 ms, and vibrates as the finger lifts', async () => {
    const onHaptic = vi.fn();
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, { ...LOCKS, onHaptic });
    fireTouch(tile('door'), 'touchstart', 10, 10);
    expect(tile('door').classList.contains('holding')).toBe(true);
    await vi.advanceTimersByTimeAsync(550);
    expect(onTrigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(onTrigger).toHaveBeenCalledExactlyOnceWith('door', false);
    expect(onHaptic).not.toHaveBeenCalled(); // Homey's haptic throws until a touch ends
    expect(tile('door').classList.contains('holding')).toBe(false);
    fireTouch(tile('door'), 'touchend', 10, 10);
    tile('door').click(); // the click a browser may still send
    await vi.advanceTimersByTimeAsync(0);
    expect(onHaptic).toHaveBeenCalledOnce();
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('says Hold after a short tap, and does nothing', async () => {
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, LOCKS);
    fireTouch(tile('door'), 'touchstart', 10, 10);
    await vi.advanceTimersByTimeAsync(200);
    fireTouch(tile('door'), 'touchend', 10, 10);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(name(tile('door'))).toBe('Hold');
    await vi.advanceTimersByTimeAsync(600);
    expect(name(tile('door'))).toBe('Door');
  });

  it('leaves a drag to the dashboard', async () => {
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, LOCKS);
    fireTouch(tile('door'), 'touchstart', 10, 10);
    fireTouch(tile('door'), 'touchmove', 10, 40);
    await vi.advanceTimersByTimeAsync(1000);
    fireTouch(tile('door'), 'touchend', 10, 40);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(tile('door').classList.contains('holding')).toBe(false);
    fireTouch(tile('door'), 'touchstart', 10, 10);
    fireTouch(tile('door'), 'touchcancel', 10, 10); // Android's dashboard took it
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('only for locks and garage doors: other tiles act on a tap', () => {
    const { tile, onTrigger } = widget([door(true), lamp(false)], undefined, undefined, LOCKS);
    fireTouch(tile('lamp'), 'touchstart', 10, 10);
    expect(tile('lamp').classList.contains('holding')).toBe(false);
    fireTouch(tile('lamp'), 'touchend', 10, 10);
    expect(onTrigger).toHaveBeenCalledExactlyOnceWith('lamp', true);
  });

  it('every tile by default', () => {
    const { tile, onTrigger } = widget([lamp(false)], undefined, undefined, { press: 'long' });
    tile('lamp').click();
    expect(onTrigger).not.toHaveBeenCalled();
    expect(name(tile('lamp'))).toBe('Hold');
  });

  it('holds with the mouse', async () => {
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, LOCKS);
    mouse(tile('door'), 'mousedown');
    await vi.advanceTimersByTimeAsync(300);
    mouse(tile('door'), 'mouseup');
    tile('door').click();
    expect(onTrigger).not.toHaveBeenCalled();
    expect(name(tile('door'))).toBe('Hold');
    mouse(tile('door'), 'mousedown');
    expect(name(tile('door'))).toBe('Door');
    await vi.advanceTimersByTimeAsync(600);
    mouse(tile('door'), 'mouseup');
    tile('door').click();
    expect(onTrigger).toHaveBeenCalledExactlyOnceWith('door', false);
    mouse(tile('door'), 'mousedown');
    mouse(tile('door'), 'mouseleave'); // dragged off: nothing
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('holds with Enter or Space, keeping back their click', async () => {
    const { tile, onTrigger } = widget([door(true)], undefined, undefined, LOCKS);
    expect(key(tile('door'), 'keydown').defaultPrevented).toBe(true);
    key(tile('door'), 'keydown', 'Enter', true); // the key's repeats don't restart it
    await vi.advanceTimersByTimeAsync(600);
    expect(onTrigger).toHaveBeenCalledExactlyOnceWith('door', false);
    expect(key(tile('door'), 'keyup').defaultPrevented).toBe(true);
    key(tile('door'), 'keydown', ' ');
    expect(key(tile('door'), 'keyup', ' ').defaultPrevented).toBe(true);
    expect(onTrigger).toHaveBeenCalledOnce();
    expect(name(tile('door'))).toBe('Hold');
  });
});
