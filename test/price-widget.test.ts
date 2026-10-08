// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('price'); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:20:00+02:00')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const HOUR = 36e5;
// Today's prices by local hour: cheap at night, the peak at 18.
const DAY = [1.30, 1.25, 1.22, 1.20, 1.22, 1.35, 1.75, 2.25, 2.38, 2.05, 1.75, 1.50, 1.30, 1.22, 1.25, 1.40, 1.85, 2.30, 2.58, 2.50, 2.15, 1.80, 1.60, 1.42];

/** 49 slots from 24 hours before the current hour, as `/price` sends them. */
function snapshot(edit?: (price: number, start: Date) => number | null) {
  const first = new Date('2026-10-06T18:00:00+02:00').getTime() - 24 * HOUR;
  const prices = Array.from({ length: 49 }, (_, i) => {
    const start = new Date(first + i * HOUR);
    const p = DAY[start.getHours()];
    return { start: start.getTime(), price: edit ? edit(p, start) : p };
  });
  return { prices, fixedPrice: null as number | null, currency: 'DKK', language: 'en' };
}

function widget(state: any, opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createPriceWidget(root, { locale: 'en-GB', ...opts });
  w.setState(state);
  const cell = (id: string) => {
    const c = root.querySelector<HTMLElement>(`.pb-${id}`)!;
    return c.style.display === 'none' ? null : [c.querySelector('.pb-label')!.textContent, c.querySelector('.pb-value')!.textContent];
  };
  const tile = () => root.querySelector<HTMLElement>('.pb-tile')!;
  const message = () => root.querySelector<HTMLElement>('.pb-message')!;
  return { w, root, cell, tile, message };
}

describe('price level', () => {
  it('splits the day in thirds of its range', () => {
    const day = [1, 2, 3, 4];
    expect([1, 2, 3, 4].map(p => win.electricityPriceLevel(p, day))).toEqual(['low', 'medium', 'medium', 'high']);
    expect(win.electricityPriceLevel(2, [2, 2, null])).toBe('medium');
    expect(win.electricityPriceLevel(null, day)).toBe(null);
  });
});

describe('render', () => {
  it('shows the price now with its level, the next hour and the lowest in 12 hours', () => {
    const { cell, tile } = widget(snapshot());
    expect(cell('now')).toEqual(['Now · High', '2.58 kr.']);
    expect(cell('next')).toEqual(['Next hour', '↓ 2.50 kr.']);
    expect(cell('low')).toEqual(['Lowest 12h', '03:00 · 1.20 kr.']);
    expect(tile().dataset.level).toBe('high');
  });

  it('looks 24 hours ahead, says Now when the lowest is now, and hides what is turned off', () => {
    const cheapNow = snapshot((p, start) => (start.getHours() === 18 && start.getDate() === 6 ? 0.5 : p));
    expect(widget(cheapNow, { nextLow: '24' }).cell('low')).toEqual(['Lowest 24h', 'Now · 0.50 kr.']);
    const { cell } = widget(snapshot(), { showNext: false, nextLow: 'none' });
    expect(cell('next')).toBe(null);
    expect(cell('low')).toBe(null);
  });

  it('shows a fixed price without a level', () => {
    const s = snapshot();
    s.fixedPrice = 2.1;
    const { cell, tile } = widget(s);
    expect(cell('now')).toEqual(['Fixed price', '2.10 kr.']);
    expect(cell('next')).toBe(null);
    expect(tile().dataset.level).toBeUndefined();
  });

  it('says so when Homey has no prices', () => {
    const { tile, message } = widget(snapshot(() => null));
    expect(tile().style.display).toBe('none');
    expect(message().textContent).toBe('No electricity prices. Set them up in Homey Energy.');
  });

  it('moves on to the next hour on the hour', () => {
    const { cell } = widget(snapshot());
    vi.advanceTimersByTime(40 * 60e3 + 100);
    expect(cell('now')).toEqual(['Now · High', '2.50 kr.']);
    expect(cell('next')).toEqual(['Next hour', '↓ 2.15 kr.']);
  });

  it('keeps the prices on a failed refresh', () => {
    const { w, cell, message } = widget(snapshot());
    w.setMessage('Could not load the prices.', true);
    expect(cell('now')).toEqual(['Now · High', '2.58 kr.']);
    expect(message().classList.contains('error')).toBe(true);
  });
});
