import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;

export const LOCKS_STATE_EVENT = 'locks:state';

/**
 * The capabilities the Locks widget reads, and the value of each that counts as secure: a lock that's
 * locked, a contact sensor that's closed, a garage door that's closed.
 */
export const LOCK_CAPS = { locked: true, alarm_contact: false, garagedoor_closed: true } as const;
export type LockCapId = keyof typeof LOCK_CAPS;
/** Only these can be set from the widget (a contact sensor can't). */
export const SETTABLE_LOCK_CAPS: LockCapId[] = ['locked', 'garagedoor_closed'];

export type LockCap = { value: unknown, setable: boolean, lastUpdated: number | null };

export type LockDevice =
  | { id: string, name: string, icon: string | null, caps: Partial<Record<LockCapId, LockCap>> }
  | { id: string, missing: true };

type Tracked = {
  deviceId: string,
  name: string,
  icon: string | null,
  caps: Partial<Record<LockCapId, LockCap>>,
  instances: any[],
  lastRequested: number,
};

/** The lock capabilities the device has, in `LOCK_CAPS` order. */
export function lockCaps(device: any): LockCapId[] {
  const caps = device?.capabilitiesObj || {};
  return (Object.keys(LOCK_CAPS) as LockCapId[]).filter(id => caps[id]);
}

/** Homey's `lastUpdated` is an ISO string (checked 2026-10-08); ms, or null. */
function updatedAt(v: unknown): number | null {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function readCaps(device: any): Partial<Record<LockCapId, LockCap>> {
  const out: Partial<Record<LockCapId, LockCap>> = {};
  for (const id of lockCaps(device)) {
    const c = device.capabilitiesObj[id];
    out[id] = {
      value: c.value ?? null,
      setable: SETTABLE_LOCK_CAPS.includes(id) && c.setable !== false,
      lastUpdated: updatedAt(c.lastUpdated),
    };
  }
  return out;
}

/** The Locks widget: locks, doors and garage doors, and whether they're all locked and closed. */
export default class LockService {

  private tracked = new Map<string, Tracked>();
  private trackPromises = new Map<string, Promise<Tracked>>();
  private tickTimer: NodeJS.Timeout | null = null;

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
    for (const t of this.tracked.values()) this.dispose(t);
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<LockDevice[]> {
    const tm = new Timings();
    const out = await Promise.all(deviceIds.map(async (id): Promise<LockDevice> => {
      try {
        const t = await this.current(id, tm);
        t.lastRequested = Date.now();
        return { id, name: t.name, icon: t.icon, caps: Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }])) };
      } catch (err) {
        this.log(`Lock device ${id} unavailable:`, err);
        return { id, missing: true };
      }
    }));
    this.debug(`Locks state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  /** Locks or unlocks a lock, or closes or opens a garage door. Nothing else can be set. */
  async set(deviceId: string, capabilityId: unknown, value: unknown) {
    if (!SETTABLE_LOCK_CAPS.includes(capabilityId as LockCapId)) throw new Error(`Can't set ${JSON.stringify(capabilityId)}`);
    if (typeof value !== 'boolean') throw new Error(`Invalid value ${JSON.stringify(value)}`);
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    const cap = device.capabilitiesObj?.[capabilityId as string];
    if (!cap) throw new Error(`${device.name} has no ${capabilityId}`);
    if (cap.setable === false) throw new Error(`${device.name}'s ${capabilityId} can't be set`);
    await device.setCapabilityValue({ capabilityId, value });
    this.debug(`Lock ${device.name}: ${capabilityId}=${value}`);
  }

  // ---------------------------------------------------------------- live state

  /** The tracked entry, re-read when it was already tracked, so a rename or a deleted device shows. */
  private async current(deviceId: string, tm: Timings): Promise<Tracked> {
    const t = this.tracked.get(deviceId);
    if (!t) return this.ensureTracked(deviceId, tm);
    const api = await getAppApi(this.homey);
    let device: any;
    try {
      device = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId, $cache: false }));
    } catch (err) {
      this.dispose(t);
      throw err;
    }
    const caps = lockCaps(device);
    if (caps.join() !== Object.keys(t.caps).join()) {
      this.debug(`Lock capabilities of ${device.name} changed: ${Object.keys(t.caps).join()} → ${caps.join()}`);
      this.dispose(t);
      return this.ensureTracked(deviceId, tm);
    }
    t.name = device.name;
    t.icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
    t.caps = readCaps(device);
    return t;
  }

  private ensureTracked(deviceId: string, tm: Timings): Promise<Tracked> {
    const existing = this.tracked.get(deviceId);
    if (existing) return Promise.resolve(existing);
    let p = this.trackPromises.get(deviceId);
    if (!p) {
      p = this.track(deviceId, tm).finally(() => this.trackPromises.delete(deviceId));
      this.trackPromises.set(deviceId, p);
    }
    return p;
  }

  private async track(deviceId: string, tm: Timings): Promise<Tracked> {
    const api = await tm.time('api', () => getAppApi(this.homey));
    const device: any = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId }));
    if (!lockCaps(device).length) throw new Error(`${device.name} has no lock, contact or garage door capability`);
    const icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log));
    const t: Tracked = {
      deviceId,
      name: device.name,
      icon,
      caps: readCaps(device),
      instances: [],
      lastRequested: Date.now(),
    };
    for (const id of Object.keys(t.caps) as LockCapId[]) {
      t.instances.push(device.makeCapabilityInstance(id, (value: unknown) => {
        const at = Date.now();
        const cap = t.caps[id];
        if (cap) {
          cap.value = value;
          cap.lastUpdated = at;
        }
        this.homey.api.realtime(LOCKS_STATE_EVENT, { deviceId, capabilityId: id, value, t: at });
      }));
    }
    this.tracked.set(deviceId, t);
    this.debug(`Tracking lock ${device.name} (${deviceId}): ${JSON.stringify(Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, c.value])))}`);
    return t;
  }

  private tick() {
    const now = Date.now();
    for (const t of this.tracked.values()) {
      if (now - t.lastRequested > IDLE_TIMEOUT) this.dispose(t);
    }
  }

  private dispose(t: Tracked) {
    for (const i of t.instances) {
      try { i?.destroy(); } catch (err) { /* ignore */ }
    }
    if (this.tracked.get(t.deviceId) === t) this.tracked.delete(t.deviceId);
    this.debug(`Stopped tracking lock ${t.name}`);
  }

}
