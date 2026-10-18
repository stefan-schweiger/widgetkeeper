import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import { sharedCache } from './sharedCache.js';
import type Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
/** A tracked entry is dropped this long after the last request (open widgets re-fetch every 5 min). */
const IDLE_TIMEOUT = 10 * MINUTE;
/** How long a zones read is shared (a renamed room shows after this). */
const ZONES_MAX_AGE = MINUTE;

/** What the tracker keeps on every entry. */
export type TrackedEntry = {
  /** The tracker's key: the device id, or e.g. `<deviceId>:<capabilityId>`. */
  key: string,
  /** The device's name, from every read. */
  name: string,
  /** With `iconLog`: the device's icon (`fetchDeviceIcon()`), from every read. */
  icon?: string | null,
  /** The capability instances, destroyed with the entry. */
  instances: any[],
  lastRequested: number,
  /** `signature()` of the device when it was tracked: a re-read with another one tracks it again. */
  signature: string,
};

export type DeviceTrackerOptions<T extends TrackedEntry> = {
  homey: Homey.App['homey'],
  debug: (...args: any[]) => void,
  /** The device a key reads (default: the key itself). */
  deviceId?: (key: string) => string,
  /** What a re-read must still match, e.g. the capability ids it listens to. Another one disposes the entry and tracks it again. */
  signature: (device: any, key: string) => string,
  /** For the debug line when the signature changed, e.g. `Light capabilities`. */
  what: string,
  /** Builds the entry's own fields from the first read (`$cache` allowed). Throws when the device doesn't fit. */
  create: (device: any, api: any, tm: Timings, key: string) => Promise<Omit<T, keyof TrackedEntry>>,
  /** The capability instances that keep the entry live; also the place to log what's tracked. */
  listen: (entry: T, device: any) => any[],
  /** Updates the entry from a fresh read of a tracked device (`name` and `icon` are already). Throwing disposes it. */
  refresh?: (entry: T, device: any, api: any, tm: Timings) => Promise<void> | void,
  /** Keeps the device's icon in `icon`, fetched on every read (cached per URL); a failed fetch is logged here. */
  iconLog?: (...args: any[]) => void,
  /** How the entry reads in `Stopped tracking …`. */
  label: (entry: T) => string,
  /** Anything else to stop with the entry (timers …). */
  onDispose?: (entry: T) => void,
  /** What a failed re-read of a tracked device throws (default: the read's own error). */
  readError?: (err: unknown) => unknown,
};

/**
 * Fresh reads of a device on their way, per devices manager: every tracker re-reading one device at the same time
 * (Device Values and Sparklines on one meter, a light in Light Controls and Quick Actions) shares one `getDevice`.
 * homey-api only shares calls with `$cache: true`, which would also serve its cache once the manager is connected.
 */
const freshReads = new WeakMap<object, Map<string, Promise<any>>>();

export function readFresh(devices: any, id: string): Promise<any> {
  let reads = freshReads.get(devices);
  if (!reads) freshReads.set(devices, reads = new Map());
  let p = reads.get(id);
  if (!p) {
    const read: Promise<any> = devices.getDevice({ id, $cache: false }).finally(() => reads!.delete(id));
    reads.set(id, read);
    p = read;
  }
  return p;
}

/**
 * A read that failed because Homey was busy or slow (a timeout, `Too many requests`, a server error), not because the
 * device is gone: the entry is kept, so a crowded dashboard's load burst doesn't show devices as missing.
 */
export function isTransientError(err: unknown): boolean {
  const e = err as { statusCode?: unknown, code?: unknown, message?: unknown } | null;
  const status = Number(e?.statusCode);
  if (status === 408 || status === 429 || status >= 500) return true;
  if (typeof e?.code === 'string' && /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|UND_ERR_)/.test(e.code)) return true;
  return /timeout|timed out|too many requests/i.test(String(e?.message ?? ''));
}

/**
 * Devices tracked lazily for a widget: the first request reads the device and subscribes to its capabilities, later
 * requests re-read it (`$cache: false`, shared by concurrent re-reads), so a rename, changed capabilities or a deleted
 * device shows. A re-read that fails for a passing reason keeps the entry as it was. An entry no request has asked
 * for in 10 minutes is dropped.
 */
export default class DeviceTracker<T extends TrackedEntry> {

  private tracked = new Map<string, T>();
  private trackPromises = new Map<string, Promise<T>>();
  private tickTimer: NodeJS.Timeout | null = null;
  private disposed = new WeakSet<T>();
  /** Set by `stop()`: a track still under way then subscribes to nothing. */
  private stopped = false;

  constructor(private opts: DeviceTrackerOptions<T>) {}

  start() {
    this.stopped = false;
    this.tickTimer = this.opts.homey.setInterval(() => this.tick(), TICK);
  }

  stop() {
    this.stopped = true;
    if (this.tickTimer) this.opts.homey.clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const t of this.tracked.values()) this.dispose(t);
  }

  get(key: string): T | undefined {
    return this.tracked.get(key);
  }

  values(): IterableIterator<T> {
    return this.tracked.values();
  }

  /** Whether `t` is still the tracked entry for its key (not disposed or replaced). */
  isCurrent(t: T): boolean {
    return this.tracked.get(t.key) === t;
  }

  /**
   * The entry for `key`, marked as requested: tracked on the first request, else re-read from the device. A tracked
   * device that can't be read any more is disposed and throws; one that only failed to answer in time stays as it was.
   */
  async current(key: string, tm: Timings): Promise<T> {
    const t = await this.read(key, tm);
    t.lastRequested = Date.now();
    return t;
  }

  /**
   * One entry per key, in the order asked for, through `map`; a key that fails (a deleted device) is logged as
   * `<what> <key> unavailable:` and comes back as `{id, missing: true}` without failing the others.
   */
  each<R>(keys: string[], tm: Timings, log: (...args: any[]) => void, what: string, map: (t: T, key: string) => R | Promise<R>): Promise<(R | { id: string, missing: true })[]> {
    return Promise.all(keys.map(async (id) => {
      try {
        return await map(await this.current(id, tm), id);
      } catch (err) {
        log(`${what} ${id} unavailable:`, err);
        return { id, missing: true as const };
      }
    }));
  }

  private async read(key: string, tm: Timings): Promise<T> {
    const t = this.tracked.get(key);
    if (!t) return this.ensureTracked(key, tm);
    const api = await getAppApi(this.opts.homey);
    let device: any;
    try {
      device = await tm.time('getDevice', () => readFresh(api.devices, this.deviceId(key)));
    } catch (err) {
      if (isTransientError(err) && this.isCurrent(t)) {
        this.opts.debug(`Kept ${this.opts.label(t)} after a failed re-read:`, (err as Error)?.message ?? err);
        return t;
      }
      this.dispose(t);
      throw this.opts.readError ? this.opts.readError(err) : err;
    }
    // Another request's re-read disposed or replaced it meanwhile: use what that one left.
    if (!this.isCurrent(t)) return this.ensureTracked(key, tm);
    const signature = this.opts.signature(device, key);
    if (signature !== t.signature) {
      this.opts.debug(`${this.opts.what} of ${device.name} changed: ${t.signature || 'none'} → ${signature || 'none'}`);
      this.dispose(t);
      return this.ensureTracked(key, tm);
    }
    try {
      t.name = device.name;
      if (this.opts.iconLog) t.icon = await this.icon(api, device, tm);
      await this.opts.refresh?.(t, device, api, tm);
    } catch (err) {
      this.dispose(t);
      throw err;
    }
    return t;
  }

  private ensureTracked(key: string, tm: Timings): Promise<T> {
    const existing = this.tracked.get(key);
    if (existing) return Promise.resolve(existing);
    let p = this.trackPromises.get(key);
    if (!p) {
      p = this.track(key, tm).finally(() => this.trackPromises.delete(key));
      this.trackPromises.set(key, p);
    }
    return p;
  }

  private async track(key: string, tm: Timings): Promise<T> {
    const api = await tm.time('api', () => getAppApi(this.opts.homey));
    const device: any = await tm.time('getDevice', () => api.devices.getDevice({ id: this.deviceId(key) }));
    const [own, icon] = await Promise.all([
      this.opts.create(device, api, tm, key),
      this.opts.iconLog ? this.icon(api, device, tm) : undefined,
    ]);
    if (this.stopped) throw new Error(`Stopped before ${key} was tracked`); // nothing would ever destroy its instances
    const t = {
      ...own, key, name: device.name, ...(this.opts.iconLog ? { icon } : {}), instances: [], lastRequested: Date.now(), signature: this.opts.signature(device, key),
    } as unknown as T;
    t.instances = this.opts.listen(t, device);
    this.tracked.set(key, t);
    return t;
  }

  private icon(api: any, device: any, tm: Timings): Promise<string | null> {
    return tm.time('icon', () => fetchDeviceIcon(api, device, this.opts.iconLog!));
  }

  private deviceId(key: string) {
    return this.opts.deviceId ? this.opts.deviceId(key) : key;
  }

  private tick() {
    const now = Date.now();
    for (const t of this.tracked.values()) {
      if (now - t.lastRequested > IDLE_TIMEOUT) this.dispose(t);
    }
  }

  dispose(t: T) {
    if (this.disposed.has(t)) return; // two re-reads that failed or saw a change at once
    this.disposed.add(t);
    for (const i of t.instances) {
      try { i?.destroy(); } catch (err) { /* ignore */ }
    }
    this.opts.onDispose?.(t);
    if (this.tracked.get(t.key) === t) this.tracked.delete(t.key);
    this.opts.debug(`Stopped tracking ${this.opts.label(t)}`);
  }

}

const zoneReads = new WeakMap<object, { cache: ReturnType<typeof sharedCache<Record<string, any>>>, last: Record<string, any> }>();

/**
 * The zones, for naming a device's room, shared for a minute by every widget asking. A failed read is logged as
 * `<what> zones unavailable:` and gives the last zones read (none before the first), so rooms don't split apart.
 */
export function readZones(homey: Homey.App['homey'], tm: Timings, log: (...args: any[]) => void, what: string): Promise<Record<string, any>> {
  let reads = zoneReads.get(homey);
  if (!reads) zoneReads.set(homey, reads = { cache: sharedCache(async () => (await getAppApi(homey)).zones.getZones()), last: {} });
  const r = reads;
  return tm.time('zones', () => r.cache.get(ZONES_MAX_AGE))
    .then((zones) => { r.last = zones; return zones; })
    .catch((err: unknown) => { log(`${what} zones unavailable:`, err); return r.last; });
}

/** A zone id as `{id, name}`, or null when it's unknown. */
export function zoneRef(zones: Record<string, any>, zoneId: string | null): { id: string, name: string } | null {
  return zoneId && zones[zoneId] ? { id: zoneId, name: String(zones[zoneId].name) } : null;
}
