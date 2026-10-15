// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

const MIN = 60e3;
const HOUR = 60 * MIN;
const NOW = new Date('2026-01-15T10:20:00').getTime(); // Europe/Copenhagen (vitest.config.ts)

let win: any;
beforeAll(() => { win = loadWidget('charts'); });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); });

const cap = (extra: Record<string, unknown> = {}) => ({ title: 'Temperature', type: 'number', units: '°C', decimals: 1, min: null, max: null, values: null, icon: null, ...extra });
/** 120 points over the span ending now, from `f(x)` with x 0…1. */
const series = (spanMs: number, f: (x: number) => number) =>
  Array.from({ length: 120 }, (_, i) => [NOW - spanMs + (i + 0.5) * spanMs / 120, f(i / 119)] as [number, number]);
const entry = (points: [number, number][], extra: Record<string, unknown> = {}) => ({
  deviceId: 'd1', capabilityId: 'measure_temperature', name: 'Living room', capability: cap(), value: points.at(-1)![1], points, ...extra,
});

/** A header number as the widget writes it: in the system locale (its `formatNumber()` doesn't take `opts.locale`). */
const num = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

function widget(charts: Record<string, unknown>[], state: any[], opts: Record<string, unknown> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createChartsWidget(root, { locale: 'da-DK', language: 'da', now: () => Date.now(), charts, ...opts });
  w.setState(state);
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const all = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  const shown = (el: HTMLElement | null) => !!el && el.style.display !== 'none';
  const header = () => all('.ew-hcol').map(c => `${c.querySelector('.ew-hval')!.textContent} | ${c.querySelector('.ew-hsub')!.textContent}`);
  const yLabels = (i = 0) => all('.ch-chart')[i].querySelectorAll('text');
  return { w, root, q, all, shown, header, yLabels };
}

describe('charts', () => {
  it('draws one chart with its chip, header, line, area and dot', () => {
    const { q, all, header } = widget([{ span: '24h' }], [entry(series(24 * HOUR, x => 20 + x * 2))]);
    expect(all('.ch-chart').length).toBe(1);
    expect(q('.ew-chip')!.textContent).toBe('Living room · Temperature – °C');
    expect(header()).toEqual(['22°C | Now']);
    expect(q('.series-line')).not.toBeNull();
    expect(all('path[fill^="url"]').length).toBe(1); // the area
    expect(q('.dot-core.series')).not.toBeNull();
    expect(q('.ch-chart')!.dataset.color).toBe('blue');
  });

  it('stacks two charts, each in its own colour', () => {
    const { all, header } = widget([{ span: '24h' }, { span: '6h', color: 'green', style: 'bars' }],
      [entry(series(24 * HOUR, x => 20 + x)), entry(series(6 * HOUR, x => 500 + x * 1000), { deviceId: 'd2', capabilityId: 'measure_power', capability: cap({ title: 'Power', units: 'W', decimals: 0 }) })]);
    expect(all('.ch-chart').map(c => c.dataset.color)).toEqual(['blue', 'green']);
    expect(header()).toEqual(['21°C | Now', `${num(1500)}W | Now`]);
    expect(all('.ch-chart')[1].querySelectorAll('rect.bar').length).toBeGreaterThan(20);
  });

  it('draws a line without an area', () => {
    const { q, all } = widget([{ style: 'line' }], [entry(series(24 * HOUR, x => 20 + x))]);
    expect(q('.series-line')).not.toBeNull();
    expect(all('path[fill^="url"]').length).toBe(0);
  });

  it('hides the header when asked', () => {
    const { q, shown } = widget([{}], [entry(series(24 * HOUR, x => 20 + x))], { showHeader: false });
    expect(shown(q('.ew-header'))).toBe(false);
  });

  it('uses a title of its own', () => {
    const { q } = widget([{ title: '  Stue ' }], [entry(series(24 * HOUR, x => 20 + x))]);
    expect(q('.ew-chip')!.textContent).toBe('Stue – °C');
  });

  it('falls back on unknown settings', () => {
    const { q } = widget([{ span: 'x', style: 'pie', color: 'pink', range: 'odd' }], [entry(series(24 * HOUR, x => 20 + x))]);
    expect(q('.ch-chart')!.dataset.color).toBe('blue');
    expect(q('.series-line')).not.toBeNull();
    expect([...q('.ch-chart')!.querySelectorAll('text')].map(t => t.textContent)).not.toContain('0'); // fit
  });
});

describe('scale', () => {
  const temps = () => [entry(series(24 * HOUR, x => 19.3 + x * 3.8))];
  const labels = (r: ReturnType<typeof widget>) => [...r.yLabels()].map(t => t.textContent);

  it('fits the values by default', () => {
    const l = labels(widget([{}], temps()));
    expect(l).toContain('24');
    expect(l).not.toContain('0');
  });

  it('starts at zero when asked', () => {
    expect(labels(widget([{ range: 'zero' }], temps()))).toContain('0');
  });

  it('labels decimals and thousands from the step', () => {
    expect(labels(widget([{}], [entry(series(24 * HOUR, x => 0.2 + x * 0.5))]))).toContain('0,4');
    expect(labels(widget([{ range: 'zero' }], [entry(series(24 * HOUR, x => 500 + x * 3000))]))).toContain('2k');
  });

  it('shows a 0–1 percentage as 0–100', () => {
    const r = widget([{ range: 'zero' }], [entry(series(24 * HOUR, x => x), { capability: cap({ title: 'Dim', units: '%', decimals: 2, min: 0, max: 1 }) })]);
    expect(labels(r)).toContain('100');
    expect(r.header()).toEqual(['100% | Now']);
  });
});

describe('below zero', () => {
  const outdoor = () => [entry(series(24 * HOUR, x => -4 + x * 8))];

  it('is one colour with a zero line by default', () => {
    const { all, q } = widget([{}], outdoor());
    expect(all('.series-line').length).toBe(1);
    expect(q('.ch-chart path.axis + path, .ch-chart path.axis')).not.toBeNull();
    expect(q('.export')).toBeNull();
  });

  it('is yellow with the setting, as the Electricity Overview draws export', () => {
    const { all } = widget([{ negative: true }], outdoor());
    expect(all('.series-line').map(p => p.getAttribute('class'))).toEqual(['series-line', 'series-line export']);
  });

  it('colours the header and dot when the value now is below zero', () => {
    const { q } = widget([{ negative: true }], [entry(series(24 * HOUR, x => 4 - x * 8))]);
    expect(q('.ch-value')!.classList.contains('export')).toBe(true);
    expect(q('.dot-core.series.export')).not.toBeNull();
  });

  it('splits bars too', () => {
    const { all } = widget([{ negative: true, style: 'bars' }], outdoor());
    expect(all('g.series-bars').length).toBe(2);
    expect(all('g.series-bars.export').length).toBe(1);
  });
});

describe('bars', () => {
  it('averages the points into clock buckets, carrying the last value over gaps', () => {
    const t0 = new Date('2026-01-15T08:00:00').getTime();
    const b = win.chartBuckets([[t0 - 10 * MIN, 1], [t0 + 10 * MIN, 2], [t0 + 20 * MIN, 4], [t0 + 130 * MIN, 9]], t0 - 30 * MIN, t0 + 150 * MIN, HOUR);
    expect(b.map((x: any) => [new Date(x.t).toTimeString().slice(0, 5), new Date(x.end).toTimeString().slice(0, 5), x.v]))
      .toEqual([['07:30', '08:00', 1], ['08:00', '09:00', 3], ['09:00', '10:00', 4], ['10:00', '10:30', 9]]);
  });

  it('leaves the bars before the first value empty', () => {
    const t0 = new Date('2026-01-15T08:00:00').getTime();
    expect(win.chartBuckets([[t0 + 90 * MIN, 5]], t0, t0 + 2 * HOUR, HOUR).map((x: any) => x.v)).toEqual([null, 5]);
  });

  it('uses about 24 hourly bars over 24 h', () => {
    const { all } = widget([{ style: 'bars' }], [entry(series(24 * HOUR, x => 20 + x))]);
    expect(all('rect.bar').length).toBe(25); // the first and last hours cut by the span
  });
});

describe('tap to inspect', () => {
  it('shows the tapped point in the header with its time, then goes back to now', () => {
    const r = widget([{}], [entry(series(24 * HOUR, x => 20 + x * 2))]);
    const svg = r.q('.ch-chart svg')!;
    svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: 38 + 163, pointerType: 'touch' }));
    const [h] = r.header();
    expect(h).toMatch(/^21([,.]\d)?°C \| \d\d:\d\d$/);
    expect(r.q('.cursor')).not.toBeNull();
    svg.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }));
    vi.advanceTimersByTime(3100);
    expect(r.header()).toEqual(['22°C | Now']);
  });

  it('shows a tapped bar with its time range, and the weekday over longer spans', () => {
    const r = widget([{ style: 'bars', span: '7d' }], [entry(series(7 * 24 * HOUR, x => 20 + x * 2))]);
    r.q('.ch-chart svg')!.dispatchEvent(new PointerEvent('pointerdown', { clientX: 38 + 100, pointerType: 'mouse' }));
    expect(r.header()[0]).toMatch(/\| \S+ \d\d:\d\d–\d\d:\d\d$/);
    expect(r.q('rect.bar.selected')).not.toBeNull();
  });
});

describe('live and states', () => {
  it('appends live values and keeps them over an older history', () => {
    const r = widget([{ span: '1h' }], [entry(series(HOUR, () => 20))]);
    vi.setSystemTime(NOW + 30e3);
    r.w.pushChange({ deviceId: 'd1', capabilityId: 'measure_temperature', value: 23.4 });
    expect(r.header()).toEqual([`${num(23.4)}°C | Now`]);
    r.w.setState([entry(series(HOUR, () => 20))]); // a cached history from before the push
    const d = r.q('.series-line')!.getAttribute('d')!;
    expect(d.endsWith(r.q('.dot-core')!.getAttribute('cx') + ' ' + r.q('.dot-core')!.getAttribute('cy'))).toBe(true);
  });

  it('says when a device is missing or has no history', () => {
    const r = widget([{}, {}], [
      { deviceId: 'g', capabilityId: 'measure_temperature', name: 'Garage', capability: cap(), value: null, points: [] },
      { deviceId: 'h', capabilityId: 'measure_temperature', missing: true },
    ]);
    expect(r.all('.ew-chip').map(c => c.textContent)).toEqual(['Garage · Temperature – °C', 'Unavailable']);
    expect(r.all('.ch-note').filter(r.shown).map(n => n.textContent)).toEqual(['No history yet.']);
    expect(r.header()).toEqual(['– | Now', '– | Unavailable']);
  });

  it('keeps the charts on a failed refresh, with a passing message', () => {
    const r = widget([{}], [entry(series(24 * HOUR, x => 20 + x))]);
    r.w.setMessage('Could not load the chart.', true);
    expect(r.shown(r.q('.ch-chart'))).toBe(true);
    expect(r.q('.ch-transient')!.textContent).toBe('Could not load the chart.');
    vi.advanceTimersByTime(8100);
    expect(r.shown(r.q('.ch-transient'))).toBe(false);
  });

  it('shows only the message when nothing is picked', () => {
    const r = widget([{}], []);
    r.w.setMessage(r.w.t('selectChart'));
    expect(r.all('.ch > .ew-message').filter(r.shown).map(m => m.textContent)).toEqual(['Pick a device value in the widget settings.']);
    expect(r.shown(r.q('.ch-chart'))).toBe(false);
  });
});

describe('two series on one chart', () => {
  const power = (spanMs: number, f: (x: number) => number) => entry(series(spanMs, f),
    { deviceId: 'd2', capabilityId: 'measure_power', name: 'Meter', capability: cap({ title: 'Power', units: 'W', decimals: 0 }) });
  const two = (c2: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) =>
    widget([{ span: '24h' }, { color: 'green', ...c2 }], [entry(series(24 * HOUR, x => 20 + x * 2)), power(24 * HOUR, x => 500 + x * 1000)], { overlay: true, ...opts });
  const rightLabels = (r: ReturnType<typeof widget>) => r.all('.ch-chart svg text[text-anchor="start"]').map(t => t.textContent);

  it('draws both in one chart, each with its chip, colour and scale', () => {
    const r = two();
    expect(r.all('.ch-chart').filter(r.shown).length).toBe(1);
    expect(r.all('.ew-chip').map(c => [c.dataset.color, c.textContent]))
      .toEqual([['blue', 'Living room · Temperature – °C'], ['green', 'Meter · Power – W']]);
    expect(r.all('g[data-color] .series-line').map(p => p.closest('g')!.getAttribute('data-color'))).toEqual(['blue', 'green']);
    expect(r.all('g[data-color] .dot-core').length).toBe(2);
    expect(rightLabels(r)).toContain('1,5k');
    expect(r.header()).toEqual(['22°C | Now', `${num(1500)}W | Now`]);
  });

  it('gives both the same number of grid steps, from zero sharing the zero line', () => {
    for (const range of ['fit', 'zero']) {
      const r = widget([{ range }, { range: 'fit' }], [entry(series(24 * HOUR, x => 20 + x * 2)), power(24 * HOUR, x => 500 + x * 1000)], { overlay: true });
      const left = r.all('.ch-chart svg text[text-anchor="end"][dominant-baseline="central"]').map(t => t.getAttribute('y'));
      expect(r.all('.ch-chart svg text[text-anchor="start"]').map(t => t.getAttribute('y'))).toEqual(left);
      if (range === 'zero') expect(rightLabels(r)).toContain('0');
    }
  });

  it('uses chart 1\'s time span for both', () => {
    const r = two({ span: '7d', style: 'bars' });
    expect(r.all('rect.bar').length).toBe(25); // hourly bars over 24 h, not 6-hourly over 7 days
  });

  it('puts two series of bars side by side in each slot', () => {
    const r = two({ style: 'bars' }, {});
    const r2 = widget([{ style: 'bars' }, { style: 'bars' }], [entry(series(24 * HOUR, x => 20 + x)), power(24 * HOUR, x => 500 + x)], { overlay: true });
    const [a, b] = r2.all('g.series-bars').map(g => [...g.querySelectorAll('rect.bar')]);
    expect(a.length).toBe(b.length);
    const k = 5;
    const ax = +a[k].getAttribute('x')!, aw = +a[k].getAttribute('width')!, bx = +b[k].getAttribute('x')!;
    expect(bx).toBeGreaterThan(ax + aw - 0.01);
    expect(r.all('rect.bar').length).toBe(25);
  });

  it('shows both values at the tapped time', () => {
    const r = two();
    r.q('.ch-chart svg')!.dispatchEvent(new PointerEvent('pointerdown', { clientX: 38 + 148, pointerType: 'mouse' }));
    const [a, b] = r.header();
    const at = a.split(' | ')[1];
    expect(at).toMatch(/^\d\d:\d\d$/);
    expect(b.split(' | ')[1]).toBe(at);
    expect(r.all('.cursor').length).toBe(1);
  });

  it('draws the other series when one is missing', () => {
    const r = widget([{}, {}], [entry(series(24 * HOUR, x => 20 + x)), { deviceId: 'h', capabilityId: 'measure_power', missing: true }], { overlay: true });
    expect(r.all('.ew-chip').map(c => c.textContent)).toEqual(['Living room · Temperature – °C', 'Unavailable']);
    expect(r.all('.series-line').length).toBe(1);
    expect(r.shown(r.q('.ch-chart .ch-note'))).toBe(false);
  });

  it('stays stacked without the option', () => {
    const r = widget([{}, {}], [entry(series(24 * HOUR, x => 20 + x)), power(24 * HOUR, x => 500 + x)]);
    expect(r.all('.ch-chart').filter(r.shown).length).toBe(2);
    expect(rightLabels(r)).toEqual([]);
  });
});

describe('dualScale', () => {
  const scale = (a: [number, number], b: [number, number], fit: boolean) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const kit = win.WidgetkeeperChart.createKit();
    const f = (v: number) => String(v);
    const s = kit.dualScale(svg, { a: { max: a[1], min: a[0], format: f }, b: { max: b[1], min: b[0], format: f }, h: 120, top: 0, pw: 200, fit });
    return { s, labels: [...svg.querySelectorAll('text')].map(t => [t.getAttribute('text-anchor'), t.textContent]) };
  };

  it('from zero, shares the zero line, also when only one side goes below zero', () => {
    const { s } = scale([-3, 8], [0, 2500], false);
    expect(s.a.zeroY).toBeCloseTo(s.b.zeroY);
    expect(s.b.y(2500)).toBeGreaterThanOrEqual(0);
    const t = scale([0, 8], [-900, 2500], false).s;
    expect(t.a.zeroY).toBeCloseTo(t.b.zeroY);
    expect(t.a.zeroY).toBeLessThan(120);
    expect(t.b.y(-900)).toBeLessThanOrEqual(120);
  });

  it('fitted, both cover their values in the same steps', () => {
    const { s, labels } = scale([19.3, 23.1], [480, 2700], true);
    for (const [side, lo, hi] of [['a', 19.3, 23.1], ['b', 480, 2700]] as const) {
      expect(s[side].y(lo)).toBeLessThanOrEqual(120 + 1e-9);
      expect(s[side].y(hi)).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(labels.filter(l => l[0] === 'end').length).toBe(labels.filter(l => l[0] === 'start').length);
  });
});
