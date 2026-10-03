// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

const HOUR = 3600e3;
// 15:20 in Copenhagen (the test time zone).
const NOW = Date.parse('2026-10-03T13:20:00Z');

let win: any;
beforeAll(() => { win = loadWidget('weather'); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

function hours(count = 48, from = Date.parse('2026-10-03T13:00:00Z')) {
  return Array.from({ length: count }, (_, i) => ({
    t: new Date(from + i * HOUR).toISOString(),
    symbol: i % 2 ? 'rain' : 'partlycloudy_day',
    temp: 4 - i / 2,
    wind: 5.4,
    windDir: 90,
    precip: i % 2 ? 1.25 : 0,
  }));
}

function widget(data: any = { hours: hours(), language: 'en' }, opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createWeatherWidget(root, { locale: 'en', ...opts });
  if (data) w.setForecast(data);
  const cols = () => [...root.querySelectorAll<HTMLElement>('.wf-col')];
  const strip = root.querySelector<HTMLElement>('.wf-strip')!;
  return { w, root, cols, strip };
}

describe('render', () => {
  it('shows 36 hours from the current hour', () => {
    const { cols } = widget({ hours: hours(48, Date.parse('2026-10-03T12:00:00Z')), language: 'en' });
    expect(cols()).toHaveLength(36);
    expect(cols()[0].dataset.t).toBe('2026-10-03T13:00:00.000Z');
  });

  it('labels the first hour "Now", midnight with the weekday, the rest with the local hour', () => {
    const { cols } = widget();
    const labels = cols().map(c => c.querySelector('.wf-hour')!.textContent);
    expect(labels[0]).toBe('Now');
    expect(labels[1]).toBe('16');
    expect(labels[9]).toBe('Sun'); // 22:00Z = 00:00 in Copenhagen
    expect(cols()[9].classList.contains('wf-newday')).toBe(true);
  });

  it('shows the icon, temperature, precipitation and wind, with the units in the footer when compact', () => {
    const { cols, root } = widget();
    const [first, second] = cols();
    expect(first.querySelector('img')!.getAttribute('src')).toBe('icons/partlycloudy_day.svg');
    expect(first.querySelector('.wf-temp')!.textContent).toBe('4°');
    expect(first.querySelector('.wf-temp')!.classList.contains('cold')).toBe(true); // 4°
    expect(first.querySelector('.wf-precip')!.textContent).toBe('');
    expect(second.querySelector('.wf-precip')!.textContent).toBe('1.3');
    expect(first.querySelector('.wf-wind')!.textContent).toBe('5');
    expect(root.querySelector('.wf-units')!.textContent).toBe('mm · m/s');
    // From the east, so it blows west.
    expect(first.querySelector<SVGElement>('.wf-arrow')!.style.transform).toBe('rotate(270deg)');
  });

  it('puts the units on every value when detailed', () => {
    const { cols, root } = widget(undefined, { density: 'detailed' });
    expect(root.classList.contains('wf-detailed')).toBe(true);
    expect(cols()[1].querySelector('.wf-precip')!.textContent).toBe('1.3 mm');
    expect(cols()[0].querySelector('.wf-wind')!.textContent).toBe('5 m/s');
    expect(root.querySelector('.wf-units')).toBeNull();
  });

  it('colours temperatures from blue through neutral at 12° to red, with no minus on zero', () => {
    const { cols } = widget({ hours: [{ ...hours(1)[0], temp: -0.3 }, { ...hours(2)[1], temp: -2.6 }] });
    expect(cols().map(c => c.querySelector('.wf-temp')!.textContent)).toEqual(['0°', '-3°']);
    const color = (temp: number) => {
      const el = widget({ hours: [{ ...hours(1)[0], temp }] }).cols()[0].querySelector<HTMLElement>('.wf-temp')!;
      return `${el.classList.contains('warm') ? 'warm' : 'cold'} ${el.style.getPropertyValue('--k')}`;
    };
    expect([-20, -5, 0, 12, 13, 20, 28, 35].map(color)).toEqual(['cold 1', 'cold 1', 'cold 0.71', 'cold 0', 'warm 0.06', 'warm 0.5', 'warm 1', 'warm 1']);
  });

  it('ignores symbol codes that are not plain names', () => {
    const { cols } = widget({ hours: [{ ...hours(1)[0], symbol: '../x' }] });
    expect(cols()[0].querySelector('img')).toBeNull();
  });
});

describe('footer', () => {
  it('shows the high and low for the rest of today and for tomorrow, in local time', () => {
    const { root } = widget();
    const days = [...root.querySelectorAll('.wf-day')].map(d => d.textContent);
    // Today: 15:00-23:00 local (4° falling to 0°); tomorrow: 00:00-23:00 (0° to -12°).
    expect(days).toEqual(['Today↑4°↓0°', 'Tomorrow↑0°↓-12°']);
    const ranges = [...root.querySelectorAll('.wf-range')];
    expect(ranges[0].classList.contains('cold')).toBe(true); // 4°
    expect(ranges[1].style.getPropertyValue('--k')).toBe('0.71'); // 0°
  });

  it('leaves out a day with no hours', () => {
    const { root } = widget({ hours: hours(3), language: 'en' });
    expect([...root.querySelectorAll('.wf-day-label')].map(d => d.textContent)).toEqual(['Today']);
  });
});

describe('interval', () => {
  it('combines 3 hours per column on the clock: average temperature and wind, summed precipitation', () => {
    const { cols } = widget(undefined, { step: '3' });
    expect(cols()).toHaveLength(12);
    const first = cols()[0];
    expect(first.dataset.t).toBe('2026-10-03T13:00:00.000Z'); // 15:00-17:59 local
    expect(first.querySelector('.wf-hour')!.textContent).toBe('Now');
    expect(cols()[1].querySelector('.wf-hour')!.textContent).toBe('18');
    expect(first.querySelector('.wf-temp')!.textContent).toBe('4°'); // (4 + 3.5 + 3) / 3 = 3.5
    expect(first.querySelector('.wf-precip')!.textContent).toBe('1.3'); // one wet hour of 1.25
    expect(first.querySelector('img')!.getAttribute('src')).toBe('icons/rain.svg'); // the wettest hour
    expect(first.querySelector<SVGElement>('.wf-arrow')!.style.transform).toBe('rotate(270deg)');
  });

  it('starts with a shorter column when the current hour is off the clock', () => {
    const { cols } = widget(undefined, { step: '2' });
    // 15:00 alone, then 16-17, 18-19 … over the 36 hours.
    expect(cols().slice(0, 3).map(c => c.dataset.t)).toEqual(['2026-10-03T13:00:00.000Z', '2026-10-03T14:00:00.000Z', '2026-10-03T16:00:00.000Z']);
    expect(cols()).toHaveLength(19);
    expect(cols()[1].querySelector('.wf-precip')!.textContent).toBe('1.3');
  });

  it('averages the wind direction by speed', () => {
    // 16:00 and 17:00 local make one 2-hour column: from 350° at 4 m/s and 30° at 2 m/s.
    const [a, b] = hours(2, Date.parse('2026-10-03T14:00:00Z'));
    const { cols } = widget({ hours: [{ ...a, wind: 4, windDir: 350 }, { ...b, wind: 2, windDir: 30 }] }, { step: '2' });
    expect(cols()).toHaveLength(1);
    expect(cols()[0].querySelector('.wf-wind')!.textContent).toBe('3'); // (4 + 2) / 2
    // The vector average is 3°, so the arrow points to 183°.
    expect(cols()[0].querySelector<SVGElement>('.wf-arrow')!.style.transform).toBe('rotate(183deg)');
  });
});

describe('two rows', () => {
  it('lays the hours out in pages of two rows of the visible columns', () => {
    const { root, cols } = widget(undefined, { rows: '2' });
    expect(root.classList.contains('wf-paged')).toBe(true);
    // happy-dom has no container queries, so the compact fallback of 9 columns applies: 18 per page.
    const pages = [...root.querySelectorAll('.wf-page')];
    expect(pages.map(p => p.querySelectorAll('.wf-col').length)).toEqual([18, 18]);
    expect(cols()).toHaveLength(36);
  });

  it('uses one row by default', () => {
    const { root } = widget();
    expect(root.querySelector('.wf-page')).toBeNull();
    expect(root.classList.contains('wf-paged')).toBe(false);
  });
});

describe('updates', () => {
  it('keeps the scroll position when the forecast is refreshed', () => {
    const { w, strip } = widget();
    strip.scrollLeft = 120;
    w.setForecast({ hours: hours(), language: 'en' });
    expect(strip.scrollLeft).toBe(120);
  });

  it('leaves the strip alone when a refresh brings the same forecast', () => {
    const { w, root } = widget();
    const first = root.querySelector('.wf-col');
    w.setForecast({ hours: hours(), language: 'en' });
    expect(root.querySelector('.wf-col')).toBe(first);
    w.setForecast({ hours: hours().map(h => ({ ...h, temp: 20 })), language: 'en' });
    expect(root.querySelector('.wf-col')).not.toBe(first);
  });

  it('uses the icons sent with the forecast, and their files otherwise', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const { cols } = widget({ hours: hours(), language: 'en', icons: { rain: svg } });
    expect(cols()[1].querySelector('img')!.getAttribute('src')).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    expect(cols()[0].querySelector('img')!.getAttribute('src')).toBe('icons/partlycloudy_day.svg');
  });

  it('drops the hour that has passed, on the hour', () => {
    const { cols } = widget();
    expect(cols()[0].dataset.t).toBe('2026-10-03T13:00:00.000Z');
    vi.advanceTimersByTime(41 * 60e3);
    expect(cols()[0].dataset.t).toBe('2026-10-03T14:00:00.000Z');
    expect(cols()).toHaveLength(36);
  });

  it('uses Homey\'s language for weekdays', () => {
    const { cols } = widget({ hours: hours(), language: 'da' });
    expect(cols()[9].querySelector('.wf-hour')!.textContent).toBe('søn.');
  });
});

describe('messages', () => {
  it('shows a message instead of the strip', () => {
    const { w, root, cols } = widget();
    w.setMessage('Could not load the forecast.');
    expect(cols()).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('.wf-message')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.wf-message')!.textContent).toBe('Could not load the forecast.');
    expect(root.querySelector<HTMLElement>('.wf-footer')!.hidden).toBe(true);
  });

  it('asks for Homey\'s location when it is not set', () => {
    const { root } = widget({ hours: [], noLocation: true, language: 'en' });
    expect(root.querySelector('.wf-message')!.textContent).toBe('Set Homey\'s location to see the forecast.');
  });

  it('uses the translated strings', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const w = win.createWeatherWidget(root, { t: (key: string) => (key === 'weather.now' ? 'Nu' : key) });
    w.setForecast({ hours: hours() });
    expect(root.querySelector('.wf-hour')!.textContent).toBe('Nu');
    expect(root.querySelector('.wf-day-label')!.textContent).toBe('Today'); // untranslated keys fall back to English
  });
});
