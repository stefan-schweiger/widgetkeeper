import { readFile } from 'node:fs/promises';
import type Homey from 'homey';
import ForecastCache from './forecastCache.js';
import Timings from './Timings.js';

// MET's icons, shipped with the widget. Relative to the compiled lib/ (and to lib/ in the tests).
const ICON_DIR = new URL('../widgets/weather/public/icons/', import.meta.url);

const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const DEFAULT_TTL = 30 * MINUTE; // when MET sends no usable Expires
/** A MET request that takes longer gives up (the Weather Forecast and the Clock's weather wait for it). */
const FETCH_TIMEOUT = 15e3;
const HOURS = 48; // the widget shows 36 from the current hour; the rest covers hours passing between fetches

export const FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

export type ForecastHour = {
  t: string, // ISO start of the hour (UTC)
  symbol: string | null, // MET symbol code, e.g. `partlycloudy_day` (= the icon's file name)
  temp: number | null, // °C
  wind: number | null, // m/s
  windDir: number | null, // degrees the wind comes from
  precip: number | null, // mm in this hour
};

export type Forecast = {
  hours: ForecastHour[],
  updatedAt: string | null, // when MET ran the model
  language: string,
  /**
   * The SVG of every symbol in `hours`, so the widget doesn't fetch each icon through Homey
   * (~0.4 s per request). A symbol without a file is left out; the widget falls back to its URL.
   */
  icons?: Record<string, string>,
  noLocation?: true,
};

type Cached = {
  key: string,
  body: any,
  expires: number,
  lastModified: string | null,
  fetchedAt: number,
};

/**
 * MET Norway's Locationforecast (the data behind yr.no) for the Homey's location.
 * MET's terms (https://api.met.no/doc/TermsOfService): an identifying User-Agent, at most 4 decimals,
 * no refetch before `Expires`, revalidate with `If-Modified-Since`. Fetched only while a widget asks.
 */
export default class WeatherService {

  private forecast: ForecastCache<Cached>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.forecast = new ForecastCache<Cached>(homey, {
      name: 'Weather', log, debug, fetch: (key, stale) => this.fetchForecast(key, stale),
    });
  }

  start() {
    this.forecast.start();
  }

  async stop() {
    this.forecast.stop();
  }

  async getForecast(): Promise<Forecast> {
    const language = this.homey.i18n.getLanguage();
    const loc = this.forecast.location();
    if (!loc) return { hours: [], updatedAt: null, language, noLocation: true };
    const tm = new Timings();
    const cached = await tm.time('met', () => this.forecast.get(`${loc.lat},${loc.lon}`));
    const hours = hoursFrom(cached.body, Date.now());
    const icons = await tm.time('icons', () => this.iconsFor(hours));
    this.debug(`Weather forecast: ${tm.summary()}`);
    return { hours, updatedAt: cached.body?.properties?.meta?.updated_at ?? null, language, icons };
  }

  /** Icon files are read once per app run. */
  private icons = new Map<string, Promise<string | null>>();

  private async iconsFor(hours: ForecastHour[]): Promise<Record<string, string>> {
    const symbols = [...new Set(hours.map(h => h.symbol).filter((s): s is string => !!s && /^[a-z_]+$/.test(s)))];
    const out: Record<string, string> = {};
    await Promise.all(symbols.map(async (symbol) => {
      let p = this.icons.get(symbol);
      if (!p) {
        p = readFile(new URL(`${symbol}.svg`, ICON_DIR), 'utf8').catch((err) => {
          this.log(`Weather: no icon for ${symbol}`, err);
          return null;
        });
        this.icons.set(symbol, p);
      }
      const svg = await p;
      if (svg) out[symbol] = svg;
    }));
    return out;
  }

  /** One request to MET (the key is `lat,lon`): a 304 only moves the expiry. Throws on failure (`ForecastCache` keeps the last one). */
  private async fetchForecast(key: string, stale: Cached | null): Promise<Cached> {
    const headers: Record<string, string> = {
      'User-Agent': `Widgetkeeper/${this.homey.manifest?.version ?? '0'} github.com/thomassidor/widgetkeeper`,
      Accept: 'application/json',
    };
    if (stale?.lastModified) headers['If-Modified-Since'] = stale.lastModified;
    const [lat, lon] = key.split(',');
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(FETCH_TIMEOUT) : undefined;
    const res = await fetch(`${FORECAST_URL}?lat=${lat}&lon=${lon}`, { headers, signal });
    this.forecast.lastStatus = `${res.status} at ${new Date().toISOString()}`;
    const expires = expiry(res.headers.get('expires'));
    if (res.status === 304 && stale) {
      this.debug(`Weather: not modified, next fetch after ${new Date(expires).toISOString()}`);
      return { ...stale, expires };
    }
    if (!res.ok) throw new Error(`MET forecast: HTTP ${res.status}`);
    const body: any = await res.json();
    if (!Array.isArray(body?.properties?.timeseries)) throw new Error('Unexpected forecast response');
    this.debug(`Weather: fetched, next fetch after ${new Date(expires).toISOString()}`);
    return { key, body, expires, lastModified: res.headers.get('last-modified'), fetchedAt: Date.now() };
  }

  /** For the diagnostics report. */
  describe() {
    const c = this.forecast.cached;
    return {
      location: this.forecast.location(),
      fetchedAt: c ? new Date(c.fetchedAt).toISOString() : null,
      expires: c ? new Date(c.expires).toISOString() : null,
      lastModified: c?.lastModified ?? null,
      lastStatus: this.forecast.lastStatus,
      lastError: this.forecast.lastError,
    };
  }

}

function expiry(header: string | null): number {
  const t = header ? Date.parse(header) : NaN;
  return Number.isFinite(t) && t > Date.now() ? t : Date.now() + DEFAULT_TTL;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The hourly entries from the start of the current hour on. */
export function hoursFrom(body: any, now: number): ForecastHour[] {
  const from = Math.floor(now / HOUR) * HOUR;
  const out: ForecastHour[] = [];
  for (const entry of body?.properties?.timeseries ?? []) {
    const t = Date.parse(entry?.time);
    const next = entry?.data?.next_1_hours;
    if (!(t >= from) || !next) continue;
    const d = entry.data.instant?.details ?? {};
    out.push({
      t: new Date(t).toISOString(),
      symbol: typeof next.summary?.symbol_code === 'string' ? next.summary.symbol_code : null,
      temp: num(d.air_temperature),
      wind: num(d.wind_speed),
      windDir: num(d.wind_from_direction),
      precip: num(next.details?.precipitation_amount),
    });
    if (out.length >= HOURS) break;
  }
  return out;
}
