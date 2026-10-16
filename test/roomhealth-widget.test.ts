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
const KITCHEN: [string, string] = ['z3', 'Kitchen'];

function widget(devices: any[], opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createRoomHealthWidget(root, opts);
  w.setState(devices);
  const rooms = () => [...root.querySelectorAll<HTMLElement>('.rh-room')];
  const text = (sel: string, i = 0) => rooms()[i].querySelector(sel)!.textContent;
  const hint = () => root.querySelector('.rh-hint-text')!.textContent;
  const arcs = (i = 0) => [...rooms()[i].querySelectorAll<SVGCircleElement>('circle')].map(c => [c.dataset.measure ?? null, c.dataset.level, c.style.getPropertyValue('--k') || null]);
  return { w, root, rooms, text, hint, arcs };
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
  it('draws a ring per room with an arc per measure, each in its own colour', () => {
    const { rooms, arcs, text } = widget([
      sensor('a', LIVING, { temperature: 21.4, humidity: 45, co2: 720 }),
      sensor('b', BEDROOM, { temperature: 18.6, humidity: 51, co2: 1400 }),
    ]);
    expect(rooms()).toHaveLength(2);
    expect(arcs(0)).toEqual([['temperature', 'good', null], ['humidity', 'good', null], ['co2', 'good', null]]);
    expect(arcs(1)).toEqual([['temperature', 'good', null], ['humidity', 'good', null], ['co2', 'off', '0.8']]);
    expect(text('.rh-name', 1)).toBe('Bedroom');
    // The centre shows the worst value with its unit under it, else the temperature.
    expect(text('.rh-value', 0)).toBe(`${num(21.4, 1)}°`);
    expect(text('.rh-value', 1)).toBe(num(1400));
    expect(text('.rh-unit', 1)).toBe('ppm');
    expect(text('.rh-state', 0)).toBe('Good');
    expect(text('.rh-state', 1)).toBe('Stuffy');
    expect(rooms()[1].querySelector<HTMLElement>('.rh-state')!.dataset.level).toBe('off');
  });

  it('a room with one sensor gets one full ring; a missing sensor a dashed one, named Unavailable', () => {
    const { root, rooms, text, arcs } = widget([sensor('a', ['z9', 'Office'], { temperature: 19.2 }), { id: 'x', missing: true }]);
    const one = rooms()[0].querySelector('circle')!;
    expect(one.getAttribute('stroke-dasharray')).toBeNull();
    expect(text('.rh-state', 0)).toBe('Good');
    expect(rooms()[1].classList.contains('missing')).toBe(true);
    expect(text('.rh-name', 1)).toBe('Unavailable');
    expect(arcs(1)).toEqual([[null, 'none', null]]);
    expect(root.querySelector('.rh-hint')!.classList.contains('good')).toBe(true);
  });

  it('a room without readings is muted and says so', () => {
    const { text, arcs, root } = widget([sensor('a', LIVING, { co2: null })]);
    expect(text('.rh-state')).toBe('No readings');
    expect(text('.rh-value')).toBe('–');
    expect(arcs()).toEqual([['co2', 'none', null]]);
    // Nothing known: the hint line keeps its place but says nothing.
    expect(root.querySelector('.rh-hint')!.classList.contains('empty')).toBe(true);
  });

  it('names the worst problem in the house, with the value and what to do', () => {
    const { hint, root } = widget([
      sensor('a', KITCHEN, { temperature: 22.8, humidity: 64 }),
      sensor('b', BEDROOM, { temperature: 18.6, co2: 1400 }),
      sensor('c', ['z4', "Emma's room"], { radon: 118 }),
    ]);
    expect(hint()).toBe(`Bedroom: stuffy, ${num(1400)} ppm. Air it out.`);
    expect(root.querySelector('.rh-hint-text b')!.textContent).toBe('Bedroom');
    expect(root.querySelector<HTMLElement>('.rh-problem')!.dataset.level).toBe('off');
    expect(root.querySelector<HTMLElement>('.rh-hint-dot')!.style.getPropertyValue('--k')).toBe('0.8');
  });

  it.each([
    [{ temperature: 16.5 }, `cold, ${num(16.5, 1)}°C. Turn up the heat.`],
    [{ temperature: 26 }, `warm, ${num(26, 1)}°C. Cool it down.`],
    [{ humidity: 22 }, `dry, ${num(22)}%. Humidify the air.`],
    [{ humidity: 72 }, `humid, ${num(72)}%. Air it out.`],
    [{ radon: 130 }, `high radon, ${num(130)} Bq/m³. Ventilate more.`],
    [{ pm25: 30 }, `particles, ${num(30)} μg/m³. Run an air purifier.`],
    [{ pm10: 60 }, `particles, ${num(60)} μg/m³. Run an air purifier.`],
    [{ voc: 1300 }, `VOCs, ${num(1300)} ppb. Air it out.`],
  ])('hint for %o', (values, text) => {
    expect(widget([sensor('a', LIVING, values as M)]).hint()).toBe(`Living room: ${text}`);
  });

  it('a tie goes to the first room, and within a room to the first measure', () => {
    expect(widget([
      sensor('a', LIVING, { humidity: 90, co2: 2000 }),
      sensor('b', BEDROOM, { temperature: 10 }),
    ]).hint()).toBe(`Living room: humid, ${num(90)}%. Air it out.`);
  });

  it('says all is well when every reading is inside its range', () => {
    const { hint, root } = widget([sensor('a', LIVING, { temperature: 21, co2: 700 })]);
    expect(hint()).toBe('All rooms are comfortable.');
    expect(root.querySelector('.rh-hint')!.classList.contains('good')).toBe(true);
  });

  it('uses the ranges from the settings', () => {
    const { hint } = widget([sensor('a', BEDROOM, { temperature: 17 })], { tempMin: 16, tempMax: 19 });
    expect(hint()).toBe('All rooms are comfortable.');
    expect(widget([sensor('a', BEDROOM, { co2: 900 })], { co2Max: 800 }).hint()).toBe(`Bedroom: stuffy, ${num(900)} ppm. Air it out.`);
  });

  it("a tap shows the room's readings in the hint line for 6 s; another tap ends it", () => {
    const { rooms, hint, root } = widget([
      sensor('a', LIVING, { temperature: 21.4, humidity: 45, co2: 720 }),
      sensor('b', BEDROOM, { co2: 1400 }),
    ]);
    rooms()[0].click();
    expect(hint()).toBe(`Living room · ${num(21.4, 1)}°C · ${num(45)}% · ${num(720)} ppm`);
    expect(rooms()[0].classList.contains('selected')).toBe(true);
    expect(root.querySelector('.rh-hint')!.classList.contains('readout')).toBe(true);
    vi.advanceTimersByTime(5999);
    expect(hint()).toMatch(/^Living room · /);
    vi.advanceTimersByTime(1);
    expect(hint()).toMatch(/^Bedroom: stuffy/);
    expect(rooms()[0].classList.contains('selected')).toBe(false);
    rooms()[1].click();
    expect(hint()).toBe(`Bedroom · ${num(1400)} ppm`);
    rooms()[1].click();
    expect(hint()).toMatch(/^Bedroom: stuffy/);
  });

  it('a tap on a missing sensor does nothing', () => {
    const { rooms, hint } = widget([sensor('a', LIVING, { temperature: 21 }), { id: 'x', missing: true }]);
    rooms()[1].click();
    expect(hint()).toBe('All rooms are comfortable.');
  });

  it('updates from realtime events, for the capability it shows only', () => {
    const { w, hint, text } = widget([sensor('a', BEDROOM, { co2: 800 })]);
    expect(hint()).toBe('All rooms are comfortable.');
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_co2', measure: 'co2', value: 1500 });
    expect(hint()).toBe(`Bedroom: stuffy, ${num(1500)} ppm. Air it out.`);
    expect(text('.rh-state')).toBe('Stuffy');
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_co2.other', measure: 'co2', value: 500 });
    w.pushChange({ deviceId: 'b', capabilityId: 'measure_co2', measure: 'co2', value: 500 });
    expect(hint()).toMatch(/stuffy/);
  });

  it('messages: a persistent one clears the rings, a transient one keeps them for 8 s', () => {
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

  it('takes its strings from Homey, with the hint in the language\'s own order', () => {
    const t = (key: string, tokens?: Record<string, string>) => {
      const nl: Record<string, string> = {
        'roomhealth.hint': '__action__ (__room__ is __problem__: __value__)', 'roomhealth.problemStuffy': 'bedompt', 'roomhealth.actionAirOut': 'Lucht de ruimte.',
      };
      return (nl[key] ?? key).replace(/__(\w+)__/g, (_, k) => tokens?.[k] ?? '');
    };
    const { hint, root } = widget([sensor('a', BEDROOM, { co2: 1400 })], { t });
    expect(hint()).toBe(`Lucht de ruimte. (Bedroom is bedompt: ${num(1400)} ppm)`);
    expect(root.querySelector('.rh-hint-text b')!.textContent).toBe('Bedroom');
  });
});
