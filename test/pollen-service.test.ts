import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey } from './helpers/fakeHomey.js';
import PollenService, { pollenFrom, pollenUrl } from '../lib/PollenService.js';
import { pollenLevel, uvLevel } from '../lib/pollenLevels.js';

const HOUR = 3600e3;
// 15:20 in Copenhagen (CEST) on Monday 15 June 2026.
const NOW = Date.parse('2026-06-15T13:20:00Z');
// Local midnight in Copenhagen, where Open-Meteo's answer starts (timezone=Europe/Copenhagen).
const MIDNIGHT = Date.parse('2026-06-14T22:00:00Z');

const TYPES = ['alder', 'birch', 'olive', 'grass', 'mugwort', 'ragweed'];

/** Open-Meteo's answer: 4 local days of hours, each type at `pollen[type]` (a number, or a function of the hour). */
function body(pollen: Record<string, number | null | ((i: number) => number | null)> = {}, uv: (i: number) => number | null = uvCurve) {
  const n = 96;
  const time = Array.from({ length: n }, (_, i) => (MIDNIGHT + i * HOUR) / 1000);
  const hourly: Record<string, unknown[]> = { time };
  for (const type of TYPES) {
    const v = type in pollen ? pollen[type] : 0;
    hourly[`${type}_pollen`] = time.map((_, i) => (typeof v === 'function' ? v(i) : v));
  }
  hourly.uv_index = time.map((_, i) => uv(i));
  return { latitude: 55.68, longitude: 12.57, timezone: 'Europe/Copenhagen', hourly };
}

/** A day's UV: 0 at night, peaking at 13:00 local (hour 13 of each day), higher on the third day. */
function uvCurve(i: number) {
  const h = i % 24;
  const peak = Math.floor(i / 24) === 2 ? 7.2 : 6.1;
  return h < 6 || h > 20 ? 0 : Math.max(0, peak - Math.abs(h - 13) * 0.8);
}

function response(status: number, json: unknown) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => json };
}

let fetchMock: ReturnType<typeof vi.fn>;

function setup() {
  const homey = fakeHomey(fakeApi());
  const log = vi.fn();
  const service = new PollenService(homey, log);
  service.start();
  return { homey, service, log };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock = vi.fn(async () => response(200, body({ birch: 4, grass: 64 })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('levels', () => {
  it("uses Astma-Allergi Danmark's bands, with very high on top", () => {
    expect([0, 1, 29, 30, 100, 101, 1000, 1001].map(v => pollenLevel('birch', v))).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect([0, 1, 9, 10, 50, 51, 250, 251].map(v => pollenLevel('grass', v))).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(pollenLevel('alder', 30)).toBe(2);
    expect(pollenLevel('ragweed', 10)).toBe(2);
    // Rounded to whole grains: a trace isn't "low".
    expect(pollenLevel('grass', 0.4)).toBe(0);
  });

  it("uses the WHO's UV bands of the rounded index", () => {
    expect([0, 2.4, 2.5, 5.4, 6, 7.4, 8, 10.4, 10.5, 13].map(uvLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('pollenFrom', () => {
  it("makes local days with each type's mean and the UV peak", () => {
    const res = pollenFrom(body({ birch: 4, grass: i => (i % 24 < 12 ? 40 : 88), mugwort: null }), NOW, 'Europe/Copenhagen');
    expect(res.outside).toBe(false);
    expect(res.days.map(d => d.date)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18']);
    const today = res.days[0];
    expect(today.pollen.birch).toEqual({ value: 4, level: 1 });
    expect(today.pollen.grass).toEqual({ value: 64, level: 3 });
    expect(today.pollen.mugwort).toBeNull();
    expect(today.pollen.alder).toEqual({ value: 0, level: 0 });
    expect(today.uv).toEqual({ max: 6.1, level: 3, at: Date.parse('2026-06-15T11:00:00Z') });
    expect(res.days[2].uv!.max).toBe(7.2);
    // 15:00 local, the current hour.
    expect(res.uvNow).toBe(4.5);
  });

  it("finds the current hour's UV where local hours start half past a UTC hour", () => {
    // Kolkata is UTC+5:30: its local hours start at :30 UTC. 13:20 UTC is 18:50 there, in the hour from 18:00 (12:30 UTC).
    const start = Date.parse('2026-06-14T18:30:00Z'); // local midnight on the 15th
    const time = Array.from({ length: 48 }, (_, i) => (start + i * HOUR) / 1000);
    const hourly = { time, uv_index: time.map((_, i) => i / 10) };
    expect(pollenFrom({ hourly }, NOW, 'Asia/Kolkata').uvNow).toBe(1.8);
  });

  it('is outside the coverage when every pollen value is null (outside Europe)', () => {
    const nulls = Object.fromEntries(TYPES.map(t => [t, null]));
    const res = pollenFrom(body(nulls), NOW, 'Europe/Copenhagen');
    expect(res.outside).toBe(true);
    expect(res.days[0].pollen.birch).toBeNull();
    expect(res.days[0].uv!.max).toBe(6.1);
  });

  it('counts zeros as data: out of season is not outside', () => {
    const res = pollenFrom(body({}), NOW, 'Europe/Copenhagen');
    expect(res.outside).toBe(false);
    expect(res.days[0].pollen.birch).toEqual({ value: 0, level: 0 });
  });

  it('copes with an empty or odd answer', () => {
    expect(pollenFrom({}, NOW, 'Europe/Copenhagen')).toEqual({ days: [], uvNow: null, outside: true });
    expect(pollenFrom({ hourly: { time: ['x'], birch_pollen: ['y'] } }, NOW, 'Europe/Copenhagen').days).toEqual([]);
  });
});

describe('getPollen', () => {
  it('asks Open-Meteo for every type and the UV, in Homey\'s timezone, with rounded coordinates', async () => {
    const { service } = setup();
    const res = await service.getPollen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(pollenUrl({ lat: 55.676, lon: 12.568 }, 'Europe/Copenhagen'));
    expect(url).toBe('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=55.676&longitude=12.568'
      + '&hourly=alder_pollen,birch_pollen,olive_pollen,grass_pollen,mugwort_pollen,ragweed_pollen,uv_index'
      + '&timezone=Europe%2FCopenhagen&timeformat=unixtime&forecast_days=4');
    expect(init.headers['User-Agent']).toBe('Widgetkeeper/0.3.0 github.com/thomassidor/widgetkeeper');
    expect(res).toMatchObject({ language: 'en', outside: false });
    expect('days' in res && res.days[0].pollen.grass).toEqual({ value: 64, level: 3 });
  });

  it("doesn't answer a new location with a fetch for the old one still under way", async () => {
    const { service, homey } = setup();
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = () => r(response(200, body({ birch: 4 }))); }));
    const old = service.getPollen();
    await vi.advanceTimersByTimeAsync(0);
    vi.spyOn(homey.geolocation, 'getLatitude').mockReturnValue(48.137);
    const moved = service.getPollen();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('latitude=48.137');
    release();
    await old;
    await moved;
    // The old place's answer, ending last, isn't kept for the new one.
    await service.getPollen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.describe().location).toEqual({ lat: 48.137, lon: 12.568 });
  });

  it('shares one request between widgets asking at once, and caches it for an hour', async () => {
    const { service } = setup();
    await Promise.all([service.getPollen(), service.getPollen(), service.getPollen()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 59 * 60e3);
    await service.getPollen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 61 * 60e3);
    await service.getPollen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last data when a refetch fails, and waits 5 min before trying again', async () => {
    const { service, log } = setup();
    await service.getPollen();
    vi.setSystemTime(NOW + 61 * 60e3);
    fetchMock.mockResolvedValueOnce(response(503, null));
    const res = await service.getPollen();
    expect('days' in res && res.days[0].pollen.birch).toEqual({ value: 4, level: 1 });
    expect(log).toHaveBeenCalled();
    expect(service.describe().lastError).toBe('Open-Meteo air quality: HTTP 503');
    vi.setSystemTime(NOW + 64 * 60e3);
    await service.getPollen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + 67 * 60e3);
    await service.getPollen();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws when the first fetch fails', async () => {
    const { service } = setup();
    fetchMock.mockResolvedValueOnce(response(500, null));
    await expect(service.getPollen()).rejects.toThrow('HTTP 500');
    fetchMock.mockResolvedValueOnce(response(200, { error: true }));
    await expect(service.getPollen()).rejects.toThrow('Unexpected air-quality response');
  });

  it('answers noLocation without a location, and fetches nothing', async () => {
    const { service, homey } = setup();
    (homey.geolocation as any).getLatitude = () => 0;
    (homey.geolocation as any).getLongitude = () => 0;
    expect(await service.getPollen()).toEqual({ noLocation: true, language: 'en' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the forecast 10 min after the last request once it has expired, and on a location change', async () => {
    const { service, homey } = setup();
    await service.getPollen();
    vi.advanceTimersByTime(70 * 60e3);
    expect(service.describe().fetchedAt).toBeNull();

    await service.getPollen();
    const onLocation = (homey.geolocation.on as any).mock.calls.find((c: unknown[]) => c[0] === 'location')[1];
    onLocation();
    expect(service.describe().fetchedAt).toBeNull();
  });

  it('describes its state for the diagnostics', async () => {
    const { service } = setup();
    await service.getPollen();
    expect(service.describe()).toMatchObject({
      location: { lat: 55.676, lon: 12.568 },
      fetchedAt: new Date(NOW).toISOString(),
      outside: false,
      lastStatus: `200 at ${new Date(NOW).toISOString()}`,
      lastError: null,
    });
    expect(service.describe().today!.date).toBe('2026-06-15');
  });
});
