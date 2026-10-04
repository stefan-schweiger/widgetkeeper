// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('heatmap'); });
afterEach(() => { document.body.innerHTML = ''; });

const DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

/** 7 days ending `today` (index into DATES); `fn(day, hour)` gives each value. */
function history(fn: (d: number, h: number) => number | null, opts: { last?: number, count?: number, type?: string, value?: any } = {}) {
  const last = opts.last ?? 6;
  const count = opts.count ?? 7;
  const days = [];
  for (let i = 0; i < count; i++) {
    const idx = last - count + 1 + i;
    const d = new Date(`2026-09-28T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + idx);
    days.push({ date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), hours: Array.from({ length: 24 }, (_, h) => fn(i, h)) });
  }
  return {
    name: 'Hue motion sensor',
    icon: null,
    capability: opts.type === 'boolean'
      ? { id: 'alarm_motion', title: 'Motion alarm', type: 'boolean', units: null, decimals: null }
      : { id: 'measure_luminance', title: 'Luminance', type: 'number', units: 'lx', decimals: null },
    value: opts.value ?? 5.2,
    language: 'en',
    days,
  };
}

function widget(data: any, opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createHeatmapWidget(root, { locale: 'en', ...opts });
  if (data) w.setData(data);
  const days = () => [...root.querySelectorAll('.hm-day')].map(e => e.textContent);
  const row = (i: number) => [...root.querySelectorAll('.hm-cells')[i].children] as HTMLElement[];
  const levels = (i: number) => row(i).map(c => (c.classList.contains('none') ? '-' : c.className.match(/l(\d)/)![1])).join('');
  return { w, root, days, row, levels };
}

describe('rows', () => {
  it('this week: Monday to Sunday, the days still to come hatched', () => {
    // Today is Wednesday 30 September.
    const { days, levels } = widget(history(() => 1, { last: 2 }), { period: 'week' });
    expect(days()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(levels(2)).toBe('222222222222');
    expect(levels(3)).toBe('------------');
    expect(levels(6)).toBe('------------');
  });

  it('last 7 days: the days as they come, today last', () => {
    const { days } = widget(history(() => 1, { last: 2 }), { period: 'rolling' });
    expect(days()).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
  });
});

describe('day count', () => {
  it('shows the last 3 or 7 days of a 7-day history', () => {
    expect(widget(history(() => 1), { period: '3' }).days()).toEqual(['Fri', 'Sat', 'Sun']);
    expect(widget(history(() => 1), { period: '7' }).days()).toHaveLength(7);
  });

  it('shows 10 or 14 days with the date, since weekdays repeat', () => {
    // Today is Sunday 4 October.
    const ten = widget(history(() => 1, { count: 14 }), { period: '10' }).days();
    expect(ten).toHaveLength(10);
    // Weekday and day in the language's own order ("25 Fri" in en).
    expect(ten[0]).toMatch(/^(Fri 25|25 Fri)$/);
    expect(ten.at(-1)).toMatch(/^(Sun 4|4 Sun)$/);
    expect(widget(history(() => 1, { count: 14 }), { period: '14' }).days()[0]).toMatch(/^(Mon 21|21 Mon)$/);
  });

  it('this week uses the last 7 days of a 14-day history', () => {
    expect(widget(history(() => 1, { count: 14 }), { period: 'week' }).days()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('maps the setting to the days to fetch', () => {
    expect(['week', 'rolling', '3', '7', '10', '14', undefined, 'x'].map(p => win.heatmapPeriodDays(p))).toEqual([7, 7, 3, 7, 10, 14, 7, 7]);
  });
});

describe('columns', () => {
  it('has 24 / step columns, each the average of its reported hours', () => {
    expect(widget(history(() => 1), { step: 1 }).row(0)).toHaveLength(24);
    expect(widget(history(() => 1), { step: 3 }).row(0)).toHaveLength(8);
    // Hour h has value h, except hour 1 is missing: column 0 averages only hour 0.
    const { row } = widget(history((d, h) => (h === 1 ? null : h)), { step: 2 });
    expect(row(0)[0].title).toContain('0 lx');
    expect(row(0)[1].title).toContain('2.5 lx');
  });

  it('hatches a column with nothing reported', () => {
    const { levels } = widget(history((d, h) => (d === 6 && h >= 10 ? null : h)), { step: 2 });
    expect(levels(6).slice(5)).toBe('-------');
  });
});

describe('scale', () => {
  it('shades five steps from the lowest to the highest value shown', () => {
    const { levels } = widget(history((d, h) => h), { step: 1 });
    expect(levels(0)).toBe('000001111122223333344444');
  });

  it('shows the range and the current value', () => {
    const { root } = widget(history((d, h) => 1 + h), { step: 1 });
    expect([...root.querySelectorAll('.hm-scale-end')].map(e => e.textContent)).toEqual(['1 lx', '24 lx']);
    expect(root.querySelector('.hm-now')!.textContent).toBe('5.2 lx now');
    expect(parseFloat((root.querySelector('.hm-marker') as HTMLElement).style.left)).toBeCloseTo((4.2 / 23) * 100);
  });

  it('on/off values are percentages, with the state now instead of a marker', () => {
    const { root } = widget(history((d, h) => (h < 12 ? 0 : 0.5), { type: 'boolean', value: true }));
    expect([...root.querySelectorAll('.hm-scale-end')].map(e => e.textContent)).toEqual(['0%', '50%']);
    expect(root.querySelector('.hm-now')!.textContent).toBe('Active now');
    expect(root.querySelector('.hm-marker')).toBeNull();
  });

  it('an on/off value that was never on is the lowest level, not the middle', () => {
    expect(widget(history(() => 0, { type: 'boolean' })).levels(0)).toBe('000000000000');
    expect(widget(history(() => 1, { type: 'boolean' })).levels(0)).toBe('444444444444');
    expect(widget(history(() => 0)).levels(0)).toBe('222222222222');
  });

  it('has no scale when nothing was reported', () => {
    const { root, levels } = widget(history(() => null));
    expect(root.querySelector('.hm-scale')).toBeNull();
    expect(levels(0)).toBe('------------');
  });
});

describe('settings', () => {
  it('can hide the scale and the legend', () => {
    const shown = widget(history((d, h) => h)).root;
    expect(shown.querySelector('.hm-scale')).not.toBeNull();
    expect(shown.querySelector('.hm-legend')).not.toBeNull();
    const hidden = widget(history((d, h) => h), { showScale: false, showLegend: false }).root;
    expect(hidden.querySelector('.hm-scale')).toBeNull();
    expect(hidden.querySelector('.hm-legend')).toBeNull();
    expect(hidden.querySelectorAll('.hm-cells')).toHaveLength(7);
  });
});

describe('messages', () => {
  it('a message replaces the heatmap; a transient one keeps it', () => {
    const { w, root } = widget(history(() => 1));
    w.setMessage('Could not load the history.', true);
    expect(root.querySelector('.hm-sub')!.textContent).toBe('Could not load the history.');
    expect(root.querySelectorAll('.hm-cells')).toHaveLength(7);
    w.setMessage('Select a device and a value in the widget settings.');
    expect((root.querySelector('.hm-body') as HTMLElement).style.display).toBe('none');
  });
});
