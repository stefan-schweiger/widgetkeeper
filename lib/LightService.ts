import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;

export const LIGHTS_STATE_EVENT = 'lights:state';

/** The capabilities a light tile reads; it needs `dim` or `onoff` (a plug or a switch set to be a light). */
export const LIGHT_CAPS = ['onoff', 'dim', 'light_temperature', 'light_hue', 'light_saturation', 'light_mode'] as const;

export type LightCap = { value: unknown, setable: boolean };

export type LightDevice =
  | { id: string, name: string, icon: string | null, zone: { id: string, name: string } | null, caps: Record<string, LightCap> }
  | { id: string, missing: true };

export type LightChange = { dim?: unknown, onoff?: unknown, temperature?: unknown, hue?: unknown, saturation?: unknown };

type Tracked = {
  deviceId: string,
  name: string,
  icon: string | null,
  /** The zone (room) id, for grouping the tiles by room. */
  zone: string | null,
  caps: Record<string, LightCap>,
  /** The last brightness above 0, to turn a light without `onoff` back on. */
  lastDim: number,
  instances: any[],
  lastRequested: number,
};

/** The light capabilities the device has, in `LIGHT_CAPS` order. */
export function lightCaps(device: any): string[] {
  const caps = device?.capabilitiesObj || {};
  return LIGHT_CAPS.filter(id => caps[id]);
}

function readCaps(device: any): Record<string, LightCap> {
  const out: Record<string, LightCap> = {};
  for (const id of lightCaps(device)) {
    const c = device.capabilitiesObj[id];
    out[id] = { value: c.value ?? null, setable: c.setable !== false };
  }
  return out;
}

function fraction(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`Invalid ${what} ${JSON.stringify(v)}`);
  return v;
}

/** The Light Controls widget: brightness, on/off, colour and colour temperature of several lights. */
export default class LightService {

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
  async getState(deviceIds: string[]): Promise<LightDevice[]> {
    const tm = new Timings();
    const zonesP = tm.time('zones', async () => (await getAppApi(this.homey)).zones.getZones())
      .catch((err: unknown) => { this.log('Light zones unavailable:', err); return {}; });
    const out = await Promise.all(deviceIds.map(async (id): Promise<LightDevice> => {
      try {
        const t = await this.current(id, tm);
        t.lastRequested = Date.now();
        const zones: Record<string, any> = await zonesP;
        const zone = t.zone && zones[t.zone] ? { id: t.zone, name: String(zones[t.zone].name) } : null;
        return { id, name: t.name, icon: t.icon, zone, caps: Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }])) };
      } catch (err) {
        this.log(`Light ${id} unavailable:`, err);
        return { id, missing: true };
      }
    }));
    this.debug(`Lights state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  /**
   * One change from a tile. Brightness 0 means off: it turns `onoff` off (keeping the brightness), and
   * brightness above 0 turns the light on. A light without `onoff` is turned off and on through `dim`,
   * and one without `dim` takes a brightness as on (above 0) or off.
   */
  async set(deviceId: string, change: LightChange) {
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    const caps = device.capabilitiesObj || {};
    if (!caps.dim && !caps.onoff) throw new Error(`${device.name} has no dim or onoff capability`);
    const send = async (capabilityId: string, value: unknown) => {
      if (!caps[capabilityId]) throw new Error(`${device.name} has no ${capabilityId}`);
      await device.setCapabilityValue({ capabilityId, value });
      this.debug(`Light ${device.name}: ${capabilityId}=${JSON.stringify(value)}`);
    };
    const turnOn = async () => {
      if (caps.onoff && caps.onoff.value !== true) await send('onoff', true);
    };

    if (change.dim !== undefined) {
      const dim = fraction(change.dim, 'brightness');
      if (dim === 0) await send(caps.onoff ? 'onoff' : 'dim', caps.onoff ? false : 0);
      else if (!caps.dim) await turnOn();
      else {
        await send('dim', dim);
        await turnOn();
      }
    } else if (change.onoff !== undefined) {
      if (typeof change.onoff !== 'boolean') throw new Error(`Invalid on/off ${JSON.stringify(change.onoff)}`);
      if (caps.onoff) await send('onoff', change.onoff);
      else await send('dim', change.onoff ? this.lastDim(deviceId, caps.dim.value) : 0);
    } else if (change.hue !== undefined) {
      const hue = fraction(change.hue, 'hue');
      const saturation = change.saturation === undefined ? undefined : fraction(change.saturation, 'saturation');
      if (!caps.light_hue) throw new Error(`${device.name} has no colour`);
      if (caps.light_mode && caps.light_mode.value !== 'color') await send('light_mode', 'color');
      await send('light_hue', hue);
      if (saturation !== undefined && caps.light_saturation) await send('light_saturation', saturation);
      await turnOn();
    } else if (change.temperature !== undefined) {
      const temperature = fraction(change.temperature, 'temperature');
      if (!caps.light_temperature) throw new Error(`${device.name} has no colour temperature`);
      if (caps.light_mode && caps.light_mode.value !== 'temperature') await send('light_mode', 'temperature');
      await send('light_temperature', temperature);
      await turnOn();
    } else {
      throw new Error('Nothing to set');
    }
  }

  private lastDim(deviceId: string, current: unknown) {
    if (typeof current === 'number' && current > 0) return current;
    return this.tracked.get(deviceId)?.lastDim ?? 1;
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
    const caps = lightCaps(device);
    if (caps.join() !== Object.keys(t.caps).join()) {
      this.debug(`Light capabilities of ${device.name} changed: ${Object.keys(t.caps).join()} → ${caps.join()}`);
      this.dispose(t);
      return this.ensureTracked(deviceId, tm);
    }
    t.name = device.name;
    t.zone = device.zone ?? null;
    t.icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
    t.caps = readCaps(device);
    this.noteDim(t);
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
    if (!device.capabilitiesObj?.dim && !device.capabilitiesObj?.onoff) throw new Error(`${device.name} has no dim or onoff capability`);
    const icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log));
    const t: Tracked = {
      deviceId,
      name: device.name,
      icon,
      zone: device.zone ?? null,
      caps: readCaps(device),
      lastDim: 1,
      instances: [],
      lastRequested: Date.now(),
    };
    this.noteDim(t);
    for (const id of Object.keys(t.caps)) {
      t.instances.push(device.makeCapabilityInstance(id, (value: unknown) => {
        if (t.caps[id]) t.caps[id].value = value;
        this.noteDim(t);
        this.homey.api.realtime(LIGHTS_STATE_EVENT, { deviceId, capabilityId: id, value });
      }));
    }
    this.tracked.set(deviceId, t);
    this.debug(`Tracking light ${device.name} (${deviceId}): ${JSON.stringify(Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, c.value])))}`);
    return t;
  }

  private noteDim(t: Tracked) {
    const dim = t.caps.dim?.value;
    if (typeof dim === 'number' && dim > 0) t.lastDim = dim;
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
    this.debug(`Stopped tracking light ${t.name}`);
  }

}
