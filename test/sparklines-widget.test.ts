// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('sparklines'); });
afterEach(() => { document.body.innerHTML = ''; });

const NOW = Date.parse('2026-10-06T12:00:00Z');
const HOUR = 3600e3;
// Numbers follow the device locale (Danish here: 21,5), so the expected text is formatted the same way.
const dec = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const cap = (extra: object = {}) => ({ title: 'T', type: 'number', units: null, decimals: null, min: null, max: null, values: null, icon: null, ...extra });
/** A temperature over the last 24 hours: 19.4 → 23.1 → 21.5. */
const temp = (extra: object = {}) => ({
  deviceId: 'a', capabilityId: 'measure_temperature', name: 'Stue', capability: cap({ units: '°C', decimals: 1 }), value: 21.5,
  points: [[NOW - 20 * HOUR, 19.4], [NOW - 10 * HOUR, 23.1], [NOW - HOUR, 21.5]],
  ...extra,
});

function widget(slots: any[], extra: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  let now = NOW;
  const w = win.createSparklinesWidget(root, { now: () => now, ...extra });
  w.setState(slots);
  const tiles = () => [...root.querySelectorAll<HTMLElement>('.sl-tile')];
  const text = (sel: string) => tiles().map(t => t.querySelector(sel)!.textContent);
  return { w, root, tiles, text, setNow: (t: number) => { now = t; } };
}

describe('sparkPath', () => {
  it('maps time to x and the range to y, the highest value at the top', () => {
    const p = win.sparkPath([[0, 10], [50, 20], [100, 15]], 0, 100, 100, 36);
    expect(p.line).toBe('M0 33L50 3L100 18');
    expect(p.area).toBe('M0 33L50 3L100 18L100 36L0 36Z');
    expect(p.dot).toEqual({ x: 100, y: 18 });
    expect([p.min, p.max]).toEqual([10, 20]);
  });

  it('puts a flat series in the middle', () => {
    expect(win.sparkPath([[0, 5], [100, 5]], 0, 100, 100, 36).line).toBe('M0 18L100 18');
  });

  it('leaves out points outside the span, and needs two', () => {
    expect(win.sparkPath([[-10, 99], [0, 1], [100, 2]], 0, 100, 100, 36).max).toBe(2);
    expect(win.sparkPath([[50, 1]], 0, 100, 100, 36)).toBeNull();
    expect(win.sparkPath([], 0, 100, 100, 36)).toBeNull();
  });
});

describe('render', () => {
  it('shows one tile per slot in order, with the value, the name and the min/max', () => {
    const { text } = widget([temp(), temp({ deviceId: 'b', name: 'Køkken' })]);
    expect(text('.sl-name')).toEqual(['Stue', 'Køkken']);
    expect(text('.sl-value')).toEqual([`${dec(21.5)}°C`, `${dec(21.5)}°C`]);
    expect(text('.sl-max')).toEqual([`↑${dec(23.1)}`, `↑${dec(23.1)}`]);
    expect(text('.sl-min')).toEqual([`↓${dec(19.4)}`, `↓${dec(19.4)}`]);
  });

  it('runs the line on to now at the current value', () => {
    const { tiles } = widget([temp({ value: 30 })]);
    expect(tiles()[0].querySelector('.sl-max')!.textContent).toBe('↑30');
    expect(tiles()[0].querySelector('.sl-dot')!.getAttribute('cx')).toBe('100');
  });

  it('uses the span: older points are left out', () => {
    const { text } = widget([temp()], { span: '6h' });
    // Only the last point and the current value are in the last 6 hours.
    expect(text('.sl-max')).toEqual([`↑${dec(21.5)}`]);
  });

  it('shows an empty chart without a history', () => {
    const { tiles, text } = widget([temp({ points: [] })]);
    expect(text('.sl-max')).toEqual(['']);
    expect(tiles()[0].querySelector('.sl-line')!.getAttribute('d')).toBe('');
    expect((tiles()[0].querySelector('.sl-dot') as any).style.display).toBe('none');
  });

  it('scales a 0–1 percentage to 0–100', () => {
    const dim = temp({ capabilityId: 'dim', capability: cap({ units: '%', min: 0, max: 1, decimals: 2 }), value: 0.5, points: [[NOW - HOUR, 0.2], [NOW - 1000, 0.5]] });
    const { text } = widget([dim]);
    expect(text('.sl-value')).toEqual(['50%']);
    expect(text('.sl-max')).toEqual(['↑50']);
    expect(text('.sl-min')).toEqual(['↓20']);
  });

  it('marks a missing slot unavailable', () => {
    const { tiles, text } = widget([{ deviceId: 'x', capabilityId: 'measure_power', missing: true }], { t: () => undefined });
    expect(text('.sl-name')).toEqual(['Unavailable']);
    expect(tiles()[0].classList.contains('missing')).toBe(true);
  });

  it('uses 2 columns unless the setting says 1', () => {
    expect(widget([temp()]).root.dataset.columns).toBe('2');
    expect(widget([temp()], { columns: '1' }).root.dataset.columns).toBe('1');
    expect(widget([temp()], { columns: 'bogus' }).root.dataset.columns).toBe('2');
  });
});

describe('live values', () => {
  it('adds a point, moves the min/max and keeps the same SVG nodes', () => {
    const { w, tiles, text, setNow } = widget([temp()]);
    const line = tiles()[0].querySelector('.sl-line');
    setNow(NOW + 60e3);
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_temperature', value: 25 });
    expect(text('.sl-value')).toEqual([`${dec(25)}°C`]);
    expect(text('.sl-max')).toEqual(['↑25']);
    expect(tiles()[0].querySelector('.sl-line')).toBe(line);
  });

  it('keeps live points newer than a refreshed (cached) history', () => {
    const { w, text, setNow } = widget([temp()]);
    setNow(NOW + 60e3);
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_temperature', value: 18 });
    setNow(NOW + 120e3);
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_temperature', value: 21.5 });
    w.setState([temp()]);
    expect(text('.sl-min')).toEqual(['↓18']);
  });
});
