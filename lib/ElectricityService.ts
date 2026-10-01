import type Homey from 'homey';
import { getAppApi } from './appApi.js';
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

export const LIVE_EVENT = 'electricity:live';

export type Snapshot = {
  now: number,
  deviceName: string | null,
  live: Sample[], // raw readings for the last hour, oldest first (the widget resamples)
  prices: ({ start: number, price: number | null })[], // 49 hourly slots, index 24 = current hour
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
  private priceDays = new Map<string, { at: number, hours: Map<number, number> }>();
  private currency: string | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private loggedPriceSample = false;

  constructor(private homey: Homey.App['homey'], private log: (...args: any[]) => void) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    for (const m of this.meters.values()) this.disposeMeter(m);
  }

  private getApi(): Promise<any> {
    return getAppApi(this.homey);
  }

  async getSnapshot(deviceId: string | null): Promise<Snapshot> {
    const now = Date.now();
    const hourStart = floorTo(now, HOUR);
    const firstSlot = hourStart - PRICE_PAST_HOURS * HOUR;

    const [meter, prices] = await Promise.all([
      deviceId ? this.ensureMeter(deviceId).catch(err => { this.log('Meter error', err); return null; }) : null,
      this.getPriceSlots(firstSlot).catch(err => { this.log('Price error', err); return []; }),
    ]);

    let usage: Sample[] = [];
    if (meter) {
      meter.lastRequested = now;
      usage = await this.getUsage(meter, firstSlot, now).catch(err => { this.log('Usage error', err); return []; });
    }

    return {
      now,
      deviceName: meter?.name ?? null,
      live: meter ? meter.live.slice() : [],
      prices,
      usage,
      currency: this.currency,
      language: this.homey.i18n.getLanguage(),
    };
  }

  // ---------------------------------------------------------------- live power

  private ensureMeter(deviceId: string): Promise<Meter> {
    const existing = this.meters.get(deviceId);
    if (existing) return Promise.resolve(existing);
    let p = this.meterPromises.get(deviceId);
    if (!p) {
      p = this.createMeter(deviceId).finally(() => this.meterPromises.delete(deviceId));
      this.meterPromises.set(deviceId, p);
    }
    return p;
  }

  private async createMeter(deviceId: string): Promise<Meter> {
    const api = await this.getApi();
    const device = await api.devices.getDevice({ id: deviceId });
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
      logId: await this.findPowerLog(api, deviceId),
      usage: null,
    };

    // Seed from insights (5 s resolution for `lastHour`) so the chart is full on first render.
    let history: Sample[] = [];
    try {
      history = await this.readLog(api, meter, 'lastHour');
    } catch (err) {
      this.log('Could not read live history', err);
    }
    meter.live = history.map(p => ({ t: p.t, w: Math.round(p.w) }));
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
    this.log(`Tracking live power for ${device.name} (${deviceId}), log ${meter.logId}, ${history.length} history points`);
    return meter;
  }

  /**
   * Homey logs power as `measure_power` for most devices, but as `energy_power` for some
   * (e.g. cumulative electricity meters). Log ids are `homey:device:<id>:<capability>`.
   */
  private async findPowerLog(api: any, deviceId: string): Promise<string | null> {
    const ownerUri = `homey:device:${deviceId}`;
    try {
      const logs = Object.values(await api.insights.getLogs()) as any[];
      const mine = logs.filter(l => l.ownerUri === ownerUri);
      for (const cap of ['measure_power', 'energy_power']) {
        const log = mine.find(l => l.ownerId === cap);
        if (log) return log.id;
      }
    } catch (err) {
      this.log('Could not list insights logs', err);
    }
    return null;
  }

  private async readLog(api: any, meter: Meter, resolution: string): Promise<Sample[]> {
    if (!meter.logId) return [];
    return parseInsightsEntries(await api.insights.getLogEntries({
      uri: `homey:device:${meter.deviceId}`, id: meter.logId, resolution,
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
    this.log(`Stopped tracking ${meter.name}`);
  }

  // ---------------------------------------------------------------- usage history

  private async getUsage(meter: Meter, from: number, now: number): Promise<Sample[]> {
    if (!meter.usage || now - meter.usage.at > USAGE_TTL) {
      const data = await this.readLog(await this.getApi(), meter, 'last24Hours');
      meter.usage = { at: now, data };
    }
    const count = Math.floor((now - from) / USAGE_STEP) + 1;
    const avg = bucketAverage(meter.usage.data, from, USAGE_STEP, count);
    const out: Sample[] = [];
    avg.forEach((w, i) => { if (w != null) out.push({ t: from + i * USAGE_STEP, w: Math.round(w) }); });
    return out;
  }

  // ---------------------------------------------------------------- prices

  private async getPriceSlots(firstSlot: number): Promise<Snapshot['prices']> {
    const count = PRICE_PAST_HOURS + 1 + PRICE_FUTURE_HOURS;
    const lastSlot = firstSlot + (count - 1) * HOUR;
    const days = new Set<string>();
    for (let t = firstSlot; t <= lastSlot; t += HOUR) days.add(this.localDate(t));

    const hours = new Map<number, number>();
    for (const day of days) {
      for (const [h, p] of await this.getPriceDay(day)) hours.set(h, p);
    }

    if (this.currency == null) {
      try {
        const api = await this.getApi();
        const c = await api.energy.getCurrency();
        this.currency = typeof c === 'string' ? c : (c?.currency ?? c?.symbol ?? null);
      } catch (err) {
        this.log('Could not read currency', err);
      }
    }

    return Array.from({ length: count }, (_, i) => {
      const start = firstSlot + i * HOUR;
      return { start, price: hours.get(start) ?? null };
    });
  }

  private async getPriceDay(day: string): Promise<Map<number, number>> {
    const now = Date.now();
    const cached = this.priceDays.get(day);
    // Complete days are cached for good; empty/partial days (tomorrow before publication) are
    // retried every 15 minutes.
    if (cached && (cached.hours.size >= 23 || now - cached.at < 15 * MINUTE)) return cached.hours;

    const api = await this.getApi();
    const res = await api.energy.fetchDynamicElectricityPrices({ date: day });
    if (!this.loggedPriceSample) {
      this.loggedPriceSample = true;
      this.log(`Price response sample for ${day}:`, JSON.stringify(res)?.slice(0, 600));
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
