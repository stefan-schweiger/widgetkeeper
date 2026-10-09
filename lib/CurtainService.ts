import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;

export const CURTAINS_STATE_EVENT = 'curtains:state';

/**
 * The capabilities a curtain tile reads; it needs at least one. `windowcoverings_set` is the position
 * (0 = closed, 1 = open), `windowcoverings_state` the motor (`up` opens, `down` closes, `idle` stops) and
 * `windowcoverings_closed` a plain open/closed.
 */
export const CURTAIN_CAPS = ['windowcoverings_set', 'windowcoverings_state', 'windowcoverings_closed'] as const;

export type CurtainCap = { value: unknown, setable: boolean };

/** `blinds` for blinds and sunshades (the tile draws a blind), else `curtain`. */
export type CurtainKind = 'curtain' | 'blinds';

export type CurtainDevice =
  | { id: string, name: string, kind: CurtainKind, zone: { id: string, name: string } | null, caps: Record<string, CurtainCap> }
  | { id: string, missing: true };

export type CurtainChange = { action?: unknown, position?: unknown };

type Tracked = {
  deviceId: string,
  name: string,
  kind: CurtainKind,
  /** The zone (room) id, for grouping the tiles by room. */
  zone: string | null,
  caps: Record<string, CurtainCap>,
  instances: any[],
  lastRequested: number,
};

/** The curtain capabilities the device has, in `CURTAIN_CAPS` order. */
export function curtainCaps(device: any): string[] {
  const caps = device?.capabilitiesObj || {};
  return CURTAIN_CAPS.filter(id => caps[id]);
}

export function curtainKind(device: any): CurtainKind {
  const cls = device?.virtualClass || device?.class;
  return cls === 'blinds' || cls === 'sunshade' ? 'blinds' : 'curtain';
}

function readCaps(device: any): Record<string, CurtainCap> {
  const out: Record<string, CurtainCap> = {};
  for (const id of curtainCaps(device)) {
    const c = device.capabilitiesObj[id];
    out[id] = { value: c.value ?? null, setable: c.setable !== false };
  }
  return out;
}

/** The Curtains widget: open, close and the position of curtains and blinds. */
export default class CurtainService {

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
  async getState(deviceIds: string[]): Promise<CurtainDevice[]> {
    const tm = new Timings();
    const zonesP = tm.time('zones', async () => (await getAppApi(this.homey)).zones.getZones())
      .catch((err: unknown) => { this.log('Curtain zones unavailable:', err); return {}; });
    const out = await Promise.all(deviceIds.map(async (id): Promise<CurtainDevice> => {
      try {
        const t = await this.current(id, tm);
        t.lastRequested = Date.now();
        const zones: Record<string, any> = await zonesP;
        const zone = t.zone && zones[t.zone] ? { id: t.zone, name: String(zones[t.zone].name) } : null;
        return { id, name: t.name, kind: t.kind, zone, caps: Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }])) };
      } catch (err) {
        this.log(`Curtain ${id} unavailable:`, err);
        return { id, missing: true };
      }
    }));
    this.debug(`Curtains state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  /**
   * One change from a tile: `{position}` (0–1), or `{action}` (open or close). They go through the position
   * when the device has one (a definite end), else the motor (`up`/`down`), else `windowcoverings_closed`.
   * Sent while it moves, they turn it round.
   */
  async set(deviceId: string, change: CurtainChange) {
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    const caps = device.capabilitiesObj || {};
    const can = (id: string) => !!caps[id] && caps[id].setable !== false;
    const send = async (capabilityId: string, value: unknown) => {
      await device.setCapabilityValue({ capabilityId, value });
      this.debug(`Curtain ${device.name}: ${capabilityId}=${JSON.stringify(value)}`);
    };

    if (change.position !== undefined) {
      const p = change.position;
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) throw new Error(`Invalid position ${JSON.stringify(p)}`);
      if (!can('windowcoverings_set')) throw new Error(`${device.name} has no position`);
      await send('windowcoverings_set', p);
    } else if (change.action === 'open' || change.action === 'close') {
      const open = change.action === 'open';
      if (can('windowcoverings_set')) await send('windowcoverings_set', open ? 1 : 0);
      else if (can('windowcoverings_state')) await send('windowcoverings_state', open ? 'up' : 'down');
      else if (can('windowcoverings_closed')) await send('windowcoverings_closed', !open);
      else throw new Error(`${device.name} can't be opened or closed`);
    } else {
      throw new Error(`Invalid change ${JSON.stringify(change)}`);
    }
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
    const caps = curtainCaps(device);
    if (caps.join() !== Object.keys(t.caps).join()) {
      this.debug(`Curtain capabilities of ${device.name} changed: ${Object.keys(t.caps).join()} → ${caps.join()}`);
      this.dispose(t);
      return this.ensureTracked(deviceId, tm);
    }
    t.name = device.name;
    t.kind = curtainKind(device);
    t.zone = device.zone ?? null;
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
    if (!curtainCaps(device).length) throw new Error(`${device.name} has no curtain capability`);
    const t: Tracked = {
      deviceId,
      name: device.name,
      kind: curtainKind(device),
      zone: device.zone ?? null,
      caps: readCaps(device),
      instances: [],
      lastRequested: Date.now(),
    };
    for (const id of Object.keys(t.caps)) {
      t.instances.push(device.makeCapabilityInstance(id, (value: unknown) => {
        if (t.caps[id]) t.caps[id].value = value;
        this.homey.api.realtime(CURTAINS_STATE_EVENT, { deviceId, capabilityId: id, value });
      }));
    }
    this.tracked.set(deviceId, t);
    this.debug(`Tracking curtain ${device.name} (${deviceId}): ${JSON.stringify(Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, c.value])))}`);
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
    this.debug(`Stopped tracking curtain ${t.name}`);
  }

}
