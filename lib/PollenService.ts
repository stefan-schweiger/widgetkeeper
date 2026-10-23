import type Homey from 'homey';
import ForecastCache from './forecastCache.js';
import { localHour } from './heatmap.js';
import { POLLEN_TYPES, pollenLevel, uvLevel, type PollenType } from './pollenLevels.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
/** CAMS' pollen forecast is made once a day and UV changes by the hour, so an hour old is fresh enough. */
const TTL = 60 * MINUTE;
const FETCH_TIMEOUT = 15e3;
/** Today and the next three: Open-Meteo forecasts pollen four days ahead. */
const DAYS = 4;

export const POLLEN_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export type PollenDay = {
  date: string, // YYYY-MM-DD in the Homey's timezone
  /** Each type's mean of the day's hours (grains/m³) and its level (0 none … 4 very high); null without data. */
  pollen: Record<PollenType, { value: number, level: number } | null>,
  /** The day's highest UV index, its level (1 low … 5 extreme) and when (the hour's start, ms). */
  uv: { max: number, level: number, at: number } | null,
};

export type Pollen = {
  days: PollenDay[],
  uvNow: number | null,
  /** No pollen at all in the answer: Open-Meteo's pollen (CAMS Europe) doesn't cover the Homey's location. */
  outside: boolean,
  language: string,
} | { noLocation: true, language: string };

type Cached = { key: string, body: any, expires: number, fetchedAt: number };

/**
 * Pollen and UV for the Homey's location from Open-Meteo's air-quality API (CAMS Europe's pollen forecast; keyless,
 * CC BY 4.0). One fetch an hour at most, shared by every widget, and only while a widget asks.
 */
export default class PollenService {

  private forecast: ForecastCache<Cached>;

  constructor(
    private homey: Homey.App['homey'],
    log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.forecast = new ForecastCache<Cached>(homey, {
      name: 'Pollen', log, debug, fetch: key => this.fetchPollen(key),
    });
  }

  start() {
    this.forecast.start();
  }

  async stop() {
    this.forecast.stop();
  }

  private timeZone(): string {
    return this.homey.clock.getTimezone() || 'UTC';
  }

  async getPollen(): Promise<Pollen> {
    const language = this.homey.i18n.getLanguage();
    const loc = this.forecast.location();
    if (!loc) return { noLocation: true, language };
    const timeZone = this.timeZone();
    const tm = new Timings();
    const cached = await tm.time('open-meteo', () => this.forecast.get(`${loc.lat},${loc.lon},${timeZone}`));
    this.debug(`Pollen: ${tm.summary()}`);
    return { ...pollenFrom(cached.body, Date.now(), timeZone), language };
  }

  /** One request to Open-Meteo (the key is `lat,lon,timeZone`). Throws on failure (`ForecastCache` keeps the last one). */
  private async fetchPollen(key: string): Promise<Cached> {
    const [lat, lon, timeZone] = key.split(',');
    const headers = {
      'User-Agent': `Widgetkeeper/${this.homey.manifest?.version ?? '0'} github.com/thomassidor/widgetkeeper`,
      Accept: 'application/json',
    };
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(FETCH_TIMEOUT) : undefined;
    const res = await fetch(pollenUrl({ lat: Number(lat), lon: Number(lon) }, timeZone), { headers, signal });
    this.forecast.lastStatus = `${res.status} at ${new Date().toISOString()}`;
    if (!res.ok) throw new Error(`Open-Meteo air quality: HTTP ${res.status}`);
    const body: any = await res.json();
    if (!Array.isArray(body?.hourly?.time)) throw new Error('Unexpected air-quality response');
    const expires = Date.now() + TTL;
    this.debug(`Pollen: fetched, next fetch after ${new Date(expires).toISOString()}`);
    return { key, body, expires, fetchedAt: Date.now() };
  }

  /** For the diagnostics report. */
  describe() {
    const c = this.forecast.cached;
    const now = Date.now();
    const today = c ? pollenFrom(c.body, now, this.timeZone()) : null;
    return {
      location: this.forecast.location(),
      fetchedAt: c ? new Date(c.fetchedAt).toISOString() : null,
      expires: c ? new Date(c.expires).toISOString() : null,
      outside: today ? today.outside : null,
      today: today?.days[0] ?? null,
      lastStatus: this.forecast.lastStatus,
      lastError: this.forecast.lastError,
    };
  }

}

/** Every type's hourly pollen and the UV index, as Unix times, for today and the next three local days. */
export function pollenUrl(loc: { lat: number, lon: number }, timeZone: string): string {
  const hourly = [...POLLEN_TYPES.map(t => `${t}_pollen`), 'uv_index'].join(',');
  return `${POLLEN_URL}?latitude=${loc.lat}&longitude=${loc.lon}&hourly=${hourly}`
    + `&timezone=${encodeURIComponent(timeZone)}&timeformat=unixtime&forecast_days=${DAYS}`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Open-Meteo's hours as local days (the Homey's timezone): each type's daily mean and level, and the UV peak. */
export function pollenFrom(body: any, now: number, timeZone: string): Omit<Extract<Pollen, { days: unknown }>, 'language'> {
  const hourly = body?.hourly ?? {};
  const times: unknown[] = Array.isArray(hourly.time) ? hourly.time : [];
  const series = (name: string): unknown[] => (Array.isArray(hourly[name]) ? hourly[name] : []);
  const pollen = Object.fromEntries(POLLEN_TYPES.map(t => [t, series(`${t}_pollen`)])) as Record<PollenType, unknown[]>;
  const uv = series('uv_index');
  const today = localHour(now, timeZone).date;

  type Acc = { sums: Record<PollenType, { sum: number, n: number }>, uv: { max: number, at: number } | null };
  const byDate = new Map<string, Acc>();
  let anyPollen = false;
  let uvNow: number | null = null;
  times.forEach((raw, i) => {
    const t = Number(raw) * 1000;
    if (!Number.isFinite(t)) return;
    const { date } = localHour(t, timeZone);
    if (date < today) return;
    let acc = byDate.get(date);
    if (!acc) {
      acc = { sums: Object.fromEntries(POLLEN_TYPES.map(p => [p, { sum: 0, n: 0 }])) as Acc['sums'], uv: null };
      byDate.set(date, acc);
    }
    for (const type of POLLEN_TYPES) {
      const v = num(pollen[type][i]);
      if (v == null) continue;
      anyPollen = true;
      acc.sums[type].sum += Math.max(0, v);
      acc.sums[type].n += 1;
    }
    const u = num(uv[i]);
    if (u != null) {
      if (!acc.uv || u > acc.uv.max) acc.uv = { max: u, at: t };
      // The hour holding `now`: Open-Meteo's start on local hours, half past a UTC hour in India or Adelaide.
      if (t <= now && now < t + 3600e3) uvNow = u;
    }
  });

  const days: PollenDay[] = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, DAYS).map(([date, acc]) => ({
    date,
    pollen: Object.fromEntries(POLLEN_TYPES.map((type) => {
      const { sum, n } = acc.sums[type];
      if (!n) return [type, null];
      const value = sum / n;
      return [type, { value: Math.round(value * 10) / 10, level: pollenLevel(type, value) }];
    })) as PollenDay['pollen'],
    uv: acc.uv ? { max: Math.round(acc.uv.max * 10) / 10, level: uvLevel(acc.uv.max), at: acc.uv.at } : null,
  }));
  return { days, uvNow: uvNow == null ? null : Math.round((uvNow as number) * 10) / 10, outside: !anyPollen };
}
