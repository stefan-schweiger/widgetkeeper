import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey } from './helpers/fakeHomey.js';
import WeatherService, { FORECAST_URL, hoursFrom } from '../lib/WeatherService.js';

const NOW = Date.parse('2026-10-03T13:20:00Z');
const HOUR = 3600e3;

/** A compact-style body: hourly entries from `start` (hourly for 60 h, then 6-hourly like MET). */
function body(start = Date.parse('2026-10-03T12:00:00Z'), tempOffset = 0) {
  const timeseries = [];
  for (let i = 0; i < 70; i++) {
    const hourly = i < 60;
    const t = start + (hourly ? i : 60 + (i - 60) * 6) * HOUR;
    timeseries.push({
      time: new Date(t).toISOString().replace('.000', ''),
      data: {
        instant: { details: { air_temperature: 10 + i / 10 + tempOffset, wind_speed: 3.4, wind_from_direction: 200 } },
        ...(hourly ? { next_1_hours: { summary: { symbol_code: i % 2 ? 'rain' : 'cloudy' }, details: { precipitation_amount: i % 2 ? 0.4 : 0 } } } : {}),
        next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 1 } },
      },
    });
  }
  return { properties: { meta: { updated_at: '2026-10-03T12:29:58Z' }, timeseries } };
}

function response(status: number, json: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => json,
  };
}

const EXPIRES_IN = (ms: number) => new Date(Date.now() + ms).toUTCString();

let fetchMock: ReturnType<typeof vi.fn>;

function setup() {
  const homey = fakeHomey(fakeApi());
  const log = vi.fn();
  const service = new WeatherService(homey, log);
  service.start();
  return { homey, service, log };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock = vi.fn(async () => response(200, body(), { expires: EXPIRES_IN(30 * 60e3), 'last-modified': 'Sat, 03 Oct 2026 13:00:59 GMT' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('hoursFrom', () => {
  it('starts at the current hour and only takes hourly entries', () => {
    const hours = hoursFrom(body(), NOW);
    expect(hours[0].t).toBe('2026-10-03T13:00:00.000Z');
    expect(hours).toHaveLength(48);
    expect(hours[0]).toEqual({ t: '2026-10-03T13:00:00.000Z', symbol: 'rain', temp: 10.1, wind: 3.4, windDir: 200, precip: 0.4 });
  });

  it('stops where MET switches to 6-hour steps', () => {
    const hours = hoursFrom(body(), NOW + 30 * HOUR);
    expect(hours.length).toBeLessThan(48);
    expect(hours.every((h, i) => i === 0 || Date.parse(h.t) - Date.parse(hours[i - 1].t) === HOUR)).toBe(true);
  });
});

describe('getForecast', () => {
  it('fetches with rounded coordinates and an identifying User-Agent', async () => {
    const { service } = setup();
    const forecast = await service.getForecast();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${FORECAST_URL}?lat=55.676&lon=12.568`);
    expect(init.headers['User-Agent']).toBe('Widgetkeeper/0.3.0 github.com/thomassidor/widgetkeeper');
    expect(forecast.hours[0].t).toBe('2026-10-03T13:00:00.000Z');
    expect(forecast.updatedAt).toBe('2026-10-03T12:29:58Z');
    expect(forecast.language).toBe('en');
  });

  it('sends the SVG of each symbol in use, read from the widget icon files', async () => {
    const { service } = setup();
    const forecast = await service.getForecast();
    expect(Object.keys(forecast.icons!).sort()).toEqual(['cloudy', 'rain']);
    expect(forecast.icons!.rain).toContain('<svg');
  });

  it('serves the cache until Expires, then revalidates with If-Modified-Since', async () => {
    const { service } = setup();
    await service.getForecast();
    vi.setSystemTime(NOW + 20 * 60e3);
    await service.getForecast();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + 31 * 60e3);
    fetchMock.mockResolvedValueOnce(response(304, null, { expires: EXPIRES_IN(30 * 60e3) }));
    const forecast = await service.getForecast();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers['If-Modified-Since']).toBe('Sat, 03 Oct 2026 13:00:59 GMT');
    expect(forecast.hours[0].temp).toBe(10.1);

    // The 304 moved the expiry on.
    vi.setSystemTime(NOW + 50 * 60e3);
    await service.getForecast();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch between concurrent requests', async () => {
    const { service } = setup();
    await Promise.all([service.getForecast(), service.getForecast(), service.getForecast()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the previous forecast when a refetch fails, and waits before retrying', async () => {
    const { service, log } = setup();
    await service.getForecast();
    vi.setSystemTime(NOW + 31 * 60e3);
    fetchMock.mockResolvedValueOnce(response(503, null));
    const forecast = await service.getForecast();
    expect(forecast.hours.length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalled();
    await service.getForecast();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.describe().lastError).toBe('MET forecast: HTTP 503');
  });

  it('throws when the first fetch fails', async () => {
    const { service } = setup();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(service.getForecast()).rejects.toThrow('offline');
  });

  it('reports a missing location instead of fetching', async () => {
    const { homey, service } = setup();
    homey.geolocation.getLatitude = () => 0;
    homey.geolocation.getLongitude = () => 0;
    const forecast = await service.getForecast();
    expect(forecast.noLocation).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches when the Homey moves', async () => {
    const { homey, service } = setup();
    await service.getForecast();
    homey.geolocation.getLatitude = () => 59.9139;
    homey.geolocation.getLongitude = () => 10.7522;
    await service.getForecast();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${FORECAST_URL}?lat=59.914&lon=10.752`);
    // No If-Modified-Since for a different location.
    expect(fetchMock.mock.calls[1][1].headers['If-Modified-Since']).toBeUndefined();
  });

  it('drops the cache on the location event', async () => {
    const { homey, service } = setup();
    await service.getForecast();
    const onLocation = homey.geolocation.on.mock.calls.find(([e]: [string]) => e === 'location')[1];
    onLocation();
    await service.getForecast();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops the cache after 10 min without a request', async () => {
    const { service } = setup();
    await service.getForecast();
    await vi.advanceTimersByTimeAsync(11 * 60e3);
    expect(service.describe().fetchedAt).toBeNull();
  });
});
