// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

const MIN = 60e3;
const HOUR = 60 * MIN;
const NOW = new Date('2026-01-15T10:20:00').getTime(); // Europe/Copenhagen (vitest.config.ts)
const HOUR_START = new Date('2026-01-15T10:00:00').getTime();

let win: any;
beforeAll(() => { win = loadWidget('electricity'); });

/** A snapshot with 49 hourly slots (index 24 = now) priced 2.00 unless overridden by index. */
function snapshot(over: Record<string, any> = {}, prices: Record<number, number | null> = {}) {
  return {
    now: NOW,
    deviceName: 'Meter',
    meterError: null,
    live: [{ t: NOW - 5 * MIN, w: 400 }, { t: NOW - 10e3, w: 500 }],
    prices: Array.from({ length: 49 }, (_, i) => ({ start: HOUR_START + (i - 24) * HOUR, price: i in prices ? prices[i] : 2 })),
    usage: [],
    currency: 'DKK',
    language: 'da',
    ...over,
  };
}

function widget(snap: any, settings: Record<string, unknown> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createElectricityWidget(root, { locale: 'da-DK' });
  if (Object.keys(settings).length) w.setSettings(settings);
  w.setData(snap);
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const shown = (el: HTMLElement | null) => !!el && el.style.display !== 'none';
  const footer = () => (shown(q('.ew-footer')) ? `${q('.ew-footer .l')!.textContent} | ${q('.ew-footer .r')!.textContent}` : null);
  const messages = () => [...root.querySelectorAll<HTMLElement>('.ew-message')].filter(shown).map(m => m.textContent);
  const livePoints = () => q('.live-line')!.getAttribute('d')!.slice(1).split('L').map(p => p.split(' ').map(Number));
  return { w, root, q, shown, footer, messages, livePoints };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); });

describe('lowest price footer', () => {
  it('shows the cheapest hour in the next 12 h', () => {
    const { footer } = widget(snapshot({}, { 27: 1.22, 40: 0.5 }));
    expect(footer()).toBe('Lowest next 12h | 13:00•1,22 kr.');
  });

  it('includes the 12th hour ahead but not the 13th', () => {
    expect(widget(snapshot({}, { 36: 1 })).footer()).toBe('Lowest next 12h | 22:00•1,00 kr.');
    expect(widget(snapshot({}, { 37: 1 })).footer()).toBe('Lowest next 12h | Now•2,00 kr.');
  });

  it('picks the earliest of equal prices and says "Now" for the current hour', () => {
    expect(widget(snapshot({}, { 26: 1, 30: 1 })).footer()).toBe('Lowest next 12h | 12:00•1,00 kr.');
    expect(widget(snapshot()).footer()).toBe('Lowest next 12h | Now•2,00 kr.');
  });

  it('ignores past hours and missing prices', () => {
    expect(widget(snapshot({}, { 10: 0.1, 23: 0.1, 24: null, 25: 1.5 })).footer()).toBe('Lowest next 12h | 11:00•1,50 kr.');
  });

  it('looks 24 h ahead', () => {
    const { footer } = widget(snapshot({}, { 27: 1.22, 40: 0.5 }), { nextLow: '24' });
    expect(footer()).toBe('Lowest next 24h | 02:00•0,50 kr.');
  });

  it('shows both without the unit, or once when they are the same hour', () => {
    expect(widget(snapshot({}, { 27: 1.22, 40: 0.5 }), { nextLow: 'both' }).footer())
      .toBe('Lowest 12/24h | 13:00•1,22/02:00•0,50');
    expect(widget(snapshot({}, { 27: 0.4, 40: 0.5 }), { nextLow: 'both' }).footer())
      .toBe('Lowest 12/24h | 13:00•0,40 kr.');
  });

  it('is hidden for "none" and without prices', () => {
    expect(widget(snapshot(), { nextLow: 'none' }).footer()).toBeNull();
    const none = widget(snapshot({ prices: snapshot().prices.map(p => ({ ...p, price: null })) }));
    expect(none.footer()).toBeNull();
    expect(none.messages()).toEqual([]); // no price set up in Homey: the prices are left out silently
  });

  it('uses the currency unit', () => {
    expect(widget(snapshot({ currency: 'EUR' })).footer()).toBe('Lowest next 12h | Now•2,00 €');
  });
});

describe('header', () => {
  it('shows the latest reading and the current hour\'s price', () => {
    const { q } = widget(snapshot({}, { 24: 1.5 }));
    expect(q('.ew-hval.live')!.textContent).toBe('500W');
    expect(q('.ew-hval.price')!.textContent).toBe('1,50 kr./kWh');
    expect([...q('.ew-header')!.querySelectorAll('.ew-hsub')].map(e => e.textContent)).toEqual(['Using now', '40 min left']);
  });

  it('follows realtime readings', () => {
    const { w, q } = widget(snapshot());
    vi.setSystemTime(NOW + 2000);
    w.pushLive({ t: NOW + 2000, w: 1234 });
    expect(q('.ew-hval.live')!.textContent).toBe('1.234W');
    w.pushLive({ t: NOW + 1000, w: 900 }); // not newer: replaces the latest
    expect(q('.ew-hval.live')!.textContent).toBe('900W');
  });
});

describe('live chart', () => {
  it.each([1, 10, 60])('spans the whole %s-minute window, ending at the current reading', minutes => {
    const { livePoints, q } = widget(snapshot(), { liveWindow: minutes });
    const pts = livePoints();
    expect(pts.length).toBe(122); // the window start, 120 aligned buckets, now
    expect(pts.flat().every(Number.isFinite)).toBe(true);
    const xs = pts.map(p => p[0]);
    expect(xs[0]).toBe(38); // the left gutter
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(q('.ew-chart svg')!.getAttribute('width')).toBe(String(xs.at(-1)! + 4));
  });

  it('fills the time before the first reading with the first reading', () => {
    const { livePoints } = widget(snapshot({ live: [{ t: NOW - 30e3, w: 100 }, { t: NOW - 10e3, w: 300 }] }));
    const ys = livePoints().map(p => p[1]);
    expect(new Set(ys.slice(0, 110)).size).toBe(1); // flat at 100 W
    expect(ys.at(-1)).toBeLessThan(ys[0]); // 300 W is higher up
  });

  it('explains a missing meter or readings', () => {
    expect(widget(snapshot({ live: [] })).messages()).toEqual(['No readings from the power meter yet.']);
    expect(widget(snapshot({ live: [], meterError: 'x' })).messages()).toEqual(['Could not read the power meter.']);
  });
});

describe('usage', () => {
  const usage = Array.from({ length: 24 * 12 }, (_, i) => ({ t: HOUR_START - 24 * HOUR + i * 5 * MIN, w: 200 + (i % 7) * 50 }));

  it('draws usage on the price chart, or as its own chart', () => {
    const together = widget(snapshot({ usage }));
    expect(together.root.querySelectorAll('.ew-chart').length).toBe(3);
    expect(together.shown(together.root.querySelectorAll<HTMLElement>('.ew-chart')[1])).toBe(false);
    const separate = widget(snapshot({ usage }), { separateUsage: true });
    expect(separate.shown(separate.root.querySelectorAll<HTMLElement>('.ew-chart')[1])).toBe(true);
    expect(separate.root.innerHTML).not.toContain('NaN');
    expect(together.root.innerHTML).not.toContain('NaN');
  });

  it('colours usage in Homey purple with usageColor: purple', () => {
    const wrap = (s?: object) => widget(snapshot({ usage }), s).root.querySelector('.ew')!;
    expect(wrap().classList.contains('usage-purple')).toBe(false);
    expect(wrap({ usageColor: 'purple' }).classList.contains('usage-purple')).toBe(true);
  });
});

describe('fixed price', () => {
  const usage = Array.from({ length: 24 * 12 }, (_, i) => ({ t: HOUR_START - 24 * HOUR + i * 5 * MIN, w: 200 + (i % 7) * 50 }));
  const fixed = (over: Record<string, any> = {}) => snapshot({ fixedPrice: 2, usage, ...over });
  const charts = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.ew-chart')];

  it('shows the price in the header, without the price chart or the lowest-price footer', () => {
    const { q, root, shown, footer, messages } = widget(fixed(), { nextLow: 'both' });
    expect(q('.ew-hval.price')!.textContent).toBe('2,00 kr./kWh');
    expect([...q('.ew-header')!.querySelectorAll('.ew-hsub')].map(e => e.textContent)).toEqual(['Using now', 'Fixed price']);
    const [live, usageChart, price] = charts(root);
    expect([shown(live), shown(usageChart), shown(price)]).toEqual([true, true, false]); // usage on its own chart
    expect(footer()).toBeNull();
    expect(messages()).toEqual([]);
    expect(root.innerHTML).not.toContain('NaN');
  });

  it('keeps the header price while the usage chart is scrubbed', () => {
    const { q, root } = widget(fixed());
    const svg = charts(root)[1].querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    svg.dispatchEvent(new win.PointerEvent('pointermove', { clientX: 100, pointerType: 'mouse' }));
    expect([...q('.ew-header')!.querySelectorAll('.ew-hsub')].map(e => e.textContent)).toEqual(['17:00', 'Fixed price']);
  });

  it('shows only the live chart with usage off', () => {
    const { root, shown } = widget(fixed(), { showUsage: false });
    expect(charts(root).map(shown)).toEqual([true, false, false]);
  });
});

describe('prices off', () => {
  const usage = Array.from({ length: 24 * 12 }, (_, i) => ({ t: HOUR_START - 24 * HOUR + i * 5 * MIN, w: 200 + (i % 7) * 50 }));
  const charts = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.ew-chart')];
  const noPrices = () => snapshot({ usage, prices: snapshot().prices.map(p => ({ ...p, price: null })) });

  function expectNoPrices({ q, root, shown, footer, messages }: ReturnType<typeof widget>) {
    expect(q('.ew-hval.price')).toBeNull();
    expect(q('.ew-header')!.classList.contains('one')).toBe(true);
    expect([...q('.ew-header')!.querySelectorAll('.ew-hsub')].map(e => e.textContent)).toEqual(['Using now']);
    expect(charts(root).map(shown)).toEqual([true, true, false]); // usage on its own chart
    expect(footer()).toBeNull();
    expect(messages()).toEqual([]);
    expect(root.innerHTML).not.toContain('NaN');
  }

  it('leaves out the header price, the price chart and the footer', () => {
    expectNoPrices(widget(snapshot({ usage }), { showPrices: false, nextLow: 'both' }));
  });

  it('leaves out a fixed price too', () => {
    expectNoPrices(widget(snapshot({ usage, fixedPrice: 2 }), { showPrices: false }));
  });

  it('looks the same without any prices from Homey', () => {
    expectNoPrices(widget(noPrices()));
  });

  it('shows only the live chart with usage off', () => {
    const { root, shown } = widget(snapshot({ usage }), { showPrices: false, showUsage: false });
    expect(charts(root).map(shown)).toEqual([true, false, false]);
  });

  it('keeps both header columns with prices on', () => {
    const { q } = widget(snapshot({ usage }));
    expect(q('.ew-header')!.classList.contains('one')).toBe(false);
    expect(q('.ew-hval.price')!.textContent).toBe('2,00 kr./kWh');
  });
});

describe('negative power (solar export)', () => {
  // Midday export: -2 kW for 6 h of the last 24, else 200–500 W.
  const usage = Array.from({ length: 24 * 12 }, (_, i) => ({
    t: HOUR_START - 24 * HOUR + i * 5 * MIN, w: i >= 140 && i < 212 ? -2000 : 200 + (i % 7) * 50,
  }));
  const live = [{ t: NOW - 5 * MIN, w: 400 }, { t: NOW - 10e3, w: -1500 }];
  const labels = (svg: Element) => [...svg.querySelectorAll('text')].map(e => e.textContent);
  const ys = (d: string) => [...d.matchAll(/[ML][\d.-]+ ([\d.-]+)/g)].map(m => Number(m[1]));

  it('says the header is exporting, with a minus sign', () => {
    const { q } = widget(snapshot({ live }));
    expect(q('.ew-hval.live')!.textContent).toBe('−1.500W');
    expect(q('.ew-hval.live')!.classList.contains('export')).toBe(true);
    expect(q('.ew-hsub')!.textContent).toBe('Exporting now');
  });

  it('extends the live scale below zero and draws the export part yellow', () => {
    const { root } = widget(snapshot({ live }));
    const svg = root.querySelector('svg')!;
    expect(labels(svg)).toContain('0');
    expect(labels(svg)).toContain('−2k'); // whole 1 kW steps below -1.5 kW
    const lines = svg.querySelectorAll('.live-line');
    expect(lines.length).toBe(2);
    expect(lines[1].classList.contains('export')).toBe(true);
    expect(lines[1].getAttribute('clip-path')).toMatch(/^url\(#/);
    // Everything inside the plot (chip row 38 → base 121).
    for (const y of ys(lines[0].getAttribute('d')!)) expect(y).toBeLessThanOrEqual(121);
    expect(svg.querySelector('.dot-core.export')).not.toBeNull();
    expect(root.innerHTML).not.toContain('NaN');
  });

  it('keeps negative usage inside the price chart, sharing the zero line', () => {
    const { root } = widget(snapshot({ usage }));
    const svg = root.querySelectorAll('svg')[2];
    const line = svg.querySelector('.usage-line')!;
    for (const y of ys(line.getAttribute('d')!)) expect(y).toBeLessThanOrEqual(38 + 122 + 2);
    expect(svg.querySelector('.usage-line.export')).not.toBeNull();
    const text = [...svg.querySelectorAll('text')];
    const zeroPrice = text.find(e => e.textContent === '0,00')!, zeroUsage = text.find(e => e.textContent === '0')!;
    expect(zeroUsage.getAttribute('y')).toBe(zeroPrice.getAttribute('y'));
    expect(labels(svg).some(l => l!.startsWith('−'))).toBe(true);
    expect(root.innerHTML).not.toContain('NaN');
  });

  it('extends the separate usage chart below zero', () => {
    const { root } = widget(snapshot({ usage }), { separateUsage: true });
    const svg = root.querySelectorAll('svg')[1];
    expect(labels(svg)).toContain('−2k');
    expect(svg.querySelector('.usage-line.export')).not.toBeNull();
    expect(root.innerHTML).not.toContain('NaN');
  });

  it('adds nothing when no value is negative', () => {
    const { root } = widget(snapshot({ usage: usage.map(u => ({ ...u, w: Math.abs(u.w) })) }), { separateUsage: true });
    expect(root.querySelector('.export, clipPath')).toBeNull();
    expect(root.querySelectorAll('.live-line').length).toBe(1);
  });
});

describe('smooth lines', () => {
  const usage = Array.from({ length: 24 * 12 }, (_, i) => ({ t: HOUR_START - 24 * HOUR + i * 5 * MIN, w: 200 + (i % 7) * 50 }));
  const live = Array.from({ length: 60 }, (_, i) => ({ t: NOW - 10 * MIN + i * 10e3, w: i % 2 ? 300 : 900 }));
  const d = (root: HTMLElement, sel: string) => root.querySelector(sel)!.getAttribute('d')!;
  const dotY = (root: HTMLElement, kind: string) => Number(root.querySelector(`.dot-core.${kind}`)!.getAttribute('cy'));

  it('draws straight lines by default', () => {
    const { root } = widget(snapshot({ live, usage }, { 26: 3 }), { separateUsage: true });
    for (const sel of ['.live-line', '.usage-line', '.price-line']) expect(d(root, sel)).not.toMatch(/[CQ]/);
  });

  it('curves the live and usage lines and rounds the price steps', () => {
    const { root } = widget(snapshot({ live, usage }, { 26: 3 }), { separateUsage: true, smooth: true });
    expect(d(root, '.live-line')).toMatch(/^M[\d.]+ [\d.]+C/);
    expect(d(root, '.usage-line')).toMatch(/^M[\d.]+ [\d.]+C/);
    expect(d(root, '.price-line')).toContain('Q');
    expect(root.innerHTML).not.toContain('NaN');
  });

  it('calms an alternating trace and keeps the live dot on the smoothed line', () => {
    // The y of each point the line passes through: the M, then the end of each C or L.
    const ys = (root: HTMLElement) => d(root, '.live-line').slice(1).split(/[CL]/).map(s => Number(s.trim().split(' ').at(-1)));
    const plain = widget(snapshot({ live })).root, smooth = widget(snapshot({ live }), { smooth: true }).root;
    const range = (v: number[]) => Math.max(...v.slice(10, -10)) - Math.min(...v.slice(10, -10));
    expect(range(ys(smooth))).toBeLessThan(range(ys(plain)) / 4);
    expect(dotY(smooth, 'live')).toBe(ys(smooth).at(-1));
  });
});

it('claims touches on the charts, so the dashboard does not scroll and cancel the scrub', () => {
  const { root } = widget(snapshot());
  for (const svg of root.querySelectorAll('svg')) {
    for (const type of ['touchstart', 'touchmove']) {
      const e = new TouchEvent(type, { touches: [{ clientX: 100, clientY: 50, identifier: 1, target: svg }] as any, bubbles: true, cancelable: true });
      svg.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(true);
    }
  }
});

it('selects on tap and keeps a touch selection for 3 s after the finger lifts', () => {
  const { root, q } = widget(snapshot());
  const svg = root.querySelectorAll('svg')[2]; // price chart
  const sub = () => root.querySelectorAll('.ew-hsub')[1].textContent;
  const idle = sub();
  const at = (type: string, x: number) => svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: 50, pointerType: 'touch', bubbles: true }));
  at('pointerdown', 60);
  expect(sub()).not.toBe(idle);
  at('pointercancel', 60); // Android's dashboard taking over the drag
  vi.advanceTimersByTime(2900);
  expect(sub()).not.toBe(idle);
  vi.advanceTimersByTime(200);
  expect(sub()).toBe(idle);
  expect(q('.ew-header')).toBeTruthy();
});

it('shows a message instead of the charts', () => {
  const { w, messages, shown, q } = widget(snapshot());
  w.setMessage('Select a power meter in the widget settings.');
  expect(messages()).toEqual(['Select a power meter in the widget settings.']);
  expect(shown(q('.ew-header'))).toBe(false);
});
