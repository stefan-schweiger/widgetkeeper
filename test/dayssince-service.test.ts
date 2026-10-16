import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey } from './helpers/fakeHomey.js';
import DaysSinceService, {
  calendarDays, counterKey, DAY, DAYS_SINCE_SETTING, DAYS_SINCE_STATE_EVENT, intervalDays, isOverdueAt,
} from '../lib/DaysSinceService.js';

const HOUR = 3600e3;

function setup(saved?: unknown) {
  const homey = fakeHomey(fakeApi());
  if (saved !== undefined) homey.settings.set(DAYS_SINCE_SETTING, saved);
  const overdue = vi.fn();
  const service = new DaysSinceService(homey, () => {}, () => {}, overdue);
  service.start();
  return { homey, service, overdue };
}

/** Lets the trigger's Promise.resolve().then() run. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T18:40:00+02:00'));
});
afterEach(() => { vi.useRealTimers(); });

describe('helpers', () => {
  it('keys counters by their trimmed, lower-cased name', () => {
    expect(counterKey(' Plants ')).toBe('plants');
    expect(counterKey('Vacuum filter')).toBe('vacuum filter');
    expect(counterKey('x'.repeat(80))).toBe('x'.repeat(60));
    for (const bad of ['', '   ', null, undefined, 3, {}, '__proto__', 'Constructor', 'prototype']) expect(counterKey(bad)).toBeNull();
  });

  it('reads intervals as positive days, else off', () => {
    expect(intervalDays(7)).toBe(7);
    expect(intervalDays(0.5)).toBe(0.5);
    expect(intervalDays(99999)).toBe(3650);
    for (const off of [0, -1, NaN, Infinity, '7', null, undefined]) expect(intervalDays(off)).toBeNull();
  });

  it('counts calendar days in the timezone, also across DST', () => {
    const tz = 'Europe/Copenhagen';
    const at = (s: string) => new Date(s).getTime();
    expect(calendarDays(at('2026-10-06T08:00:00+02:00'), at('2026-10-06T23:59:00+02:00'), tz)).toBe(0);
    expect(calendarDays(at('2026-10-05T22:00:00+02:00'), at('2026-10-06T07:00:00+02:00'), tz)).toBe(1);
    // Summer time ends on 25 October: 7 × 24 h from 23:30 on the 21st is 22:30 on the 28th.
    expect(calendarDays(at('2026-10-21T23:30:00+02:00'), at('2026-10-21T23:30:00+02:00') + 7 * DAY, tz)).toBe(7);
    // And a week of 24 h from 00:30 the day before it starts again (29 March 2026) lands at 01:30, still that date.
    expect(calendarDays(at('2026-03-28T00:30:00+01:00'), at('2026-03-28T00:30:00+01:00') + 7 * DAY, tz)).toBe(7);
  });

  it('is overdue red days of 24 h after the reset', () => {
    const resetAt = Date.now();
    expect(isOverdueAt({ resetAt, red: 7 }, resetAt + 7 * DAY - 1)).toBe(false);
    expect(isOverdueAt({ resetAt, red: 7 }, resetAt + 7 * DAY)).toBe(true);
    expect(isOverdueAt({ resetAt: null, red: 7 }, resetAt + 70 * DAY)).toBe(false);
    expect(isOverdueAt({ resetAt, red: null }, resetAt + 70 * DAY)).toBe(false);
  });
});

describe('counters', () => {
  it('creates a widget\'s counters, takes their intervals and answers them in order', () => {
    const { homey, service } = setup();
    const res = service.sync([{ name: 'Plants', amber: 5, red: 7 }, { name: 'Filter', amber: 0, red: 90 }]);
    expect(res.now).toBe(Date.now());
    expect(res.counters).toEqual([
      { key: 'plants', name: 'Plants', resetAt: null, amber: 5, red: 7 },
      { key: 'filter', name: 'Filter', resetAt: null, amber: null, red: 90 },
    ]);
    expect(homey.api.realtime).toHaveBeenCalledWith(DAYS_SINCE_STATE_EVENT, expect.objectContaining({ key: 'plants' }));
    // Another widget with other intervals: the last one wins.
    expect(service.sync([{ name: ' plants', amber: 2, red: 3 }]).counters[0]).toMatchObject({ key: 'plants', name: 'plants', amber: 2, red: 3 });
  });

  it('resets a counter, which every widget hears', () => {
    const { homey, service } = setup();
    service.sync([{ name: 'Plants', amber: 5, red: 7 }]);
    vi.advanceTimersByTime(HOUR);
    const res = service.reset('Plants', true);
    expect(res.counter).toMatchObject({ key: 'plants', resetAt: Date.now() });
    expect(homey.api.realtime).toHaveBeenLastCalledWith(DAYS_SINCE_STATE_EVENT, res.counter);
    expect(() => service.reset('  ')).toThrow('Missing counter');
  });

  it('a Flow can reset a counter no widget has shown yet', () => {
    const { service } = setup();
    expect(service.reset('Gutters').counter).toMatchObject({ key: 'gutters', name: 'Gutters', resetAt: Date.now(), red: null });
  });

  it('undoes a widget\'s reset within a minute', () => {
    const { service } = setup();
    service.sync([{ name: 'Plants', red: 7 }]);
    const first = service.reset('Plants', true).counter.resetAt;
    vi.advanceTimersByTime(2 * DAY);
    const { counter } = service.reset('Plants', true);
    vi.advanceTimersByTime(3000);
    const res = service.undo('plants', counter.resetAt);
    expect(res.undone).toBe(true);
    expect(res.counter!.resetAt).toBe(first);
    // Once is enough.
    expect(service.undo('Plants', counter.resetAt).undone).toBe(false);
  });

  it('doesn\'t undo a stale reset, a Flow\'s, or one after a minute', () => {
    const { service } = setup();
    service.sync([{ name: 'Plants', red: 7 }]);
    const a = service.reset('Plants', true).counter.resetAt!;
    expect(service.undo('Plants', a - 1).undone).toBe(false);
    vi.advanceTimersByTime(1000);
    service.reset('Plants'); // a Flow's reset since
    expect(service.undo('Plants', a)).toMatchObject({ undone: false, counter: { resetAt: Date.now() } });
    const b = service.reset('Plants', true).counter.resetAt!;
    vi.advanceTimersByTime(61e3);
    expect(service.undo('Plants', b).undone).toBe(false);
    expect(service.undo('Unknown', 1)).toEqual({ now: Date.now(), undone: false, counter: null });
  });

  it('sets a counter some days back, for what was done before the widget', () => {
    const { service } = setup();
    expect(service.setDaysAgo('Filter', 30).resetAt).toBe(Date.now() - 30 * DAY);
    for (const bad of [-1, 4000, NaN, '3']) expect(() => service.setDaysAgo('Filter', bad)).toThrow('Invalid days');
  });

  it('keeps the counters over a restart', () => {
    const { homey, service } = setup();
    service.sync([{ name: 'Plants', amber: 5, red: 7 }]);
    service.reset('Plants', true);
    vi.advanceTimersByTime(3000);
    const again = new DaysSinceService(homey, () => {}, () => {});
    again.start();
    expect(again.sync([{ name: 'Plants', amber: 5, red: 7 }]).counters[0].resetAt).toBe(Date.now() - 3000);
  });

  it('ignores junk in the saved setting', () => {
    const { service } = setup({
      plants: { name: 'Plants', resetAt: 5, amber: 5, red: 7, overdue: false, updatedAt: 1 },
      wrongkey: { name: 'Other', resetAt: 5 },
      junk: 'x',
      empty: { name: '' },
    });
    expect(service.describe().counters).toBe(1);
  });

  it('keeps at most 50 counters, dropping the oldest', () => {
    const { service } = setup();
    for (let i = 0; i < 52; i++) {
      service.sync([{ name: `Counter ${i}` }]);
      vi.advanceTimersByTime(1000);
    }
    expect(service.describe().counters).toBe(50);
    expect(service.listCounters('Counter 0')).toEqual([]);
    expect(service.listCounters('Counter 2').map(i => i.name)).toContain('Counter 2');
  });
});

describe('overdue', () => {
  it('fires once, red days after the reset', async () => {
    const { service, overdue } = setup();
    service.sync([{ name: 'Plants', amber: 5, red: 7 }]);
    service.reset('Plants', true);
    vi.advanceTimersByTime(7 * DAY - 2 * 60e3);
    await flush();
    expect(overdue).not.toHaveBeenCalled();
    expect(service.isOverdue({ id: 'Plants' })).toBe(false);
    vi.advanceTimersByTime(3 * 60e3);
    await flush();
    expect(overdue).toHaveBeenCalledTimes(1);
    expect(overdue).toHaveBeenCalledWith({ key: 'plants', name: 'Plants', days: 7 });
    expect(service.isOverdue({ id: 'plants' })).toBe(true);
    vi.advanceTimersByTime(2 * DAY);
    await flush();
    expect(overdue).toHaveBeenCalledTimes(1);
  });

  it('fires again when a raised interval runs out', async () => {
    const { service, overdue } = setup();
    service.sync([{ name: 'Plants', red: 7 }]);
    service.setDaysAgo('Plants', 8);
    await flush();
    expect(overdue).toHaveBeenCalledTimes(1); // back-dated past red: at once
    service.sync([{ name: 'Plants', red: 10 }]);
    expect(service.isOverdue({ name: 'Plants' })).toBe(false);
    vi.advanceTimersByTime(2 * DAY + 2 * 60e3);
    await flush();
    expect(overdue).toHaveBeenCalledTimes(2);
  });

  it('a lowered interval that the counter is already past fires', async () => {
    const { service, overdue } = setup();
    service.sync([{ name: 'Filter', red: 90 }]);
    service.setDaysAgo('Filter', 40);
    service.sync([{ name: 'Filter', red: 30 }]);
    await flush();
    expect(overdue).toHaveBeenCalledWith(expect.objectContaining({ key: 'filter', days: 40 }));
  });

  it('undoing the reset of an overdue counter makes it overdue again without firing', async () => {
    const { service, overdue } = setup();
    service.sync([{ name: 'Plants', red: 7 }]);
    service.setDaysAgo('Plants', 9);
    await flush();
    expect(overdue).toHaveBeenCalledTimes(1);
    const { counter } = service.reset('Plants', true);
    expect(service.isOverdue({ id: 'Plants' })).toBe(false);
    service.undo('Plants', counter.resetAt);
    vi.advanceTimersByTime(5 * 60e3);
    await flush();
    expect(service.isOverdue({ id: 'Plants' })).toBe(true);
    expect(overdue).toHaveBeenCalledTimes(1);
  });

  it('doesn\'t fire again after a restart, but fires for a counter that turned red while stopped', async () => {
    const first = setup();
    first.service.sync([{ name: 'Plants', red: 7 }, { name: 'Sheets', red: 14 }]);
    first.service.setDaysAgo('Plants', 8);
    first.service.setDaysAgo('Sheets', 13.5);
    await flush();
    expect(first.overdue).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    await first.service.stop();
    vi.advanceTimersByTime(DAY); // the app is stopped meanwhile: Sheets turns red
    const overdue = vi.fn();
    const again = new DaysSinceService(first.homey, () => {}, () => {}, overdue);
    again.start();
    await flush();
    expect(overdue).toHaveBeenCalledTimes(1);
    expect(overdue).toHaveBeenCalledWith(expect.objectContaining({ key: 'sheets' }));
  });

  it('matches the trigger to its counter, or any', () => {
    const { service } = setup();
    expect(service.matches({ id: 'Plants', name: 'Plants' }, 'plants')).toBe(true);
    expect(service.matches({ id: 'Plants' }, 'filter')).toBe(false);
    expect(service.matches({ id: 'dayssince:any', any: true }, 'filter')).toBe(true);
    expect(service.matches(undefined, 'filter')).toBe(false);
  });

  it('the condition with Any counter: whether any is red', () => {
    const { service } = setup();
    service.sync([{ name: 'Plants', red: 7 }, { name: 'Filter', red: 90 }]);
    expect(service.isOverdue({ any: true })).toBe(false);
    service.setDaysAgo('Filter', 91);
    expect(service.isOverdue({ any: true })).toBe(true);
    expect(service.isOverdue({ id: 'Plants' })).toBe(false);
    expect(service.isOverdue({ id: 'Nothing' })).toBe(false);
  });

  it('Any counter can\'t be reset', () => {
    const { service } = setup();
    expect(() => service.argName({ id: 'dayssince:any', any: true })).toThrow('Pick a counter');
    expect(service.argName({ id: 'Plants', name: 'Plants' })).toBe('Plants');
  });
});

describe('listCounters', () => {
  it('lists the counters by name with their days, a new name, None and Any counter', () => {
    const { service } = setup();
    service.sync([{ name: 'Plants', red: 7 }, { name: 'Filter', red: 90 }]);
    service.setDaysAgo('Plants', 6);
    expect(service.listCounters('')).toEqual([
      { name: 'Filter', id: 'Filter', description: 'Not started' },
      { name: 'Plants', id: 'Plants', description: '6 days' },
    ]);
    expect(service.listCounters('fil', { create: true }).map(i => i.name)).toEqual(['Filter', 'fil']);
    expect(service.listCounters('filter', { create: true }).map(i => i.name)).toEqual(['Filter']);
    expect(service.listCounters('Fish', { create: true })).toEqual([{ name: 'Fish', id: 'Fish', description: 'New counter' }]);
    expect(service.listCounters('', { none: true, any: true }).map(i => i.id)).toEqual(['none', 'dayssince:any', 'Filter', 'Plants']);
    expect(service.listCounters('', { any: true })[0]).toEqual({ name: 'Any counter', id: 'dayssince:any', any: true });
    service.reset('Plants');
    expect(service.listCounters('Plants')[0].description).toBe('Today');
  });

  it('describes counts only', () => {
    const { service } = setup();
    service.sync([{ name: 'Secret chore', red: 7 }, { name: 'Other' }]);
    service.setDaysAgo('Secret chore', 8);
    const d = service.describe();
    expect(d).toEqual({ counters: 2, started: 1, withRed: 1, overdue: 1 });
    expect(JSON.stringify(d)).not.toContain('Secret');
  });
});
