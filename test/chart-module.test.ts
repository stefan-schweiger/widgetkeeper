// @vitest-environment happy-dom
/* The chart module shared by the Electricity Overview and Charts (widgets/electricity/public/chart.js). */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let C: any;
beforeAll(() => { C = loadWidget('electricity').WidgetkeeperChart; });
afterEach(() => { vi.useRealTimers(); });

const nf = (v: number, d?: number) => new Intl.NumberFormat('da-DK', d == null
  ? { maximumFractionDigits: 0 } : { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

function svg() {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(node);
  return node;
}
const labels = (s: SVGElement) => [...s.querySelectorAll('text')].map(t => t.textContent);

describe('helpers', () => {
  it('rounds scale steps to 1, 2, 2.5 and 5', () => {
    expect([0.7, 1.5, 2.2, 4, 7, 23, 0.003].map(C.niceStep)).toEqual([1, 2, 2.5, 5, 10, 25, 0.005]);
    expect(C.niceStep(0)).toBe(1);
  });

  it('writes thousands as k, with a real minus sign', () => {
    expect([850, 1000, 1500, -1500, -200].map(v => C.compactNumber(nf, v))).toEqual(['850', '1k', '1,5k', '−1,5k', '−200']);
  });

  it('labels relative times', () => {
    expect([3600e3, 1800e3, 150e3, 30e3].map(ms => C.ago(ms, nf))).toEqual(['1h', '30m', '2,5m', '30s']);
  });

  it('draws straight or smooth lines through the points', () => {
    const pts = [[0, 10], [10, 0], [20, 10]];
    expect(C.linePath(pts, false)).toBe('M0 10L10 0L20 10');
    expect(C.linePath(pts, true)).toMatch(/^M0 10C/);
    expect(C.stepPath([[0, 10], [10, 10], [10, 0], [20, 0]], true)).toContain('Q');
  });

  it('smooths a series without moving its ends', () => {
    const s = C.smoothValues([0, 10, 0, 10, 0]);
    expect(s[0]).toBe(0);
    expect(s[4]).toBe(0);
    expect(Math.max(...s)).toBeLessThan(10);
  });
});

describe('value scale', () => {
  const opts = { h: 100, top: 0, pw: 200, format: (v: number) => String(v) };

  it('starts at zero by default', () => {
    const s = svg();
    const scale = C.createKit().valueScale(s, { ...opts, min: 19, max: 23 });
    expect(scale.axisMin).toBe(0);
    expect(labels(s)).toContain('0');
    expect(scale.y(0)).toBe(100);
  });

  it('extends below zero in whole steps, with a zero line', () => {
    const s = svg();
    const scale = C.createKit().valueScale(s, { ...opts, min: -150, max: 400 });
    expect(scale.axisMin).toBeLessThan(0);
    expect(s.querySelectorAll('path.axis').length).toBe(1);
    expect(scale.zeroY).toBeGreaterThan(0);
    expect(scale.zeroY).toBeLessThan(100);
  });

  it('fits the values when asked, with no zero in the range', () => {
    const s = svg();
    const scale = C.createKit().valueScale(s, { ...opts, min: 19.3, max: 23.1, fit: true });
    expect([scale.axisMin, scale.axisMax]).toEqual([18, 24]);
    expect(labels(s)).not.toContain('0');
    expect(s.querySelectorAll('path.axis').length).toBe(0); // no zero line
    expect(scale.baseY).toBe(100); // areas and bars close at the bottom
    expect(scale.zeroY).toBeGreaterThan(100);
  });

  it('fits a range that crosses zero, with the zero line and labelled zero', () => {
    const s = svg();
    const scale = C.createKit().valueScale(s, { ...opts, min: -4.2, max: 6.8, fit: true });
    expect(scale.axisMin).toBeLessThanOrEqual(-4.2);
    expect(scale.axisMax).toBeGreaterThanOrEqual(6.8);
    expect(labels(s)).toContain('0');
    expect(s.querySelectorAll('path.axis').length).toBe(1);
    expect(scale.baseY).toBe(scale.zeroY);
  });

  it('closes areas at the top when every value is below zero', () => {
    const scale = C.createKit().valueScale(svg(), { ...opts, min: -20, max: -17, fit: true });
    expect(scale.baseY).toBe(0);
  });

  it('puts a flat series in the middle', () => {
    const scale = C.createKit().valueScale(svg(), { ...opts, min: 21, max: 21, fit: true });
    expect(scale.y(21)).toBe(50);
    expect([scale.axisMin, scale.axisMax]).toEqual([19, 23]);
  });
});

describe('trace and bars', () => {
  it('splits a trace at zero into the export look', () => {
    const s = svg();
    const kit = C.createKit();
    kit.trace(s, { line: 'M0 0L10 90', area: 'M0 0L10 90L10 50L0 50Z', kind: 'series', lineClass: 'series-line', zeroY: 50, top: 0, base: 100 });
    expect([...s.querySelectorAll('path[class]')].map(p => p.getAttribute('class'))).toEqual(['series-line', 'series-line export']);
    expect(s.querySelectorAll('clipPath').length).toBe(4);
    expect(s.querySelectorAll('stop.export').length).toBeGreaterThan(0);
  });

  it('draws one trace without the split', () => {
    const s = svg();
    C.createKit().trace(s, { line: 'M0 0L10 90', kind: 'series', lineClass: 'series-line', zeroY: 50, top: 0, base: 100, split: false });
    expect([...s.querySelectorAll('path')].map(p => p.getAttribute('class'))).toEqual(['series-line']);
  });

  it('draws bars from the base, skipping empty ones, and marks the selected one', () => {
    const s = svg();
    C.createKit().bars(s, { list: [{ x: 0, w: 8, v: 10 }, { x: 10, w: 8, v: null }, { x: 20, w: 8, v: -5 }], y: (v: number) => 50 - v * 4,
      baseY: 50, zeroY: 50, base: 100, cls: 'series-bars', selected: 2 });
    const rects = [...s.querySelectorAll('rect')];
    expect(rects.map(r => [r.getAttribute('y'), r.getAttribute('height')])).toEqual([['10', '40'], ['50', '20']]);
    expect(rects[1].getAttribute('class')).toBe('bar selected');
  });

  it('gives each kit its own ids', () => {
    const a = svg(), b = svg();
    C.createKit().gradient(a, 'x', [[0, 1]]);
    C.createKit().gradient(b, 'x', [[0, 1]]);
    expect(a.querySelector('linearGradient')!.id).not.toBe(b.querySelector('linearGradient')!.id);
  });
});

describe('tap to inspect', () => {
  it('keeps a touch selection 3 s after the finger lifts, and resets a mouse one on leave', () => {
    vi.useFakeTimers();
    const s = svg();
    const scrub = vi.fn(), reset = vi.fn();
    C.attachScrub(s, scrub, reset, { timer: null });
    s.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
    expect(scrub).toHaveBeenCalledTimes(1);
    s.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }));
    vi.advanceTimersByTime(2900);
    expect(reset).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(reset).toHaveBeenCalledTimes(1);
    s.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(reset).toHaveBeenCalledTimes(2);
  });
});
