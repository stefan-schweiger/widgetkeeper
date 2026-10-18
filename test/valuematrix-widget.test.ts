// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('valuematrix'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

// Expected numbers in the system locale: CI runs in en-US, a developer's machine maybe not.
const num = (n: number, digits = 0, grouping = true) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouping });

const T = 'measure_temperature', H = 'measure_humidity', C = 'measure_co2', R = 'measure_radon';
const DESCRIBED: Record<string, object> = {
  [T]: { capabilityId: T, title: 'Temperature', units: '°C', decimals: 1 },
  [H]: { capabilityId: H, title: 'Humidity', units: '%', decimals: 0 },
  [C]: { capabilityId: C, title: 'CO2', units: 'ppm', decimals: 0 },
  [R]: { capabilityId: R, title: 'Radon', units: 'Bq/m³', decimals: 0 },
  measure_power: { capabilityId: 'measure_power', title: 'Power', units: 'W', decimals: 0 },
  measure_luminance: { capabilityId: 'measure_luminance', title: 'Light level', units: 'lux', decimals: 0 },
};
const LIVING = { id: 'z1', name: 'Living room' };
const BEDROOM = { id: 'z2', name: 'Bedroom' };
const device = (id: string, zone: object | null, values: Record<string, number | null>) => ({ id, name: `Sensor ${id}`, zone, values });

function widget(devices: any[], columns: { capabilityId: string, range?: string, header?: string }[], opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createValueMatrixWidget(root, { columns, ...opts });
  w.setState({ columns: columns.map(c => DESCRIBED[c.capabilityId] || null), devices });
  const rows = () => [...root.querySelectorAll<HTMLElement>('.vm-row:not(.vm-head)')];
  const names = () => rows().map(r => r.querySelector('.vm-name')!.textContent);
  const cells = (i = 0) => [...rows()[i].querySelectorAll<HTMLElement>('.vm-cell')].map(c => [c.textContent, c.dataset.level]);
  const headers = () => [...root.querySelectorAll('.vm-head .vm-label')].map(l => l.textContent);
  const legend = () => root.querySelector<HTMLElement>('.vm-legend')!;
  return { w, root, rows, names, cells, headers, legend };
}

describe('valueMatrixRange', () => {
  it('reads a span (any dash, decimals with a point or a comma, negatives) and one-sided limits', () => {
    expect(win.valueMatrixRange('18–24')).toEqual({ min: 18, max: 24 });
    expect(win.valueMatrixRange(' 24 - 18 ')).toEqual({ min: 18, max: 24 });
    expect(win.valueMatrixRange('-5—2,5')).toEqual({ min: -5, max: 2.5 });
    expect(win.valueMatrixRange('<1000')).toEqual({ min: null, max: 1000 });
    expect(win.valueMatrixRange('≤ 0.5')).toEqual({ min: null, max: 0.5 });
    expect(win.valueMatrixRange('>10')).toEqual({ min: 10, max: null });
    expect(win.valueMatrixRange('≥ -3')).toEqual({ min: -3, max: null });
  });

  it("is none for a lone dash or text it can't read", () => {
    for (const s of ['–', '-', 'about 20', '18 to 24', '<', '1000']) expect(win.valueMatrixRange(s, DESCRIBED[C])).toBeNull();
  });

  it('is the usual range when empty, only for a known capability in its unit', () => {
    expect(win.valueMatrixRange('', DESCRIBED[T])).toEqual({ min: 18, max: 24 });
    expect(win.valueMatrixRange(undefined, { capabilityId: 'measure_temperature.room', units: '°C' })).toEqual({ min: 18, max: 24 });
    expect(win.valueMatrixRange('', { capabilityId: T, units: '°F' })).toBeNull();
    expect(win.valueMatrixRange('', DESCRIBED[H])).toEqual({ min: 30, max: 60 });
    expect(win.valueMatrixRange('', DESCRIBED[C])).toEqual({ min: null, max: 1000 });
    expect(win.valueMatrixRange('', { capabilityId: C, units: null })).toEqual({ min: null, max: 1000 });
    expect(win.valueMatrixRange('', DESCRIBED[R])).toEqual({ min: null, max: 100 });
    expect(win.valueMatrixRange('', { capabilityId: R, units: 'pCi/L' })).toBeNull();
    expect(win.valueMatrixRange('', { capabilityId: 'measure_VOC', units: 'ppb' })).toEqual({ min: null, max: 1000 });
    expect(win.valueMatrixRange('', DESCRIBED.measure_power)).toBeNull();
  });
});

describe('valueMatrixLevel', () => {
  it('is good inside the range and on its edges, out past it, far past it by half its width', () => {
    const r = { min: 18, max: 24 };
    expect([18, 21, 24].map(v => win.valueMatrixLevel(v, r))).toEqual(['good', 'good', 'good']);
    expect([17.9, 15.1, 24.5, 26.9].map(v => win.valueMatrixLevel(v, r))).toEqual(['out', 'out', 'out', 'out']);
    expect([15, 27, 40].map(v => win.valueMatrixLevel(v, r))).toEqual(['far', 'far', 'far']);
  });

  it('is far at 1.5 × an upper limit and half a lower one', () => {
    expect([1000, 1499, 1500].map(v => win.valueMatrixLevel(v, { min: null, max: 1000 }))).toEqual(['good', 'out', 'far']);
    expect([20, 11, 10].map(v => win.valueMatrixLevel(v, { min: 20, max: null }))).toEqual(['good', 'out', 'far']);
  });

  it('is plain without a range and none without a reading', () => {
    expect(win.valueMatrixLevel(5, null)).toBe('plain');
    expect(win.valueMatrixLevel(null, { min: 1, max: 2 })).toBe('none');
    expect(win.valueMatrixLevel(NaN, null)).toBe('none');
  });
});

describe('valueMatrixRows', () => {
  const devices = () => [
    device('a', LIVING, { [T]: 21, [H]: 40 }),
    device('b', BEDROOM, { [T]: 18 }),
    device('c', LIVING, { [T]: 23, [C]: 800, [H]: null }),
    device('d', null, { [T]: 20 }),
    { id: 'gone', missing: true },
  ];

  it('groups by room in the order picked, averaging the readings; a device without a room or a missing one is its own row', () => {
    const rows = win.valueMatrixRows(devices(), 'rooms');
    expect(rows.map((r: any) => [r.key, r.name ?? null])).toEqual([['zone:z1', 'Living room'], ['zone:z2', 'Bedroom'], ['d', 'Sensor d'], ['gone', null]]);
    expect(rows[0].values).toEqual({ [T]: 22, [H]: 40, [C]: 800 });
    expect(rows[3].missing).toBe(true);
  });

  it('has a row per device in devices mode', () => {
    const rows = win.valueMatrixRows(devices(), 'devices');
    expect(rows.map((r: any) => r.key)).toEqual(['a', 'b', 'c', 'd', 'gone']);
    expect(rows[2].values).toEqual({ [T]: 23, [C]: 800, [H]: null });
  });
});

describe('createValueMatrixWidget', () => {
  const four = [{ capabilityId: T }, { capabilityId: H }, { capabilityId: C }, { capabilityId: R }];

  it('draws a row per room and a cell per column, coloured by level, striped where the room has no such value', () => {
    const { names, cells, headers } = widget([
      device('a', LIVING, { [T]: 21.43, [H]: 44, [C]: 1640 }),
      device('b', BEDROOM, { [T]: 18.2, [H]: 64, [R]: null }),
    ], four);
    expect(headers()).toEqual(['', '°C', '%', 'CO₂', 'Radon']);
    expect(names()).toEqual(['Living room', 'Bedroom']);
    expect(cells(0)).toEqual([[num(21.4, 1), 'good'], ['44', 'good'], [num(1640), 'far'], ['', 'absent']]);
    expect(cells(1)).toEqual([[num(18.2, 1), 'good'], ['64', 'out'], ['', 'absent'], ['–', 'none']]);
  });

  it('labels a column by its typed header, else its short units, else its title, and colours it by its typed range', () => {
    const { headers, cells } = widget([device('a', null, { measure_power: 1840, measure_luminance: 30 })],
      [{ capabilityId: 'measure_power', header: ' Watt ' }, { capabilityId: 'measure_luminance', range: '>50' }, { capabilityId: T, range: '–' }]);
    expect(headers()).toEqual(['', 'Watt', 'lux', '°C']);
    expect(cells(0)).toEqual([[num(1840), 'plain'], ['30', 'out'], ['', 'absent']]);
  });

  it('has a row for a missing device, named Unavailable, with empty cells', () => {
    const { names, cells, rows } = widget([{ id: 'gone', missing: true }], four);
    expect(names()).toEqual(['Unavailable']);
    expect(rows()[0].classList.contains('missing')).toBe(true);
    expect(cells(0).map(c => c[1])).toEqual(['none', 'none', 'none', 'none']);
  });

  it('drops the thousands separator with more than four columns', () => {
    const { cells } = widget([device('a', null, { [C]: 1640 })], [...four, { capabilityId: 'measure_power' }]);
    expect(cells(0)[2]).toEqual([num(1640, 0, false), 'far']);
  });

  it('labels the legend OK, Warning and Alert', () => {
    const { legend } = widget([device('a', null, { [C]: 5 })], [{ capabilityId: C }]);
    expect([...legend().querySelectorAll('.vm-key-label')].map(l => l.textContent)).toEqual(['OK', 'Warning', 'Alert']);
  });

  it('shows the legend only when a column has a range and it is on', () => {
    const d = [device('a', null, { measure_power: 5 })];
    expect(widget(d, [{ capabilityId: 'measure_power' }]).legend().style.display).toBe('none');
    expect(widget(d, [{ capabilityId: 'measure_power', range: '<10' }]).legend().style.display).toBe('');
    expect(widget(d, [{ capabilityId: 'measure_power', range: '<10' }], { showLegend: false }).legend().style.display).toBe('none');
  });

  it('updates a cell from a realtime change, but not for a capability the device has not', () => {
    const { w, cells } = widget([device('a', null, { [C]: 800 })], [{ capabilityId: C }, { capabilityId: H }]);
    w.pushChange({ deviceId: 'a', capabilityId: C, value: 1200 });
    w.pushChange({ deviceId: 'a', capabilityId: H, value: 50 });
    expect(cells(0)).toEqual([[num(1200), 'out'], ['', 'absent']]);
  });

  it('reads a row out with its values and their levels', () => {
    const { rows } = widget([device('a', LIVING, { [T]: 21.4, [H]: null, [C]: 1200 })], four);
    expect(rows()[0].getAttribute('aria-label')).toBe(`Living room: °C ${num(21.4, 1)} OK, % No reading, CO₂ ${num(1200)} Warning`);
  });

  it('puts Vivid on the root and keeps a typed row name', () => {
    const { w, root, names } = widget([device('a', LIVING, { [T]: 21 })], four, { colorStyle: 'deep' });
    w.setNames({ 'zone:z1': 'Lounge' });
    expect(root.classList.contains('wk-deep')).toBe(true);
    expect(names()).toEqual(['Lounge']);
  });

  it('hides the table behind a message', () => {
    const { w, root } = widget([], four);
    w.setMessage(w.t('selectColumns'));
    expect(root.querySelector<HTMLElement>('.vm-tile')!.style.display).toBe('none');
    expect(root.querySelector('.vm-message')!.textContent).toBe('Pick the values to show in the widget settings.');
  });
});
