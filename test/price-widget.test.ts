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

/** 49 slots (or 25 + `ahead`) from 24 hours before the current hour, as `/price` sends them. */
function snapshot(edit?: (price: number, start: Date) => number | null, ahead = 24) {
  const first = new Date('2026-10-06T18:00:00+02:00').getTime() - 24 * HOUR;
  const prices = Array.from({ length: 25 + ahead }, (_, i) => {
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
  const tile = () => root.querySelector<HTMLElement>('.pb-tile')!;
  const now = () => [root.querySelector('.pb-label')!.textContent, root.querySelector('.pb-value')!.textContent];
  const bars = () => [...root.querySelectorAll<HTMLElement>('.pb-bar')];
  const ticks = () => [...root.querySelectorAll('.pb-tick')].map(t => t.textContent);
  const chart = () => root.querySelector<HTMLElement>('.pb-chart')!;
  const message = () => root.querySelector<HTMLElement>('.pb-message')!;
  return { w, root, tile, now, bars, ticks, chart, message };
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
  it('shows the price now with its level and the next 12 hours as bars', () => {
    const { now, tile, bars, ticks } = widget(snapshot());
    expect(now()).toEqual(['High', '2.58kr.']);
    expect(tile().dataset.level).toBe('high');
    const b = bars();
    expect(b).toHaveLength(12);
    expect(b[0].classList.contains('now')).toBe(true);
    expect(b[0].style.height).toBe('100%'); // the highest in the window
    expect(b.map(x => x.dataset.level)).toEqual(['high', 'high', 'high', 'medium', 'low', 'low', 'low', 'low', 'low', 'low', 'low', 'low']);
    // The cheapest of 18:00–05:00 is 03:00.
    expect(b.findIndex(x => x.classList.contains('lowest'))).toBe(9);
    expect(b[9].style.height).toBe('20%');
    expect(ticks()).toEqual(['Now', '21', 'Wed', '03']);
  });

  it('shows 24 or 36 hours, leaving hours without a price empty', () => {
    expect(widget(snapshot(), { hours: '24' }).bars()).toHaveLength(24);
    const { bars, ticks } = widget(snapshot(undefined, 36), { hours: 36 });
    expect(bars()).toHaveLength(36);
    expect(ticks()).toEqual(['Now', '12', 'Thu']); // Wed's midnight is too close to Now
    // Tomorrow from 18:00 isn't out yet.
    const late = widget(snapshot((p, start) => (start.getTime() >= new Date('2026-10-07T18:00:00+02:00').getTime() ? null : p), 36), { hours: '36' });
    const b = late.bars();
    expect(b.slice(24).every(x => x.classList.contains('none') && !x.style.height)).toBe(true);
    expect(b[23].classList.contains('none')).toBe(false);
  });

  it('colours each hour against its own day', () => {
    // Tomorrow is half price: its 08:00 peak is still high against tomorrow.
    const s = snapshot((p, start) => (start.getDate() === 7 ? p / 2 : p));
    const b = widget(s, { hours: '24' }).bars();
    expect(b[14].dataset.level).toBe('high'); // 08:00 tomorrow
    expect(b[14].style.height).not.toBe('100%');
  });

  it('shows a fixed price without a level or bars', () => {
    const s = snapshot();
    s.fixedPrice = 2.1;
    const { now, tile, chart } = widget(s);
    expect(now()).toEqual(['Fixed price', '2.10kr.']);
    expect(chart().style.display).toBe('none');
    expect(tile().dataset.level).toBeUndefined();
  });

  it('says so when Homey has no prices', () => {
    const { tile, message } = widget(snapshot(() => null));
    expect(tile().style.display).toBe('none');
    expect(message().textContent).toBe('No electricity prices. Set them up in Homey Energy.');
  });

  it('moves on to the next hour on the hour', () => {
    const { now, bars } = widget(snapshot());
    vi.advanceTimersByTime(40 * 60e3 + 100);
    expect(now()).toEqual(['High', '2.50kr.']);
    expect(bars()[0].style.height).toBe('100%');
  });

  it('keeps the prices on a failed refresh', () => {
    const { w, now, message } = widget(snapshot());
    w.setMessage('Could not load the prices.', true);
    expect(now()).toEqual(['High', '2.58kr.']);
    expect(message().classList.contains('error')).toBe(true);
  });
});
