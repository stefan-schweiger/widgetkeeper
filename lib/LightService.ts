import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { presentCaps, readCaps, type CapState } from './capabilities.js';
import DeviceTracker, { readZones, zoneRef, type TrackedEntry } from './DeviceTracker.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import Timings from './Timings.js';

export const LIGHTS_STATE_EVENT = 'lights:state';

/** The capabilities a light tile reads; it needs `dim` or `onoff` (a plug or a switch set to be a light). */
export const LIGHT_CAPS = ['onoff', 'dim', 'light_temperature', 'light_hue', 'light_saturation', 'light_mode'] as const;

export type LightCap = CapState;

export type LightDevice =
  | { id: string, name: string, icon: string | null, zone: { id: string, name: string } | null, caps: Record<string, LightCap> }
  | { id: string, missing: true };

export type LightChange = { dim?: unknown, onoff?: unknown, temperature?: unknown, hue?: unknown, saturation?: unknown };

type Tracked = TrackedEntry & {
  name: string,
  icon: string | null,
  /** The zone (room) id, for grouping the tiles by room. */
  zone: string | null,
  caps: Record<string, LightCap>,
  /** The last brightness above 0, to turn a light without `onoff` back on. */
  lastDim: number,
};

/** The light capabilities the device has, in `LIGHT_CAPS` order. */
export function lightCaps(device: any): string[] {
  return presentCaps(device, LIGHT_CAPS);
}

function fraction(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`Invalid ${what} ${JSON.stringify(v)}`);
  return v;
}

/** The Light Controls widget: brightness, on/off, colour and colour temperature of several lights. */
export default class LightService {

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Light capabilities',
      signature: device => lightCaps(device).join(),
      create: async (device, api, tm) => {
        if (!device.capabilitiesObj?.dim && !device.capabilitiesObj?.onoff) throw new Error(`${device.name} has no dim or onoff capability`);
        const icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log));
        return { name: device.name, icon, zone: device.zone ?? null, caps: readCaps(device, LIGHT_CAPS), lastDim: 1 };
      },
      listen: (t, device) => {
        noteDim(t);
        const instances = Object.keys(t.caps).map(id => device.makeCapabilityInstance(id, (value: unknown) => {
          if (t.caps[id]) t.caps[id].value = value;
          noteDim(t);
          this.homey.api.realtime(LIGHTS_STATE_EVENT, { deviceId: t.key, capabilityId: id, value });
        }));
        this.debug(`Tracking light ${device.name} (${t.key}): ${JSON.stringify(Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, c.value])))}`);
        return instances;
      },
      refresh: async (t, device, api, tm) => {
        t.name = device.name;
        t.zone = device.zone ?? null;
        t.icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
        t.caps = readCaps(device, LIGHT_CAPS);
        noteDim(t);
      },
      label: t => `light ${t.name}`,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<LightDevice[]> {
    const tm = new Timings();
    const zonesP = readZones(this.homey, tm, this.log, 'Light');
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Light', async (t, id): Promise<LightDevice> => ({
      id, name: t.name, icon: t.icon, zone: zoneRef(await zonesP, t.zone), caps: Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }])),
    }));
    this.debug(`Lights state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  /**
   * One change from a tile. Brightness 0 means off: it turns `onoff` off (keeping the brightness), and
   * brightness above 0 turns the light on. A light without `onoff` is turned off and on through `dim`,
   * and one without `dim` takes a brightness as on (above 0) or off. A colour or white turns an off light
   * on first: a Hue bridge ignores colour changes while the light is off, so it came on in its old colour.
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
      await turnOn();
      if (caps.light_mode && caps.light_mode.value !== 'color') await send('light_mode', 'color');
      await send('light_hue', hue);
      if (saturation !== undefined && caps.light_saturation) await send('light_saturation', saturation);
    } else if (change.temperature !== undefined) {
      const temperature = fraction(change.temperature, 'temperature');
      if (!caps.light_temperature) throw new Error(`${device.name} has no colour temperature`);
      await turnOn();
      if (caps.light_mode && caps.light_mode.value !== 'temperature') await send('light_mode', 'temperature');
      await send('light_temperature', temperature);
    } else {
      throw new Error('Nothing to set');
    }
  }

  private lastDim(deviceId: string, current: unknown) {
    if (typeof current === 'number' && current > 0) return current;
    return this.tracker.get(deviceId)?.lastDim ?? 1;
  }

}

function noteDim(t: Tracked) {
  const dim = t.caps.dim?.value;
  if (typeof dim === 'number' && dim > 0) t.lastDim = dim;
}
