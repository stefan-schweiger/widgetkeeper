// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockWeather } from '../widgets/clock/api.js';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('clock'); loadMount('clock'); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:40:20+02:00')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const WEATHER = { symbol: 'partlycloudy_day', temp: 12.4, high: 14.2, low: 7.6, icon: '<svg xmlns="http://www.w3.org/2000/svg"/>' };

function widget(state: any, opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createClockWidget(root, { locale: 'da-DK', ...opts });
  if (state) w.setState(state);
  const text = (sel: string) => root.querySelector(sel)!.textContent;
  const weather = () => root.querySelector<HTMLElement>('.ck-weather')!;
  const icon = () => root.querySelector<HTMLImageElement>('.ck-icon')!;
  return { w, root, text, weather, icon };
}

describe('time and date', () => {
  it("shows the time in the screen's locale and the date in Homey's language", () => {
    const { text } = widget({ language: 'en', weather: null });
    expect(text('.ck-time')).toBe('18.40');
    expect(text('.ck-date')).toBe('Tuesday, 6 October'); // English in the screen's (Danish) order
    expect(widget({ language: 'de', weather: null }).text('.ck-date')).toBe('Dienstag, 6. Oktober');
    expect(widget({ language: 'en', weather: null }, { locale: 'en-US' }).text('.ck-date')).toBe('Tuesday, October 6');
  });

  it('uses 12 hours where the locale does', () => {
    expect(widget(null, { locale: 'en-US' }).text('.ck-time')).toBe('6:40 PM');
    expect(widget(null, { locale: 'en-GB' }).text('.ck-time')).toBe('18:40');
  });

  it('falls back to English before the app answers, and for an unknown language', () => {
    expect(widget(null, { locale: 'en-GB' }).text('.ck-date')).toBe('Tuesday 6 October');
    expect(widget({ language: '!!', weather: null }, { locale: 'en-GB' }).text('.ck-date')).toBe('Tuesday 6 October');
  });

  it('moves on as the minute turns, and over midnight', () => {
    const { text } = widget({ language: 'en', weather: null }, { locale: 'en-GB' });
    vi.advanceTimersByTime(39e3);
    expect(text('.ck-time')).toBe('18:40');
    vi.advanceTimersByTime(1.1e3); // just after the minute turns
    expect(text('.ck-time')).toBe('18:41');
    vi.advanceTimersByTime(5 * 3600e3 + 19 * 60e3);
    expect(text('.ck-time')).toBe('00:00');
    expect(text('.ck-date')).toBe('Wednesday 7 October');
  });
});

describe('weather', () => {
  it('shows the icon, the temperature and today\'s high and low', () => {
    const { text, weather, icon } = widget({ language: 'en', weather: WEATHER });
    expect(weather().style.display).toBe('');
    expect(text('.ck-temp')).toBe('12°');
    expect(text('.ck-high')).toBe('↑14°');
    expect(text('.ck-low')).toBe('↓8°');
    expect(icon().getAttribute('src')).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(WEATHER.icon)}`);
  });

  it('rounds to whole degrees without a minus on zero', () => {
    const { text } = widget({ language: 'en', weather: { ...WEATHER, temp: -0.3, high: 0.4, low: -2.6 } });
    expect([text('.ck-temp'), text('.ck-high'), text('.ck-low')]).toEqual(['0°', '↑0°', '↓-3°']);
  });

  it("loads the Weather Forecast's icon file when the app sent no SVG", () => {
    expect(widget({ language: 'en', weather: { ...WEATHER, icon: null } }).icon().getAttribute('src'))
      .toBe('../weather/icons/partlycloudy_day.svg');
  });

  it('is hidden with the setting off, without a location and without data', () => {
    expect(widget({ language: 'en', weather: WEATHER }, { showWeather: false }).weather().style.display).toBe('none');
    expect(widget({ language: 'en', weather: { noLocation: true } }).weather().style.display).toBe('none');
    expect(widget({ language: 'en', weather: null }).weather().style.display).toBe('none');
    expect(widget(null).weather().style.display).toBe('none');
  });

  it('hides the high and low when they are unknown', () => {
    const { root } = widget({ language: 'en', weather: { ...WEATHER, high: null, low: null } });
    expect(root.querySelector<HTMLElement>('.ck-range')!.style.display).toBe('none');
  });

  it('keeps the weather when an answer brings none', () => {
    const { w, weather } = widget({ language: 'en', weather: WEATHER });
    w.setState({ language: 'en' });
    expect(weather().style.display).toBe('');
  });
});

describe('clockWeather()', () => {
  const hour = (t: string, temp: number | null, symbol: string | null = 'cloudy') =>
    ({ t: new Date(t).toISOString(), symbol, temp, wind: 3, windDir: 180, precip: 0 });
  const forecast = (hours: any[], icons: Record<string, string> = {}) => ({ hours, updatedAt: null, language: 'en', icons });

  it("takes the current hour and the high and low of the rest of today, in Homey's timezone", () => {
    const res = clockWeather(forecast([
      hour('2026-10-06T18:00:00+02:00', 12, 'fair_night'),
      hour('2026-10-06T20:00:00+02:00', 14),
      hour('2026-10-06T23:00:00+02:00', 8),
      hour('2026-10-07T00:00:00+02:00', 3), // tomorrow
      hour('2026-10-07T14:00:00+02:00', 20),
    ], { fair_night: '<svg/>' }), 'Europe/Copenhagen');
    expect(res).toEqual({ symbol: 'fair_night', temp: 12, high: 14, low: 8, icon: '<svg/>' });
    // In New York it's still the afternoon of the same day there, so tomorrow's Copenhagen hours count.
    expect(clockWeather(forecast([hour('2026-10-06T18:00:00+02:00', 12), hour('2026-10-07T00:00:00+02:00', 3)]), 'America/New_York'))
      .toMatchObject({ high: 12, low: 3, icon: null });
  });

  it('skips hours without a temperature', () => {
    expect(clockWeather(forecast([hour('2026-10-06T18:00:00+02:00', null), hour('2026-10-06T19:00:00+02:00', 9)]), 'Europe/Copenhagen'))
      .toMatchObject({ temp: null, high: 9, low: 9 });
  });

  it('passes on a missing location, and has nothing without hours', () => {
    expect(clockWeather({ ...forecast([]), noLocation: true }, 'Europe/Copenhagen')).toEqual({ noLocation: true });
    expect(clockWeather(forecast([]), 'Europe/Copenhagen')).toBeNull();
  });
});

describe('mount', () => {
  function mount(api: (method: string, path: string) => Promise<any>) {
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    document.body.append(frame);
    const Homey = { api: vi.fn(api), ready: vi.fn(), setHeight: vi.fn(), getSettings: () => ({}), on: vi.fn(), __: (k: string) => k };
    win.mountClockWidget(Homey, { root, frame });
    return { Homey, root };
  }

  it("shows the time without waiting long for the weather, which follows", async () => {
    let answer: (v: any) => void = () => {};
    const { Homey, root } = mount(() => new Promise((resolve) => { answer = resolve; })); // MET is slow
    await vi.advanceTimersByTimeAsync(1000);
    expect(Homey.ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.ck-time')!.textContent).toMatch(/40/); // 18.40 or 6:40 PM: the system's locale
    answer({ language: 'en', weather: WEATHER });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector<HTMLElement>('.ck-weather')!.style.display).not.toBe('none');
    expect(Homey.ready).toHaveBeenCalledTimes(1);
  });

  it('is shown with the weather when it comes in time', async () => {
    const { Homey } = mount(async () => ({ language: 'en', weather: WEATHER }));
    await vi.advanceTimersByTimeAsync(100);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
  });
});
