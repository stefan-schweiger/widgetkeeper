// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('curtains'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const cap = (value: unknown) => ({ value, setable: true });
const living = { id: 'z1', name: 'Living room' };
const curtain = (id: string, position: number, extra: object = {}) => ({
  id, name: `Curtain ${id}`, kind: 'curtain', zone: living,
  caps: { windowcoverings_set: cap(position), windowcoverings_state: cap('idle'), ...extra },
});
const positionOnly = (id: string, position: number) => ({ id, name: id, kind: 'curtain', zone: null, caps: { windowcoverings_set: cap(position) } });
const plain = (id: string, closed: boolean) => ({ id, name: id, kind: 'blinds', zone: null, caps: { windowcoverings_closed: cap(closed) } });

function widget(devices: any[], opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSet = vi.fn(async () => {});
  const w = win.createCurtainsWidget(root, { onSet, ...opts });
  w.setState(devices);
  const tile = (id: string) => root.querySelector<HTMLElement>(`.ct-tile[data-device="${id}"]`)!;
  const action = (id: string) => tile(id).querySelector('.ct-act')!.getAttribute('data-action');
  const state = (id: string) => tile(id).querySelector('.ct-state')!.textContent;
  const tap = (id: string) => tile(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  /** A mouse press and release on the bar at `fraction` of its width (the bar is 100 px wide at x 0). */
  const barAt = (id: string, fraction: number) => {
    const bar = tile(id).querySelector<HTMLElement>('.ct-bar')!;
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 28, right: 100, bottom: 28 }) as DOMRect;
    const ev = (type: string) => new win.PointerEvent(type, { pointerType: 'mouse', clientX: fraction * 100, bubbles: true });
    bar.dispatchEvent(ev('pointerdown'));
    bar.dispatchEvent(ev('pointerup'));
    bar.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  return { w, root, tile, action, state, tap, barAt, onSet };
}

describe('curtainAction', () => {
  const c = (o: object) => ({ position: null, moving: 0, closed: null, lastDir: 0, ...o });
  it('closes an open curtain and opens a closed one', () => {
    expect(win.curtainAction(c({ position: 1 }))).toBe('close');
    expect(win.curtainAction(c({ position: 0 }))).toBe('open');
  });

  it('turns a moving curtain round', () => {
    expect(win.curtainAction(c({ position: 0.5, moving: 1 }))).toBe('close');
    expect(win.curtainAction(c({ position: 0.5, moving: -1 }))).toBe('open');
    expect(win.curtainAction(c({ position: 0, moving: 1 }))).toBe('close');
  });

  it('sends a half-open curtain to the nearer end, or reverses its last move', () => {
    expect(win.curtainAction(c({ position: 0.6 }))).toBe('close');
    expect(win.curtainAction(c({ position: 0.4 }))).toBe('open');
    expect(win.curtainAction(c({ position: 0.6, lastDir: -1 }), 'reverse')).toBe('open');
    expect(win.curtainAction(c({ position: 0.4, lastDir: 1 }), 'reverse')).toBe('close');
    // Without a known last move, the nearer end.
    expect(win.curtainAction(c({ position: 0.6 }), 'reverse')).toBe('close');
  });

  it('uses open/closed without a position, and nothing for a curtain it cannot move', () => {
    expect(win.curtainAction(c({ closed: true }))).toBe('open');
    expect(win.curtainAction(c({ closed: false }))).toBe('close');
    expect(win.curtainAction(c({}))).toBe('open');
    expect(win.curtainAction(c({ lastDir: 1 }))).toBe('close');
    expect(win.curtainAction(c({ position: 1, canMove: false }))).toBe(null);
  });
});

describe('render', () => {
  it('shows the state and what a tap does', () => {
    const { action, state, tile } = widget([curtain('a', 1), curtain('b', 0), curtain('c', 0.42), plain('d', false)]);
    expect([action('a'), action('b'), action('c'), action('d')]).toEqual(['close', 'open', 'open', 'close']);
    expect([state('a'), state('b'), state('c'), state('d')]).toEqual(['Open', 'Closed', '42% open', 'Open']);
    expect(tile('a').querySelector('.ct-act')!.textContent).toBe('Close');
    expect(tile('a').classList.contains('open')).toBe(true);
    expect(tile('b').classList.contains('open')).toBe(false);
    expect(tile('d').classList.contains('no-position')).toBe(true);
  });

  it('follows the motor: the other way while it moves', () => {
    const { w, action, state, tile } = widget([curtain('a', 0.3)]);
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_state', value: 'up' });
    expect(action('a')).toBe('close');
    expect(state('a')).toBe('Opening…');
    expect(tile('a').classList.contains('moving')).toBe(true);
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 0.6 });
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_state', value: 'idle' });
    expect(action('a')).toBe('close');
    expect(state('a')).toBe('60% open');
  });

  it('marks missing devices', () => {
    const { tile } = widget([{ id: 'gone', missing: true }]);
    expect(tile('gone').classList.contains('missing')).toBe(true);
    expect(tile('gone').querySelector('.ct-name')!.textContent).toBe('Unavailable');
  });
});

describe('taps', () => {
  it('sends the end position, then shows the curtain moving; a tap while it moves turns it round', async () => {
    const { w, tap, onSet, action, state, tile } = widget([curtain('a', 0.7)]);
    tap('a');
    expect(onSet).toHaveBeenCalledWith('a', { position: 0 });
    expect(action('a')).toBe('open');
    expect(state('a')).toBe('Closing…');
    expect(tile('a').classList.contains('heading')).toBe(true);
    expect(tile('a').style.getPropertyValue('--ct-target')).toBe('0');
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_state', value: 'down' });
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 0.5 });
    tap('a');
    expect(onSet).toHaveBeenLastCalledWith('a', { position: 1 });
    // Opening at once, though the motor still says down until it reports.
    expect(state('a')).toBe('Opening…');
    expect(action('a')).toBe('close');
    expect(tile('a').style.getPropertyValue('--ct-target')).toBe('1');
  });

  it('draws triangles apart for open and together for close, up and down for blinds', () => {
    const blind = { ...curtain('c', 1), kind: 'blinds' };
    const { tile } = widget([curtain('a', 1), curtain('b', 0), blind]);
    const path = (id: string) => tile(id).querySelector('.ct-act path')!.getAttribute('d');
    expect(path('a')).toBe('M8 10L2 5v10zM12 10l6-5v10z'); // close: pointing in
    expect(path('b')).toBe('M1 10l6-5v10zM19 10l-6-5v10z'); // open: pointing out
    expect(path('c')).toBe('M10 16l7-9H3z'); // a blind closes down
  });

  it('stops counting a curtain as moving once it reports the target', () => {
    const { w, tap, action } = widget([positionOnly('a', 0)]);
    tap('a');
    expect(action('a')).toBe('close'); // moving: a tap turns it round
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 1 });
    expect(action('a')).toBe('close');
    expect(win.document.querySelector('.ct-state').textContent).toBe('Open');
  });

  it('shows a curtain as there once it reports the target, though its motor never reported', () => {
    const { w, tap, state } = widget([curtain('a', 0)]);
    tap('a');
    expect(state('a')).toBe('Opening…');
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 1 });
    expect(state('a')).toBe('Open');
  });

  it('gives up waiting after a minute', async () => {
    const { tap, state } = widget([positionOnly('a', 0)]);
    tap('a');
    expect(state('a')).toBe('Opening…');
    await vi.advanceTimersByTimeAsync(61e3);
    expect(state('a')).toBe('Closed');
  });

  it('reverses the last move with the reverse rule', () => {
    const { w, tap, onSet, action } = widget([curtain('a', 0.2)], { between: 'reverse' });
    expect(action('a')).toBe('open'); // nothing known yet: the nearer end
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 0.6 }); // it opened
    expect(action('a')).toBe('close');
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 0.55 }); // then closed a little
    expect(action('a')).toBe('open');
    tap('a');
    expect(onSet).toHaveBeenCalledWith('a', { position: 1 });
  });

  it('sets the position from the bar', () => {
    const { barAt, onSet } = widget([curtain('a', 0)]);
    barAt('a', 0.35);
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith('a', { position: 0.35 });
  });

  it('shakes the tile and says so when a change fails', async () => {
    const onSet = vi.fn(async () => { throw new Error('nope'); });
    const { tap, tile, root, action } = widget([curtain('a', 1)], { onSet });
    tap('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(tile('a').classList.contains('shake')).toBe(true);
    expect(root.querySelector('.ct-message')!.textContent).toBe('Could not change Curtain a.');
    expect(action('a')).toBe('close');
  });
});

describe('showState', () => {
  it('shows the state under the name unless it is turned off', () => {
    const on = widget([curtain('a', 1)]);
    expect(on.root.classList.contains('ct-no-state')).toBe(false);
    const off = widget([curtain('b', 1)], { showState: false });
    expect(off.root.classList.contains('ct-no-state')).toBe(true);
    expect(off.state('b')).toBe('Open'); // still there for the label, only hidden
  });
});

describe('ends', () => {
  it('counts 1 % and 99 % (and up to 5 %) as closed and open', () => {
    const { action, state } = widget([curtain('a', 0.99), curtain('b', 0.01), curtain('c', 0.95), curtain('d', 0.94)]);
    expect([state('a'), state('b'), state('c'), state('d')]).toEqual(['Open', 'Closed', 'Open', '94% open']);
    expect([action('a'), action('b')]).toEqual(['close', 'open']);
  });

  it('counts a curtain stopping at 99 % as there', () => {
    const { w, tap, state } = widget([curtain('a', 0)]);
    tap('a');
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 0.99 });
    expect(state('a')).toBe('Open');
  });
});

describe('invert', () => {
  it('reads position 0 as open and 1 as closed, and sends it that way', () => {
    const { tap, barAt, onSet, action, state, tile } = widget([curtain('a', 0), curtain('b', 0.99), curtain('c', 0.3)], { invert: true });
    expect([state('a'), state('b'), state('c')]).toEqual(['Open', 'Closed', '70% open']);
    expect([action('a'), action('b')]).toEqual(['close', 'open']);
    expect(tile('c').style.getPropertyValue('--ct-x')).toBe('0.7');
    tap('a');
    expect(onSet).toHaveBeenLastCalledWith('a', { position: 1 }); // closing
    barAt('b', 0.25);
    expect(onSet).toHaveBeenLastCalledWith('b', { position: 0.75 }); // 25 % open
  });

  it('follows an inverted curtain as it moves', () => {
    const { w, action, state } = widget([curtain('a', 0.5)], { invert: true, between: 'reverse' });
    w.pushChange({ deviceId: 'a', capabilityId: 'windowcoverings_set', value: 0.4 }); // opening
    expect(state('a')).toBe('60% open');
    expect(action('a')).toBe('close'); // reverses the opening
  });

  it('leaves a curtain without a position to the app', () => {
    const { tap, onSet } = widget([plain('d', true)], { invert: true });
    tap('d');
    expect(onSet).toHaveBeenCalledWith('d', { action: 'open' });
  });
});

describe('groupByZone', () => {
  it('puts the curtains of one room on one tile that moves them all', () => {
    const { root, tap, onSet, state, action } = widget([curtain('a', 1), curtain('b', 0.5), plain('c', true)], { groupByZone: true });
    const tiles = [...root.querySelectorAll('.ct-tile')].map(t => t.getAttribute('data-device'));
    expect(tiles).toEqual(['zone:z1', 'c']);
    expect(state('zone:z1')).toBe('75% open');
    expect(action('zone:z1')).toBe('close');
    tap('zone:z1');
    expect(onSet.mock.calls).toEqual([['a', { position: 0 }], ['b', { position: 0 }]]);
  });
});
