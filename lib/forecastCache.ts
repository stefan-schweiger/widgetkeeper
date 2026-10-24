import type Homey from 'homey';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;
const RETRY_AFTER_ERROR = 5 * MINUTE;

/** What a forecast service keeps of one fetch: `key` names the place (and whatever else changes the answer). */
export type Fetched = { key: string, expires: number, fetchedAt: number };

/**
 * One forecast for the Homey's location from a public API (the Weather Forecast's MET, Pollen and UV's Open-Meteo),
 * shared by every widget, fetched only while a widget asks: until it `expires`, one fetch at a time per key; a failed
 * refetch keeps the previous one and tries again after 5 min; an expired one is dropped after 10 min without a request
 * (a valid one is kept, so a waking tablet is answered at once), and so is any on a location change.
 */
export default class ForecastCache<T extends Fetched> {

  cached: T | null = null;
  lastStatus: string | null = null;
  lastError: string | null = null;
  private inflight: { key: string, promise: Promise<T> } | null = null;
  /** The key last asked for: an older fetch that ends after it doesn't replace what's kept. */
  private latestKey: string | null = null;
  private lastRequested = 0;
  private tickTimer: NodeJS.Timeout | null = null;
  private onLocation = () => {
    this.opts.debug(`${this.opts.name}: Homey location changed, dropping the cached forecast`);
    this.cached = null;
  };

  constructor(
    private homey: Homey.App['homey'],
    private opts: {
      /** For the log lines (`Weather`, `Pollen`). */
      name: string,
      log: (...args: any[]) => void,
      debug: (...args: any[]) => void,
      /** Fetches anew; `stale` is the last one kept for this key (to revalidate). Throws on failure. */
      fetch: (key: string, stale: T | null) => Promise<T>,
    },
  ) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
    (this.homey.geolocation as any).on?.('location', this.onLocation);
  }

  stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    this.tickTimer = null;
    (this.homey.geolocation as any).off?.('location', this.onLocation);
    this.cached = null;
  }

  /** The Homey's location rounded to 3 decimals (~100 m: within MET's 4-decimal limit, and caches better on their side), or null while it isn't set. */
  location(): { lat: number, lon: number } | null {
    const lat = Number(this.homey.geolocation.getLatitude());
    const lon = Number(this.homey.geolocation.getLongitude());
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
  }

  /** The forecast for `key`: the one kept while it's valid, else the fetch under way for it, else a new one. */
  get(key: string): Promise<T> {
    this.lastRequested = Date.now();
    this.latestKey = key;
    const c = this.cached;
    if (c && c.key === key && Date.now() < c.expires) return Promise.resolve(c);
    if (this.inflight?.key === key) return this.inflight.promise;
    const promise = this.fetchOrStale(key, c && c.key === key ? c : null)
      .finally(() => { if (this.inflight?.promise === promise) this.inflight = null; });
    this.inflight = { key, promise };
    return promise;
  }

  private async fetchOrStale(key: string, stale: T | null): Promise<T> {
    let result: T;
    try {
      result = await this.opts.fetch(key, stale);
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      if (!stale) throw err;
      this.opts.log(`${this.opts.name}: fetch failed, showing the previous forecast`, err);
      // Don't hammer the service while it's failing.
      result = { ...stale, expires: Date.now() + RETRY_AFTER_ERROR };
    }
    if (key === this.latestKey) this.cached = result;
    return result;
  }

  /** Drops the forecast once no widget has asked for 10 min and it has expired. */
  private tick() {
    const now = Date.now();
    if (this.cached && now - this.lastRequested > IDLE_TIMEOUT && now >= this.cached.expires) {
      this.opts.debug(`${this.opts.name}: no widget asked for 10 min, dropping the expired forecast`);
      this.cached = null;
    }
  }

}
