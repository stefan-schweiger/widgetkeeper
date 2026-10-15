// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

const MIN = 60e3;
const HOUR = 60 * MIN;
const NOW = new Date('2026-01-15T10:20:00').getTime(); // Europe/Copenhagen (vitest.config.ts)

let win: any;
beforeAll(() => { win = loadWidget('charts'); loadMount('charts'); });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); });

const cap = { title: 'Temperature', type: 'number', units: '°C', decimals: 1, min: null, max: null, values: null, icon: null };
/** One point a minute over the last hour, each a different value, so a drifting selection shows. */
const minutes = () => Array.from({ length: 60 }, (_, i) => [NOW - (60 - i) * MIN + 30e3, 10 + i] as [number, number]);
const entry = (points: [number, number][], value = points.at(-1)![1]) =>
  ({ deviceId: 'd1', capabilityId: 'measure_temperature', name: 'Living room', capability: cap, value, points });

function widget(charts: Record<string, unknown>[], state: any[]) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createChartsWidget(root, { locale: 'da-DK', language: 'da', now: () => Date.now(), charts });
  w.setState(state);
  const header = () => [...root.querySelectorAll('.ew-hcol')].map(c => `${c.querySelector('.ew-hval')!.textContent} | ${c.querySelector('.ew-hsub')!.textContent}`);
  const svg = root.querySelector('.ch-chart svg')!;
  return { w, root, header, svg };
}

describe('chartBuckets: the value now', () => {
  const t0 = new Date('2026-01-15T08:00:00').getTime();

  it('does not count as a sample in the last bar', () => {
    const b = win.chartBuckets([[t0 + 70 * MIN, 2], [t0 + 80 * MIN, 4]], t0, t0 + 90 * MIN, HOUR, 100);
    expect(b.map((x: any) => x.v)).toEqual([null, 3]);
  });

  it('stands in for a last bar without points of its own', () => {
    const b = win.chartBuckets([[t0 + 10 * MIN, 2]], t0, t0 + 90 * MIN, HOUR, 7);
    expect(b.map((x: any) => x.v)).toEqual([2, 7]);
    expect(win.chartBuckets([], t0, t0 + 90 * MIN, HOUR, 7).map((x: any) => x.v)).toEqual([null, 7]);
  });

  it('leaves the value now out of the last bar average in the widget', () => {
    // A history cached up to 5 min, with a value now that differs from its last points, inside the last bar (which has points of its own).
    vi.setSystemTime(NOW - 2 * MIN);
    const r = widget([{ style: 'bars', span: '1h' }], [entry(minutes())]);
    const last = (x: ReturnType<typeof widget>) => [...x.root.querySelectorAll('rect.bar')].at(-1)!.getAttribute('y');
    const off = widget([{ style: 'bars', span: '1h' }], [entry(minutes(), 0)]);
    expect(last(off)).toBe(last(r));
  });
});

describe('a held selection', () => {
  it('stays on the tapped point as the window moves on and live values arrive', () => {
    const r = widget([{ span: '1h' }], [entry(minutes())]);
    r.svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: 38 + 160, pointerType: 'touch' }));
    const [tapped] = r.header();
    expect(tapped).toMatch(/\| \d\d:\d\d$/);
    vi.setSystemTime(NOW + 2 * MIN);
    r.w.pushChange({ deviceId: 'd1', capabilityId: 'measure_temperature', value: 80 });
    r.w.render();
    expect(r.header()).toEqual([tapped]);
  });

  it('stays on the tapped bar', () => {
    const r = widget([{ span: '1h', style: 'bars' }], [entry(minutes())]);
    r.svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: 38 + 160, pointerType: 'touch' }));
    const [tapped] = r.header();
    vi.setSystemTime(NOW + 6 * MIN); // the bars start a bar later
    r.w.render();
    expect(r.header()).toEqual([tapped]);
  });

  it('is dropped once its time leaves the window', () => {
    const r = widget([{ span: '1h' }], [entry(minutes())]);
    r.svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: 38 + 2, pointerType: 'touch' }));
    expect(r.header()[0]).not.toMatch(/Now$/);
    vi.setSystemTime(NOW + 2 * MIN);
    r.w.render();
    expect(r.header()[0]).toMatch(/\| Now$/);
    expect(r.root.querySelector('.cursor')).toBeNull();
  });
});

describe('mount: spans', () => {
  async function requested(settings: Record<string, unknown>) {
    const api = vi.fn(async () => ({ charts: [], language: 'en' }));
    const Homey = {
      getSettings: () => settings, api, on: () => {}, ready: () => {}, setHeight: () => {}, __: (k: string) => k,
    };
    const root = document.createElement('div');
    document.body.append(root);
    win.mountChartsWidget(Homey, { root, frame: root });
    await vi.waitFor(() => expect(api).toHaveBeenCalled());
    return decodeURIComponent((api.mock.calls[0] as any)[1]).match(/charts=([^&]*)/)![1];
  }
  const slot = (id: string) => ({ id, name: id });

  it('gives series 2 chart 1\'s span on one chart', async () => {
    expect(await requested({ charts: 'overlay', chart1: slot('a:x'), span1: '6h', chart2: slot('b:y'), span2: '7d' })).toBe('a:x~6h,b:y~6h');
  });

  it('keeps a lone chart 2\'s own span when chart 1 is empty', async () => {
    expect(await requested({ charts: 'overlay', chart1: null, span1: '6h', chart2: slot('b:y'), span2: '7d' })).toBe('b:y~7d');
  });
});
