// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('roomhealth'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

// Expected numbers in the system locale: CI runs in en-US, a developer's machine maybe not.
const num = (n: number, digits = 0) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const CAP = { temperature: 'measure_temperature', humidity: 'measure_humidity', co2: 'measure_co2', radon: 'measure_radon', pm25: 'measure_pm25', pm10: 'measure_pm10', voc: 'measure_voc' } as const;
type M = Partial<Record<keyof typeof CAP, number | null>>;
const sensor = (id: string, zone: [string, string] | null, values: M) => ({
  id, name: `Sensor ${id}`, zone: zone ? { id: zone[0], name: zone[1] } : null,
  measures: Object.fromEntries(Object.entries(values).map(([m, v]) => [m, { capabilityId: CAP[m as keyof typeof CAP], value: v }])),
});
const LIVING: [string, string] = ['z1', 'Living room'];
const BEDROOM: [string, string] = ['z2', 'Bedroom'];

function widget(devices: any[], opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createRoomHealthWidget(root, opts);
  w.setState(devices);
  const rooms = () => [...root.querySelectorAll<HTMLElement>('.rh-room')];
  const text = (sel: string, i = 0) => rooms()[i].querySelector(sel)!.textContent;
  // The large value with its unit, if it shows one.
  const value = (i = 0) => [text('.rh-num', i), text('.rh-unit', i)].filter(Boolean).join(' ');
  const marks = (i = 0) => [...rooms()[i].querySelectorAll<HTMLElement>('.rh-mark')].map(m => [m.dataset.measure, m.dataset.level, m.style.getPropertyValue('--k') || null]);
  const label = (i = 0) => rooms()[i].getAttribute('aria-label');
  return { w, root, rooms, text, value, marks, label };
}

describe('roomHealthRange', () => {
  it('has the defaults, takes numbers and numeric strings, and swaps a lowest above the highest', () => {
    const r = win.roomHealthRange({});
    expect(r).toEqual({
      temperature: { min: 18, max: 24 }, humidity: { min: 30, max: 60 }, co2: { min: null, max: 1000 },
      radon: { min: null, max: 100 }, pm25: { min: null, max: 15 }, pm10: { min: null, max: 45 }, voc: { min: null, max: 1000 },
    });
    const s = win.roomHealthRange({ tempMin: '25', tempMax: 19, humidityMin: '', co2Max: 'lots', vocMax: 600 });
    expect(s.temperature).toEqual({ min: 19, max: 25 });
    expect(s.humidity).toEqual({ min: 30, max: 60 });
    expect(s.co2.max).toBe(1000);
    expect(s.voc.max).toBe(600);
  });
});

describe('roomHealthScore', () => {
  const r = () => win.roomHealthRange({});
  it('is 0 inside the range and on its edges', () => {
    for (const [m, v] of [['temperature', 18], ['temperature', 24], ['humidity', 45], ['co2', 1000], ['radon', 0]] as const) {
      expect(win.roomHealthScore(m, v, r())).toEqual({ score: 0, side: null });
    }
  });

  it('rises to 1 at 3 °C, 10 points or 1.5 × the limit outside, and stays there', () => {
    expect(win.roomHealthScore('temperature', 16.5, r())).toEqual({ score: 0.5, side: 'low' });
    expect(win.roomHealthScore('temperature', 27, r())).toEqual({ score: 1, side: 'high' });
    expect(win.roomHealthScore('humidity', 25, r())).toEqual({ score: 0.5, side: 'low' });
    expect(win.roomHealthScore('humidity', 88, r())).toEqual({ score: 1, side: 'high' });
    expect(win.roomHealthScore('co2', 1400, r())).toEqual({ score: 0.8, side: 'high' });
    expect(win.roomHealthScore('radon', 150, r())).toEqual({ score: 1, side: 'high' });
    expect(win.roomHealthScore('pm25', 18.75, r())).toEqual({ score: 0.5, side: 'high' });
  });

  it('is null without a number', () => {
    expect(win.roomHealthScore('co2', null, r())).toBeNull();
    expect(win.roomHealthScore('co2', NaN, r())).toBeNull();
  });
});

describe('roomHealthRooms', () => {
  it('groups the sensors by zone in the order picked, averaging each measure over the sensors with a reading', () => {
    const rooms = win.roomHealthRooms([
      sensor('a', LIVING, { temperature: 21, humidity: 40 }),
      sensor('b', BEDROOM, { co2: 900 }),
      sensor('c', LIVING, { temperature: 22, humidity: null, co2: 600 }),
      sensor('d', null, { temperature: 19 }),
      { id: 'e', missing: true },
    ]);
    expect(rooms.map((r: any) => [r.key, r.name, r.values])).toEqual([
      ['zone:z1', 'Living room', { temperature: 21.5, humidity: 40, co2: 600 }],
      ['zone:z2', 'Bedroom', { co2: 900 }],
      ['d', 'Sensor d', { temperature: 19 }],
      ['e', undefined, {}],
    ]);
    expect(rooms[3].missing).toBe(true);
  });

  it('keeps a measure the room has but no sensor has read yet, as null', () => {
    expect(win.roomHealthRooms([sensor('a', LIVING, { co2: null })])[0].values).toEqual({ co2: null });
  });
});

describe('Room Health widget', () => {
  it('shows each room as its value, its name and a mark per measure, each in its own colour', () => {
    const { rooms, marks, text, value, label } = widget([
      sensor('a', LIVING, { temperature: 21.4, humidity: 45, co2: 720 }),
      sensor('b', BEDROOM, { temperature: 18.6, humidity: 51, co2: 1400 }),
    ]);
    expect(rooms()).toHaveLength(2);
    expect(marks(0)).toEqual([['temperature', 'good', null], ['humidity', 'good', null], ['co2', 'good', null]]);
    expect(marks(1)).toEqual([['temperature', 'good', null], ['humidity', 'good', null], ['co2', 'off', '0.8']]);
    expect(text('.rh-name', 1)).toBe('Bedroom');
    // The worst value when one is off, with its unit; else the temperature, `°` attached.
    expect(value(0)).toBe(`${num(21.4, 1)}°`);
    expect(value(1)).toBe(`${num(1400)} ppm`);
    const level = (i: number) => rooms()[i].querySelector<HTMLElement>('.rh-value')!;
    expect(level(0).dataset.level).toBe('good');
    expect(level(1).dataset.level).toBe('off');
    expect(level(1).style.getPropertyValue('--k')).toBe('0.8');
    // For screen readers: the state word, then the readings.
    expect(label(0)).toBe(`Living room: Good, ${num(21.4, 1)}°C, ${num(45)}%, ${num(720)} ppm`);
    expect(label(1)).toMatch(/^Bedroom: Stuffy, /);
  });

  it('tones each room by its worst, in three steps, which Vivid fills it with; a fine room only when it is green', () => {
    const devices = [
      sensor('a', LIVING, { temperature: 21, humidity: 63 }),
      sensor('b', BEDROOM, { humidity: 65 }),
      sensor('c', ['z3', 'Office'], { co2: 1400 }),
      sensor('d', ['z4', 'Hall'], { temperature: 21 }),
      sensor('e', ['z5', 'Attic'], { temperature: null }),
      { id: 'gone', missing: true },
    ];
    const tones = (rooms: HTMLElement[]) => rooms.map(r => r.dataset.tone ?? null);
    expect(tones(widget(devices).rooms())).toEqual(['yellow', 'orange', 'red', null, null, null]);
    expect(tones(widget(devices, { greenWhenFine: true }).rooms())).toEqual(['yellow', 'orange', 'red', 'green', null, null]);
  });

  it('puts 3 rooms in a row, or 2 or 4 (`columns`)', () => {
    const one = [sensor('a', LIVING, { temperature: 21 })];
    expect(widget(one).root.dataset.columns).toBe('3');
    expect(widget(one, { columns: '2' }).root.dataset.columns).toBe('2');
    expect(widget(one, { columns: 4 }).root.dataset.columns).toBe('4');
    expect(widget(one, { columns: '5' }).root.dataset.columns).toBe('3');
  });

  it('lines the marks up: a column per measure any room has, in a fixed order, absent where a room has none', () => {
    const { marks } = widget([
      sensor('a', LIVING, { co2: 700, temperature: 21 }),
      sensor('b', BEDROOM, { radon: 40 }),
    ]);
    expect(marks(0).map(m => m.slice(0, 2))).toEqual([['temperature', 'good'], ['co2', 'good'], ['radon', 'absent']]);
    expect(marks(1).map(m => m.slice(0, 2))).toEqual([['temperature', 'absent'], ['co2', 'absent'], ['radon', 'good']]);
  });

  it('draws icons by default, and bars with the Bars layout', () => {
    const icons = widget([sensor('a', LIVING, { temperature: 21, humidity: 40 })]);
    expect(icons.root.classList.contains('rh-icons')).toBe(true);
    expect(icons.rooms()[0].querySelectorAll('.rh-mark svg path')).toHaveLength(2);
    const bars = widget([sensor('a', LIVING, { temperature: 21, humidity: 40 })], { layout: 'bars' });
    expect(bars.root.classList.contains('rh-bars')).toBe(true);
    expect(bars.rooms()[0].querySelectorAll('.rh-mark')).toHaveLength(2);
    expect(bars.rooms()[0].querySelector('.rh-mark svg')).toBeNull();
  });

  it('Green when fine is a class on the root, for the CSS', () => {
    expect(widget([sensor('a', LIVING, { temperature: 21 })]).root.classList.contains('rh-green')).toBe(false);
    expect(widget([sensor('a', LIVING, { temperature: 21 })], { greenWhenFine: true }).root.classList.contains('rh-green')).toBe(true);
  });

  it('a missing sensor is a muted room named Unavailable, without marks', () => {
    const { rooms, text, value, marks, label } = widget([sensor('a', ['z9', 'Office'], { temperature: 19.2 }), { id: 'x', missing: true }]);
    expect(rooms()[1].classList.contains('missing')).toBe(true);
    expect(text('.rh-name', 1)).toBe('Unavailable');
    expect(value(1)).toBe('–');
    expect(marks(1)).toEqual([['temperature', 'absent', null]]);
    expect(label(1)).toBe('Unavailable');
  });

  it('a room without readings shows a dash and faint marks', () => {
    const { value, marks, label } = widget([sensor('a', LIVING, { co2: null, temperature: null })]);
    expect(value()).toBe('–');
    expect(marks()).toEqual([['temperature', 'none', null], ['co2', 'none', null]]);
    expect(label()).toBe('Living room: No readings');
  });

  it.each([
    [{ temperature: 16.5 }, `${num(16.5, 1)}°`, 'Cold'],
    [{ temperature: 26 }, `${num(26, 1)}°`, 'Warm'],
    [{ humidity: 22 }, `${num(22)}%`, 'Dry'],
    [{ humidity: 72 }, `${num(72)}%`, 'Humid'],
    [{ radon: 130 }, `${num(130)} Bq/m³`, 'Radon'],
    [{ pm25: 30 }, `${num(30)} μg/m³`, 'Particles'],
    [{ pm10: 60 }, `${num(60)} μg/m³`, 'Particles'],
    [{ voc: 1300 }, `${num(1300)} ppb`, 'VOCs'],
  ])('%o shows %s, %s', (values, shown, state) => {
    const { value, label } = widget([sensor('a', LIVING, { temperature: 21, ...values } as M)]);
    expect(value()).toBe(shown);
    expect(label()).toMatch(new RegExp(`^Living room: ${state}, `));
  });

  it('a tie goes to the first measure', () => {
    expect(widget([sensor('a', LIVING, { humidity: 90, co2: 2000 })]).value()).toBe(`${num(90)}%`);
  });

  it('uses the ranges from the settings', () => {
    expect(widget([sensor('a', BEDROOM, { temperature: 17 })], { tempMin: 16, tempMax: 19 }).marks()).toEqual([['temperature', 'good', null]]);
    expect(widget([sensor('a', BEDROOM, { co2: 900 })], { co2Max: 800 }).marks()[0][1]).toBe('off');
  });

  it("gives the value its width in ems, and the unit's, so the CSS can shrink it to fit", () => {
    const { rooms } = widget([sensor('a', LIVING, { temperature: 21.4 }), sensor('b', BEDROOM, { co2: 1400 })]);
    const style = (i: number) => rooms()[i].querySelector<HTMLElement>('.rh-value')!.style;
    expect(Number(style(0).getPropertyValue('--rh-em'))).toBeGreaterThan(2);
    expect(style(0).getPropertyValue('--rh-unit-w')).toBe('');
    expect(style(1).getPropertyValue('--rh-unit-w')).toMatch(/^calc\(var\(--rh-fs-small\) \* [\d.]+ \+ 2px\)$/);
  });

  it("a tap steps the value through the room's other readings, back to the usual one past the last or after 6 s", () => {
    const { rooms, value } = widget([
      sensor('a', LIVING, { temperature: 21.4, humidity: 45, co2: 720 }),
      sensor('b', BEDROOM, { temperature: 19, co2: 1400 }),
    ]);
    const picked = (i = 0) => [...rooms()[i].querySelectorAll<HTMLElement>('.rh-mark.picked')].map(m => m.dataset.measure);
    rooms()[0].click();
    expect(value(0)).toBe(`${num(45)}%`);
    expect(rooms()[0].classList.contains('picking')).toBe(true);
    expect(picked()).toEqual(['humidity']);
    rooms()[0].click();
    expect(value(0)).toBe(`${num(720)} ppm`);
    rooms()[0].click();
    expect(value(0)).toBe(`${num(21.4, 1)}°`);
    expect(rooms()[0].classList.contains('picking')).toBe(false);
    // The bedroom shows its CO₂ (off), so a tap goes on from there, round to the temperature.
    rooms()[1].click();
    expect(value(1)).toBe(`${num(19, 1)}°`);
    vi.advanceTimersByTime(5999);
    expect(value(1)).toBe(`${num(19, 1)}°`);
    vi.advanceTimersByTime(1);
    expect(value(1)).toBe(`${num(1400)} ppm`);
    expect(picked(1)).toEqual([]);
  });

  it('a tap on a missing sensor or on a room with one reading does nothing', () => {
    const { rooms, value } = widget([sensor('a', LIVING, { temperature: 21 }), { id: 'x', missing: true }]);
    rooms()[0].click();
    rooms()[1].click();
    expect(value(0)).toBe(`${num(21, 1)}°`);
    expect(rooms().some(r => r.classList.contains('picking'))).toBe(false);
  });

  it('updates from realtime events, for the capability it shows only', () => {
    const { w, value, marks } = widget([sensor('a', BEDROOM, { co2: 800 })]);
    expect(marks()[0][1]).toBe('good');
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_co2', measure: 'co2', value: 1500 });
    expect(value()).toBe(`${num(1500)} ppm`);
    expect(marks()[0][1]).toBe('off');
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_co2.other', measure: 'co2', value: 500 });
    w.pushChange({ deviceId: 'b', capabilityId: 'measure_co2', measure: 'co2', value: 500 });
    expect(value()).toBe(`${num(1500)} ppm`);
  });

  it('messages: a persistent one clears the rooms, a transient one keeps them for 8 s', () => {
    const { w, root, rooms } = widget([sensor('a', LIVING, { temperature: 21 })]);
    w.setMessage('Could not load the sensors.', true);
    expect(rooms()).toHaveLength(1);
    expect(root.querySelector('.rh-message')!.classList.contains('error')).toBe(true);
    vi.advanceTimersByTime(8000);
    expect(root.querySelector<HTMLElement>('.rh-message')!.style.display).toBe('none');
    w.setMessage('Select sensors in the widget settings.');
    expect(rooms()).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('.rh-tile')!.style.display).toBe('none');
  });

  it('takes its strings from Homey', () => {
    const nl: Record<string, string> = { 'roomhealth.stuffy': 'Bedompt', 'roomhealth.unavailable': 'Niet beschikbaar' };
    const t = (key: string) => nl[key] ?? key;
    const { label, text } = widget([sensor('a', BEDROOM, { co2: 1400 }), { id: 'x', missing: true }], { t });
    expect(label()).toBe(`Bedroom: Bedompt, ${num(1400)} ppm`);
    expect(text('.rh-name', 1)).toBe('Niet beschikbaar');
  });
});
