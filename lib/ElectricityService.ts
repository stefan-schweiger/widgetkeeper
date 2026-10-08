import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import Timings from './Timings.js';
import {
  HOUR, MINUTE, SECOND, Sample,
  bucketAverage, floorTo, hourlyPrices, parseInsightsEntries, parsePriceResponse,
} from './series.js';

const LIVE_KEEP = HOUR + 2 * MINUTE; // raw readings kept (the widget's longest live window is 60 min)
const LIVE_PUSH_THROTTLE = SECOND;
const TICK = MINUTE;
const USAGE_STEP = 5 * MINUTE;
const USAGE_TTL = 5 * MINUTE;
const PRICE_PAST_HOURS = 24;
const PRICE_FUTURE_HOURS = 24; // the chart shows 12; the lowest-price footer can look 24 ahead
const IDLE_TIMEOUT = 10 * MINUTE;
const POWER_LOGS = ['measure_power', 'energy_power']; // in order of preference
const PRICE_TYPE_TTL = 5 * MINUTE; // a change in Homey's Energy settings shows within this

export const LIVE_EVENT = 'electricity:live';

export type Snapshot = {
  now: number,
  deviceName: string | null,
  meterError: string | null, // why the selected meter could not be read
  priceError: string | null, // why the current hour's price could not be read (null when it's simply not set up)
  live: Sample[], // raw readings for the last hour, oldest first (the widget resamples)
  prices: ({ start: number, price: number | null })[], // 49 hourly slots, index 24 = current hour
  fixedPrice: number | null, // Homey's fixed price per kWh, when Energy is set to a fixed price (every slot has it)
  usage: Sample[], // 5-min averages from the first price slot up to now
  currency: string | null,
  language: string, // Homey UI language, for weekday names
};

type Meter = {
  deviceId: string,
  name: string,
  capability: any,
  live: Sample[],
  current: number | null,
  lastPush: number,
  pending: Sample | null, // latest reading not yet pushed (throttled)
  pushTimer: NodeJS.Timeout | null,
  lastRequested: number,
  logId: string | null, // insights log with the power history (measure_power or energy_power)
  usage: { at: number, data: Sample[] } | null,
};

export default class ElectricityService {

  private meters = new Map<string, Meter>();
  private meterPromises = new Map<string, Promise<Meter>>();
  private logIds = new Map<string, string>(); // the power log that worked, per device; kept when a meter is dropped
  private priceDays = new Map<string, { at: number, hours: Map<number, number> }>();
  private pricePending = new Map<string, Promise<Map<number, number>>>();
  private currency: string | null = null;
  private currencyPending: Promise<void> | null = null;
  private priceType: { at: number, fixed: number | null } | null = null;
  private priceTypePending: Promise<number | null> | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private loggedPriceSample = false;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    for (const m of this.meters.values()) this.disposeMeter(m);
  }

  /** Connects to Homey's API and fetches the prices at app start, so the first widget doesn't wait for them. */
  warmUp() {
    const firstSlot = floorTo(Date.now(), HOUR) - PRICE_PAST_HOURS * HOUR;
    const tm = new Timings();
    this.getFixedPrice().then(fixed => this.getPriceSlots(firstSlot, tm, fixed))
      .then(() => this.debug(`Prices warmed up: ${tm.summary()}`))
      .catch(err => this.log('Warm-up failed', err));
  }

  private getApi(): Promise<any> {
    return getAppApi(this.homey);
  }

  async getSnapshot(deviceId: string | null): Promise<Snapshot> {
    const now = Date.now();
    const hourStart = floorTo(now, HOUR);
    const firstSlot = hourStart - PRICE_PAST_HOURS * HOUR;
    const tm = new Timings();

    let meterError: string | null = null;
    let priceError: string | null = null;
    let fixedPrice: number | null = null;
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
    const [meter, prices] = await Promise.all([
      deviceId ? tm.time('meter', () => this.ensureMeter(deviceId, tm)).catch(err => {
        this.log('Meter error', err);
        meterError = message(err);
        return null;
      }) : null,
      tm.time('prices', async () => {
        fixedPrice = await this.getFixedPrice();
        return this.getPriceSlots(firstSlot, tm, fixedPrice, (day, err) => {
          if (day === this.localDate(hourStart)) priceError = message(err);
        });
      }).catch(err => { this.log('Price error', err); priceError = message(err); return []; }),
    ]);

    let usage: Sample[] = [];
    if (meter) {
      meter.lastRequested = now;
      usage = await tm.time('usage', () => this.getUsage(meter, firstSlot, now)).catch(err => { this.log('Usage error', err); return []; });
    }

    this.debug(`Snapshot ${meter?.name ?? deviceId ?? '-'}: ${tm.summary()}`);
    return {
      now,
      deviceName: meter?.name ?? null,
      meterError,
      priceError,
      live: meter ? meter.live.slice() : [],
      prices,
      fixedPrice,
      usage,
      currency: this.currency,
      language: this.homey.i18n.getLanguage(),
    };
  }

  // ---------------------------------------------------------------- live power

  private ensureMeter(deviceId: string, tm: Timings): Promise<Meter> {
    const existing = this.meters.get(deviceId);
    if (existing) return Promise.resolve(existing);
    let p = this.meterPromises.get(deviceId);
    if (!p) {
      p = this.createMeter(deviceId, tm).finally(() => this.meterPromises.delete(deviceId));
      this.meterPromises.set(deviceId, p);
    }
    return p;
  }

  private async createMeter(deviceId: string, tm: Timings): Promise<Meter> {
    const api = await tm.time('api', () => this.getApi());
    // The power history doesn't need the device, so both are requested at once.
    const [device, logs] = await Promise.all([
      tm.time('getDevice', () => api.devices.getDevice({ id: deviceId })) as Promise<any>,
      tm.time('history', () => this.readPowerLogs(api, deviceId)),
    ]);
    if (!device.capabilities?.includes('measure_power')) {
      throw new Error(`Device ${device.name} has no measure_power capability`);
    }
    const current = device.capabilitiesObj?.measure_power?.value ?? null;
    const meter: Meter = {
      deviceId,
      name: device.name,
      capability: null,
      live: [],
      current: typeof current === 'number' ? current : null,
      lastPush: 0,
      pending: null,
      pushTimer: null,
      lastRequested: Date.now(),
      logId: logs.logId,
      usage: logs.last24Hours ? { at: Date.now(), data: logs.last24Hours } : null,
    };

    // Seeded from insights (5 s resolution for `lastHour`) so the chart is full on first render.
    meter.live = logs.lastHour.map(p => ({ t: p.t, w: Math.round(p.w) }));
    if (meter.current != null) meter.live.push({ t: Date.now(), w: Math.round(meter.current) });

    meter.capability = device.makeCapabilityInstance('measure_power', (value: number) => {
      if (typeof value !== 'number') return;
      meter.current = value;
      const sample = { t: Date.now(), w: Math.round(value) };
      meter.live.push(sample);
      meter.pending = sample;
      this.schedulePush(meter);
    });

    this.meters.set(deviceId, meter);
    this.debug(`Tracking live power for ${device.name} (${deviceId}), log ${meter.logId}, ${logs.lastHour.length} history points`);
    return meter;
  }

  /**
   * The device's power log for the last hour (5 s steps; seeds the live chart) and the last 24 h
   * (5 min steps; usage). Homey logs power as `measure_power` for most devices, but as
   * `energy_power` for some (e.g. cumulative electricity meters). Listing every insights log to find
   * out is slow, so this reads them in turn (a missing log throws) and remembers the one that
   * worked. Log ids are `homey:device:<id>:<capability>`.
   */
  private async readPowerLogs(api: any, deviceId: string): Promise<{
    logId: string | null, lastHour: Sample[], last24Hours: Sample[] | null,
  }> {
    const known = this.logIds.get(deviceId);
    const candidates = known ? [known] : POWER_LOGS.map(cap => `homey:device:${deviceId}:${cap}`);
    let error: unknown;
    for (const logId of candidates) {
      try {
        const [lastHour, last24Hours] = await Promise.all([
          this.readLog(api, deviceId, logId, 'lastHour'),
          this.readLog(api, deviceId, logId, 'last24Hours'),
        ]);
        this.logIds.set(deviceId, logId);
        return { logId, lastHour, last24Hours };
      } catch (err) {
        error = err;
      }
    }
    this.log('Could not read the power history', error);
    // A known log that failed is kept, so the usage history is retried with it later.
    return { logId: known ?? null, lastHour: [], last24Hours: null };
  }

  private async readLog(api: any, deviceId: string, logId: string, resolution: string): Promise<Sample[]> {
    return parseInsightsEntries(await api.insights.getLogEntries({
      uri: `homey:device:${deviceId}`, id: logId, resolution,
    }));
  }

  /** Trims old readings and drops meters no open widget has asked for in IDLE_TIMEOUT. */
  private tick() {
    const now = Date.now();
    for (const meter of this.meters.values()) {
      // Open widgets re-request a snapshot every 5 minutes, which keeps `lastRequested` fresh.
      if (now - meter.lastRequested > IDLE_TIMEOUT) {
        this.disposeMeter(meter);
        continue;
      }
      // Keep one reading older than the window so the line starts at the left edge.
      const cutoff = now - LIVE_KEEP;
      let drop = 0;
      while (drop < meter.live.length - 1 && meter.live[drop + 1].t < cutoff) drop++;
      if (drop) meter.live.splice(0, drop);
    }
  }

  /** Pushes readings as they arrive, at most one per LIVE_PUSH_THROTTLE (the latest wins). */
  private schedulePush(meter: Meter) {
    if (meter.pushTimer) return;
    const wait = Math.max(0, meter.lastPush + LIVE_PUSH_THROTTLE - Date.now());
    meter.pushTimer = this.homey.setTimeout(() => {
      meter.pushTimer = null;
      const sample = meter.pending;
      if (!sample) return;
      meter.pending = null;
      meter.lastPush = Date.now();
      this.homey.api.realtime(LIVE_EVENT, { deviceId: meter.deviceId, t: sample.t, w: sample.w });
    }, wait);
  }

  private disposeMeter(meter: Meter) {
    try { meter.capability?.destroy(); } catch (err) { /* ignore */ }
    if (meter.pushTimer) this.homey.clearTimeout(meter.pushTimer);
    this.meters.delete(meter.deviceId);
    this.debug(`Stopped tracking ${meter.name}`);
  }

  // ---------------------------------------------------------------- usage history

  private async getUsage(meter: Meter, from: number, now: number): Promise<Sample[]> {
    if (!meter.usage || now - meter.usage.at > USAGE_TTL) {
      const api = await this.getApi();
      let data: Sample[];
      if (meter.logId) {
        data = await this.readLog(api, meter.deviceId, meter.logId, 'last24Hours');
      } else {
        // No power log was found when the meter was tracked (it may have been a passing error, such
        // as `Too many requests.` or the API still starting), so look for it again.
        const logs = await this.readPowerLogs(api, meter.deviceId);
        meter.logId = logs.logId;
        data = logs.last24Hours ?? [];
        // Fill the live chart's history before the first reading this meter got.
        const first = meter.live[0]?.t ?? Infinity;
        meter.live.unshift(...logs.lastHour.filter(p => p.t < first).map(p => ({ t: p.t, w: Math.round(p.w) })));
        if (meter.logId) this.debug(`Found the power log of ${meter.name}: ${meter.logId}`);
      }
      meter.usage = { at: now, data };
    }
    const count = Math.floor((now - from) / USAGE_STEP) + 1;
    const avg = bucketAverage(meter.usage.data, from, USAGE_STEP, count);
    const out: Sample[] = [];
    avg.forEach((w, i) => { if (w != null) out.push({ t: from + i * USAGE_STEP, w: Math.round(w) }); });
    return out;
  }

  // ---------------------------------------------------------------- prices

  /**
   * Homey's fixed price per kWh when Energy is set to a fixed price, else null (dynamic, or the type
   * can't be read). Homey keeps one fixed price, with no peak/off-peak: its app says to enter an
   * average. Spot prices are still returned in fixed mode, so the type has to be checked.
   */
  private getFixedPrice(): Promise<number | null> {
    if (this.priceType && Date.now() - this.priceType.at < PRICE_TYPE_TTL) return Promise.resolve(this.priceType.fixed);
    this.priceTypePending ??= (async () => {
      let fixed: number | null = null;
      try {
        const api = await this.getApi();
        if (await api.energy.getElectricityPriceType() === 'fixed') {
          fixed = parseFixedPrice(await api.energy.getOptionElectricityPriceFixed());
          if (fixed == null) this.log('Fixed electricity price set, but no price found');
        }
      } catch (err) {
        this.log('Could not read the electricity price type', err);
      }
      if (fixed !== this.priceType?.fixed) this.debug(`Electricity price: ${fixed == null ? 'dynamic' : `fixed ${fixed}`}`);
      this.priceType = { at: Date.now(), fixed };
      return fixed;
    })().finally(() => { this.priceTypePending = null; });
    return this.priceTypePending;
  }

  /** Price type and fixed price, for the diagnostics report. */
  async describe() {
    const fixedPrice = await this.getFixedPrice();
    return { priceType: fixedPrice == null ? 'dynamic' : 'fixed', fixedPrice, currency: this.currency };
  }

  private async getPriceSlots(firstSlot: number, tm: Timings, fixedPrice: number | null = null,
    onDayError?: (day: string, err: unknown) => void): Promise<Snapshot['prices']> {
    const count = PRICE_PAST_HOURS + 1 + PRICE_FUTURE_HOURS;
    if (fixedPrice != null) {
      if (this.currency == null) await tm.time('currency', () => this.loadCurrency());
      return Array.from({ length: count }, (_, i) => ({ start: firstSlot + i * HOUR, price: fixedPrice }));
    }
    const lastSlot = firstSlot + (count - 1) * HOUR;
    const days = new Set<string>();
    for (let t = firstSlot; t <= lastSlot; t += HOUR) days.add(this.localDate(t));

    // A day that fails (e.g. tomorrow before publication) leaves its slots empty, not the others.
    const [dayHours] = await Promise.all([
      Promise.all([...days].map(day => tm.time(day, () => this.getPriceDay(day)).catch(err => {
        this.log(`Price error for ${day}`, err);
        onDayError?.(day, err);
        return null;
      }))),
      this.currency == null ? tm.time('currency', () => this.loadCurrency()) : null,
    ]);
    const hours = new Map<number, number>();
    for (const day of dayHours) {
      for (const [h, p] of day ?? []) hours.set(h, p);
    }

    return Array.from({ length: count }, (_, i) => {
      const start = firstSlot + i * HOUR;
      return { start, price: hours.get(start) ?? null };
    });
  }

  private loadCurrency(): Promise<void> {
    this.currencyPending ??= (async () => {
      try {
        const c = await (await this.getApi()).energy.getCurrency();
        this.currency = typeof c === 'string' ? c : (c?.currency ?? c?.symbol ?? null);
      } catch (err) {
        this.log('Could not read currency', err);
      } finally {
        this.currencyPending = null;
      }
    })();
    return this.currencyPending;
  }

  /** One day's hourly prices. Concurrent requests for a day (warm-up, several widgets) share one fetch. */
  private getPriceDay(day: string): Promise<Map<number, number>> {
    const cached = this.priceDays.get(day);
    // Complete days are cached for good; empty/partial days (tomorrow before publication) are
    // retried every 15 minutes.
    if (cached && (cached.hours.size >= 23 || Date.now() - cached.at < 15 * MINUTE)) return Promise.resolve(cached.hours);
    let p = this.pricePending.get(day);
    if (!p) {
      p = this.fetchPriceDay(day).finally(() => this.pricePending.delete(day));
      this.pricePending.set(day, p);
    }
    return p;
  }

  private async fetchPriceDay(day: string): Promise<Map<number, number>> {
    const now = Date.now();
    const api = await this.getApi();
    const res = await api.energy.fetchDynamicElectricityPrices({ date: day });
    if (!this.loggedPriceSample) {
      this.loggedPriceSample = true;
      this.debug(`Price response sample for ${day}:`, JSON.stringify(res)?.slice(0, 600));
    }
    const hours = hourlyPrices(parsePriceResponse(res));
    this.priceDays.set(day, { at: now, hours });
    for (const key of this.priceDays.keys()) {
      if (key < this.localDate(now - 3 * 24 * HOUR)) this.priceDays.delete(key);
    }
    return hours;
  }

  /** YYYY-MM-DD in Homey's timezone. */
  private localDate(t: number): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.homey.clock.getTimezone(),
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t));
  }

}

/** `{value: {costs: {user_fixed_base: {value: 2}}}}` (verified 2026-10-07) → 2. */
export function parseFixedPrice(res: any): number | null {
  const v = res?.value?.costs?.user_fixed_base?.value ?? res?.costs?.user_fixed_base?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
