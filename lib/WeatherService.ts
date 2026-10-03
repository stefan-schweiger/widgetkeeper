import { readFile } from 'node:fs/promises';
import type Homey from 'homey';
import Timings from './Timings.js';

// MET's icons, shipped with the widget. Relative to the compiled lib/ (and to lib/ in the tests).
const ICON_DIR = new URL('../widgets/weather/public/icons/', import.meta.url);

const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;
const DEFAULT_TTL = 30 * MINUTE; // when MET sends no usable Expires
const RETRY_AFTER_ERROR = 5 * MINUTE;
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

  private cached: Cached | null = null;
  private inflight: Promise<Cached> | null = null;
  private lastRequested = 0;
  private lastStatus: string | null = null;
  private lastError: string | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private onLocation = () => {
    this.debug('Weather: Homey location changed, dropping the cached forecast');
    this.cached = null;
  };

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
    (this.homey.geolocation as any).on?.('location', this.onLocation);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    this.tickTimer = null;
    (this.homey.geolocation as any).off?.('location', this.onLocation);
    this.cached = null;
  }

  private tick() {
    if (this.cached && Date.now() - this.lastRequested > IDLE_TIMEOUT) {
      this.debug('Weather: no widget asked for 10 min, dropping the cached forecast');
      this.cached = null;
    }
  }

  /** Rounded to 3 decimals (~100 m): within MET's 4-decimal limit, and caches better on their side. */
  private location(): { lat: number, lon: number } | null {
    const lat = Number(this.homey.geolocation.getLatitude());
    const lon = Number(this.homey.geolocation.getLongitude());
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
  }

  async getForecast(): Promise<Forecast> {
    this.lastRequested = Date.now();
    const language = this.homey.i18n.getLanguage();
    const loc = this.location();
    if (!loc) return { hours: [], updatedAt: null, language, noLocation: true };
    const tm = new Timings();
    const cached = await tm.time('met', () => this.load(`${loc.lat},${loc.lon}`, loc));
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

  private load(key: string, loc: { lat: number, lon: number }): Promise<Cached> {
    const c = this.cached;
    if (c && c.key === key && Date.now() < c.expires) return Promise.resolve(c);
    if (!this.inflight) {
      this.inflight = this.fetchForecast(key, loc, c && c.key === key ? c : null)
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  private async fetchForecast(key: string, loc: { lat: number, lon: number }, stale: Cached | null): Promise<Cached> {
    const headers: Record<string, string> = {
      'User-Agent': `Widgetkeeper/${this.homey.manifest?.version ?? '0'} github.com/thomassidor/widgetkeeper`,
      Accept: 'application/json',
    };
    if (stale?.lastModified) headers['If-Modified-Since'] = stale.lastModified;
    try {
      const res = await fetch(`${FORECAST_URL}?lat=${loc.lat}&lon=${loc.lon}`, { headers });
      this.lastStatus = `${res.status} at ${new Date().toISOString()}`;
      const expires = expiry(res.headers.get('expires'));
      if (res.status === 304 && stale) {
        this.cached = { ...stale, expires };
        this.debug(`Weather: not modified, next fetch after ${new Date(expires).toISOString()}`);
      } else if (res.ok) {
        const body: any = await res.json();
        if (!Array.isArray(body?.properties?.timeseries)) throw new Error('Unexpected forecast response');
        this.cached = { key, body, expires, lastModified: res.headers.get('last-modified'), fetchedAt: Date.now() };
        this.debug(`Weather: fetched, next fetch after ${new Date(expires).toISOString()}`);
      } else {
        throw new Error(`MET forecast: HTTP ${res.status}`);
      }
      this.lastError = null;
      return this.cached;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      if (!stale) throw err;
      this.log('Weather: fetch failed, showing the previous forecast', err);
      // Don't hammer MET while it's failing.
      this.cached = { ...stale, expires: Date.now() + RETRY_AFTER_ERROR };
      return this.cached;
    }
  }

  /** For the diagnostics report. */
  describe() {
    const c = this.cached;
    return {
      location: this.location(),
      fetchedAt: c ? new Date(c.fetchedAt).toISOString() : null,
      expires: c ? new Date(c.expires).toISOString() : null,
      lastModified: c?.lastModified ?? null,
      lastStatus: this.lastStatus,
      lastError: this.lastError,
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
