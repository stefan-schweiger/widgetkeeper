import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { presentCaps, readCaps, type CapState } from './capabilities.js';
import DeviceTracker, { readZones, zoneRef, type TrackedEntry } from './DeviceTracker.js';
import Timings from './Timings.js';

export const CURTAINS_STATE_EVENT = 'curtains:state';

/**
 * The capabilities a curtain tile reads; it needs at least one. `windowcoverings_set` is the position
 * (0 = closed, 1 = open), `windowcoverings_state` the motor (`up` opens, `down` closes, `idle` stops) and
 * `windowcoverings_closed` a plain open/closed.
 */
export const CURTAIN_CAPS = ['windowcoverings_set', 'windowcoverings_state', 'windowcoverings_closed'] as const;

export type CurtainCap = CapState;

/** `blinds` for blinds and sunshades (the tile draws a blind), else `curtain`. */
export type CurtainKind = 'curtain' | 'blinds';

export type CurtainDevice =
  | { id: string, name: string, kind: CurtainKind, zone: { id: string, name: string } | null, caps: Record<string, CurtainCap> }
  | { id: string, missing: true };

export type CurtainChange = { action?: unknown, position?: unknown };

type Tracked = TrackedEntry & {
  name: string,
  kind: CurtainKind,
  /** The zone (room) id, for grouping the tiles by room. */
  zone: string | null,
  caps: Record<string, CurtainCap>,
};

/** The curtain capabilities the device has, in `CURTAIN_CAPS` order. */
export function curtainCaps(device: any): string[] {
  return presentCaps(device, CURTAIN_CAPS);
}

export function curtainKind(device: any): CurtainKind {
  const cls = device?.virtualClass || device?.class;
  return cls === 'blinds' || cls === 'sunshade' ? 'blinds' : 'curtain';
}

/** The Curtains widget: open, close and the position of curtains and blinds. */
export default class CurtainService {

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Curtain capabilities',
      signature: device => curtainCaps(device).join(),
      create: async (device) => {
        if (!curtainCaps(device).length) throw new Error(`${device.name} has no curtain capability`);
        return { name: device.name, kind: curtainKind(device), zone: device.zone ?? null, caps: readCaps(device, CURTAIN_CAPS) };
      },
      listen: (t, device) => {
        const instances = Object.keys(t.caps).map(id => device.makeCapabilityInstance(id, (value: unknown) => {
          if (t.caps[id]) t.caps[id].value = value;
          this.homey.api.realtime(CURTAINS_STATE_EVENT, { deviceId: t.key, capabilityId: id, value });
        }));
        this.debug(`Tracking curtain ${device.name} (${t.key}): ${JSON.stringify(Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, c.value])))}`);
        return instances;
      },
      refresh: (t, device) => {
        t.name = device.name;
        t.kind = curtainKind(device);
        t.zone = device.zone ?? null;
        t.caps = readCaps(device, CURTAIN_CAPS);
      },
      label: t => `curtain ${t.name}`,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<CurtainDevice[]> {
    const tm = new Timings();
    const zonesP = readZones(this.homey, tm, this.log, 'Curtain');
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Curtain', async (t, id): Promise<CurtainDevice> => ({
      id, name: t.name, kind: t.kind, zone: zoneRef(await zonesP, t.zone), caps: Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }])),
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

}
