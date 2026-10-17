// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOW_ICON_PATHS } from './helpers/flowIcons.js';
import { counterKey } from '../lib/DaysSinceService.js';
import { loadWidget } from './helpers/loadWidget.js';
import { touch } from './helpers/touch.js';

let win: any;
beforeAll(() => { win = loadWidget('dayssince'); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:40:00+02:00')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const DAY = 864e5;
const HOUR = 3600e3;
const COUNTERS = [
  { key: 'plants', name: 'Plants', icon: 'leaf', amber: 5, red: 7 },
  { key: 'filter', name: 'Filter', icon: 'vacuum', amber: 60, red: 90 },
  { key: 'fish', name: 'Fish', icon: null, amber: null, red: null },
];

function widget(entries: object[], opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onReset = vi.fn(async (name: string) => ({ now: Date.now(), counter: { key: counterKey(name), name, resetAt: Date.now() } }) as any);
  const onUndo = vi.fn(async (_name: string, _at: number) => null as any);
  const onHaptic = vi.fn();
  const w = win.createDaysSinceWidget(root, { counters: COUNTERS, language: 'en', onReset, onUndo, onHaptic, ...opts });
  w.setState({ now: Date.now(), language: 'en', counters: entries });
  const tiles = () => [...root.querySelectorAll<HTMLElement>('.ds-tile')];
  const value = (i: number) => tiles()[i].querySelector('.ds-value')!.textContent;
  const undo = (i: number) => tiles()[i].querySelector<HTMLElement>('.ds-undo')!;
  const message = () => root.querySelector<HTMLElement>('.ds-message')!;
  return { w, root, tiles, value, undo, message, onReset, onUndo, onHaptic };
}

const tap = (node: HTMLElement) => { touch(node, 'touchstart', 10, 10); touch(node, 'touchend', 10, 10); };

describe('helpers', () => {
  it('shows the time since in friendly units, or days only', () => {
    const text = (days: number, units = 'friendly') => win.daysSinceText(days, units, 'en', 'en-GB');
    expect(text(0)).toBe('Today');
    expect(text(1)).toBe('1 day');
    expect(text(13)).toBe('13 days');
    expect(text(14)).toBe('2 weeks');
    expect(text(60)).toBe('8 weeks');
    expect(text(61)).toBe('2 months');
    expect(text(364)).toBe('11 months');
    expect(text(365)).toBe('1 year');
    expect(text(82, 'days')).toBe('82 days');
    expect(text(800, 'days')).toBe('800 days');
  });

  it('uses each language\'s plurals', () => {
    expect(win.daysSinceText(6, 'friendly', 'da', 'da-DK')).toBe('6 dage');
    expect(win.daysSinceText(2, 'friendly', 'ru', 'ru-RU')).toBe('2 дня');
    expect(win.daysSinceText(5, 'friendly', 'ru', 'ru-RU')).toBe('5 дней');
    expect(win.daysSinceText(21, 'friendly', 'ru', 'ru-RU')).toBe('3 недели');
  });

  it('counts calendar days, not 24 hours', () => {
    const at = (s: string) => new Date(s).getTime();
    expect(win.daysSinceCalendarDays(at('2026-10-05T22:00:00+02:00'), at('2026-10-06T07:00:00+02:00'))).toBe(1);
    expect(win.daysSinceCalendarDays(at('2026-10-06T00:10:00+02:00'), at('2026-10-06T23:50:00+02:00'))).toBe(0);
  });

  it('turns amber, then red, the set days of 24 h after the reset', () => {
    const c = { amber: 5, red: 7 };
    const r = Date.now();
    expect(win.daysSinceLevel(c, r, r + 5 * DAY - 1)).toBeNull();
    expect(win.daysSinceLevel(c, r, r + 5 * DAY)).toBe('amber');
    expect(win.daysSinceLevel(c, r, r + 7 * DAY)).toBe('red');
    expect(win.daysSinceLevel({ amber: null, red: null }, r, r + 99 * DAY)).toBeNull();
    expect(win.daysSinceLevel(c, null, r)).toBeNull();
  });

  it('reads the counters from the settings', () => {
    const counters = win.daysSinceCountersFromSettings({
      counter1: { id: 'Plants', name: 'Plants' }, icon1: { id: 'leaf' }, amber1: 3, red1: 0,
      counter2: { id: 'none', name: 'None' },
      counter3: { id: ' Filter ', name: 'Filter' }, icon3: { id: 'none' },
      counter4: { id: 'Fish', name: 'Fish' }, icon4: { id: 'gone' },
    });
    expect(counters).toEqual([
      { key: 'plants', name: 'Plants', icon: 'leaf', amber: 3, red: null },
      { key: 'filter', name: 'Filter', icon: null, amber: 5, red: 7 },
      { key: 'fish', name: 'Fish', icon: 'clock', amber: 5, red: 7 },
    ]);
  });

  it('keys counters as the app does', () => {
    for (const name of ['Plants', '  Vacuum Filter ', 'x'.repeat(70), '', '__proto__', 'ÆBLE']) expect(win.daysSinceKey(name)).toBe(counterKey(name));
  });

});

describe('tiles', () => {
  it('shows each counter\'s time since and colour', () => {
    const { tiles, value } = widget([
      { key: 'plants', resetAt: Date.now() - 6 * DAY },
      { key: 'filter', resetAt: Date.now() - 82 * DAY },
      { key: 'fish', resetAt: null },
    ]);
    expect(value(0)).toBe('6 days');
    expect(tiles()[0].dataset.level).toBe('amber');
    expect(value(1)).toBe('2 months');
    expect(tiles()[1].dataset.level).toBe('amber'); // amber from 60 days, red from 90
    expect(value(2)).toBe('Not started');
    expect(tiles()[2].classList.contains('not-started')).toBe(true);
    expect(tiles()[0].querySelector('.ds-icon path')!.getAttribute('d')).toBe(FLOW_ICON_PATHS.leaf.d);
    expect(tiles()[2].querySelector('.ds-icon')).toBeNull();
    expect(tiles()[0].getAttribute('aria-label')).toBe('Plants: 6 days. Tap to reset.');
  });

  it('says 7 days on the 7th day, but turns red only at the time of the reset', () => {
    // Reset at 20:00 seven days ago: it's the 7th calendar day, 22 h 40 min of 24 h short of 7 days.
    const resetAt = new Date('2026-09-29T20:00:00+02:00').getTime();
    const { tiles, value } = widget([{ key: 'plants', resetAt }]);
    expect(value(0)).toBe('7 days');
    expect(tiles()[0].dataset.level).toBe('amber');
    vi.advanceTimersByTime(80 * 60e3 + 1000); // 20:01
    expect(tiles()[0].dataset.level).toBe('red');
  });

  it('rolls over at midnight', () => {
    const { value } = widget([{ key: 'plants', resetAt: Date.now() - HOUR }]);
    expect(value(0)).toBe('Today');
    vi.advanceTimersByTime(5 * HOUR + 30 * 60e3); // 00:10
    expect(value(0)).toBe('1 day');
  });

  it('corrects for the Homey\'s clock', () => {
    const { w, value } = widget([]);
    // The Homey is a day ahead of this screen: its reset of "now" is a day in this screen's future.
    w.setState({ now: Date.now() + DAY, language: 'en', counters: [{ key: 'plants', resetAt: Date.now() + DAY - 3 * DAY }] });
    expect(value(0)).toBe('3 days');
  });

  it('asks for counters in the settings without any', () => {
    const { tiles, message } = widget([], { counters: [] });
    expect(tiles()).toHaveLength(0);
    expect(message().textContent).toBe('Name your counters in the widget settings.');
  });

  it('a failed first load shows the error instead of the tiles; a failed refresh keeps them', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const w = win.createDaysSinceWidget(root, { counters: COUNTERS });
    w.setMessage('Could not load the counters.', false);
    expect(root.querySelector<HTMLElement>('.ds-grid')!.style.display).toBe('none');
    w.setState({ now: Date.now(), counters: [{ key: 'plants', resetAt: Date.now() }] });
    w.setMessage('Could not load the counters.', true);
    expect(root.querySelector<HTMLElement>('.ds-grid')!.style.display).toBe('');
  });

  it('takes realtime changes for its counters', () => {
    const { w, value } = widget([{ key: 'plants', resetAt: Date.now() - 6 * DAY }]);
    w.update({ key: 'plants', name: 'Plants', resetAt: Date.now() - DAY });
    expect(value(0)).toBe('1 day');
    w.update({ key: 'other', resetAt: 0 });
    expect(value(0)).toBe('1 day');
  });
});

describe('reset and undo', () => {
  it('a tap resets at once and offers Undo for 5 s', async () => {
    const { tiles, value, onReset, onHaptic } = widget([{ key: 'plants', resetAt: Date.now() - 8 * DAY }]);
    expect(tiles()[0].dataset.level).toBe('red');
    tap(tiles()[0]);
    expect(value(0)).toBe('Today');
    expect(tiles()[0].dataset.level).toBeUndefined();
    expect(tiles()[0].classList.contains('undoable')).toBe(true);
    expect(onReset).toHaveBeenCalledWith('Plants');
    expect(onHaptic).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5100);
    expect(tiles()[0].classList.contains('undoable')).toBe(false);
  });

  it('Undo brings the old time back and sends the app\'s resetAt', async () => {
    const before = Date.now() - 8 * DAY;
    const { tiles, value, undo, onReset, onUndo } = widget([{ key: 'plants', resetAt: before }]);
    onUndo.mockImplementation(async () => ({ now: Date.now(), undone: true, counter: { key: 'plants', resetAt: before } }));
    tap(tiles()[0]);
    await vi.advanceTimersByTimeAsync(0);
    const at = (await onReset.mock.results[0].value).counter.resetAt;
    tap(undo(0));
    expect(value(0)).toBe('8 days');
    expect(tiles()[0].dataset.level).toBe('red');
    expect(tiles()[0].classList.contains('undoable')).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUndo).toHaveBeenCalledWith('Plants', at);
    expect(onReset).toHaveBeenCalledTimes(1); // the Undo tap isn't also the tile's
    expect(value(0)).toBe('8 days');
  });

  it('a tap on the tile while Undo shows does nothing', async () => {
    const { tiles, onReset } = widget([{ key: 'plants', resetAt: Date.now() - 8 * DAY }]);
    tap(tiles()[0]);
    await vi.advanceTimersByTimeAsync(0);
    tap(tiles()[0]);
    expect(onReset).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5100);
    tap(tiles()[0]);
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('Undo before the reset has answered waits for it', async () => {
    const before = Date.now() - 2 * DAY;
    let answer: (v: any) => void = () => {};
    const { tiles, undo, onUndo } = widget([{ key: 'plants', resetAt: before }], {
      onReset: () => new Promise((r) => { answer = r; }),
    });
    tap(tiles()[0]);
    tap(undo(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUndo).not.toHaveBeenCalled();
    answer({ now: Date.now(), counter: { key: 'plants', resetAt: Date.now() } });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUndo).toHaveBeenCalledWith('Plants', Date.now());
  });

  it('a failed reset puts the time back and shakes the tile', async () => {
    const { tiles, value, message } = widget([{ key: 'plants', resetAt: Date.now() - 6 * DAY }], {
      onReset: async () => { throw new Error('offline'); },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tap(tiles()[0]);
    expect(value(0)).toBe('Today');
    await vi.advanceTimersByTimeAsync(0);
    expect(value(0)).toBe('6 days');
    expect(tiles()[0].classList.contains('shake')).toBe(true);
    expect(tiles()[0].classList.contains('undoable')).toBe(false);
    expect(message().textContent).toBe('Could not reset Plants.');
  });

  it('an undo the app refuses shows the app\'s time', async () => {
    const { tiles, value, undo, message } = widget([{ key: 'plants', resetAt: Date.now() - 6 * DAY }], {
      onUndo: async () => ({ now: Date.now(), undone: false, counter: { key: 'plants', resetAt: Date.now() } }),
    });
    tap(tiles()[0]);
    await vi.advanceTimersByTimeAsync(0);
    tap(undo(0));
    expect(value(0)).toBe('6 days');
    await vi.advanceTimersByTimeAsync(0);
    expect(value(0)).toBe('Today');
    expect(message().textContent).toBe('Could not undo the reset of Plants.');
  });

  it('a failed undo keeps the reset', async () => {
    const { tiles, value, undo } = widget([{ key: 'plants', resetAt: Date.now() - 6 * DAY }], {
      onUndo: async () => { throw new Error('offline'); },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tap(tiles()[0]);
    await vi.advanceTimersByTimeAsync(0);
    tap(undo(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(value(0)).toBe('Today');
    expect(tiles()[0].classList.contains('shake')).toBe(true);
  });
});
