import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { presentCaps, readCaps, type CapState } from './capabilities.js';
import DeviceTracker, { readZones, zoneRef, type TrackedEntry } from './DeviceTracker.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import PersonalApiKey from './PersonalApiKey.js';
import { sharedCache } from './sharedCache.js';
import Timings from './Timings.js';

export const LIGHTS_STATE_EVENT = 'lights:state';

/** The capabilities a light tile reads; it needs `dim` or `onoff` (a plug or a switch set to be a light). */
export const LIGHT_CAPS = ['onoff', 'dim', 'light_temperature', 'light_hue', 'light_saturation', 'light_mode'] as const;

export type LightCap = CapState;

/** A light in a Homey group device (`groupLights`), for the group's tile to show its lights' colours. */
export type LightMember = { id: string, caps: Record<string, LightCap> };

export type LightDevice =
  | { id: string, name: string, icon: string | null, zone: { id: string, name: string } | null, caps: Record<string, LightCap>, groupLights?: LightMember[] }
  | { id: string, missing: true };

/** Homey's own group devices (Devices → New group): one light over others, listed in `settings.deviceIds`. */
export const GROUP_DRIVER = 'homey:virtualdrivergroup:driver';

/** A Homey group device's lights, or null for any other device. */
export function groupMembers(device: any): string[] | null {
  if (device?.driverId !== GROUP_DRIVER) return null;
  const ids = device.settings?.deviceIds;
  return Array.isArray(ids) ? ids.filter((id: unknown): id is string => typeof id === 'string' && id !== device.id) : [];
}

/** A colour a Mood gives one of its lights: a hue and saturation (0–1), or a colour temperature (0 = cool). */
export type MoodColor = { hue: number, saturation: number } | { temperature: number };

/** A Homey Mood of a room, for the Light Controls palette (`palette: moods`). */
export type LightMood = { id: string, name: string, zone: string, colors: MoodColor[] };

/** How long the Moods read is shared: the widgets ask after every `/state`. */
const MOODS_CACHE_MS = 60e3;
/** At most this many colours per Mood (the pill's dot). */
const MOOD_COLORS = 4;

export type LightChange = { dim?: unknown, onoff?: unknown, temperature?: unknown, hue?: unknown, saturation?: unknown };

type Tracked = TrackedEntry & {
  name: string,
  icon: string | null,
  /** The zone (room) id, for grouping the tiles by room. */
  zone: string | null,
  /** A Homey group device's lights (`groupMembers()`), or null. */
  members: string[] | null,
  caps: Record<string, LightCap>,
  /** The last brightness above 0, to turn a light without `onoff` back on. */
  lastDim: number,
};

const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * The colours a Mood gives its lights (each device's stored `state`, keyed by capability), for the pill's dot:
 * a light it turns off has none, and a light in colour mode (or without a temperature) gives its hue.
 */
export function moodColors(mood: any): MoodColor[] {
  const out: MoodColor[] = [];
  for (const { state } of Object.values<any>(mood?.devices ?? {})) {
    if (!state || state.onoff === false || out.length >= MOOD_COLORS) continue;
    const colourMode = state.light_mode === 'color' || (state.light_mode == null && !unit(state.light_temperature));
    if (colourMode && unit(state.light_hue)) {
      out.push({ hue: state.light_hue, saturation: unit(state.light_saturation) ? state.light_saturation : 1 });
    } else if (unit(state.light_temperature)) {
      out.push({ temperature: state.light_temperature });
    }
  }
  return out;
}

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
  /** Every Mood on the Homey, read with the app's token (`homey.mood.readonly`). */
  private moods = sharedCache(async () => {
    const api = await getAppApi(this.homey);
    return Object.values<any>(await (api as any).moods.getMoods() ?? {});
  });
  private moodsStarted = 0;
  private lastMoodError: string | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    private key = PersonalApiKey.for(homey, log),
  ) {
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Light capabilities',
      signature: device => `${lightCaps(device).join()}|${(groupMembers(device) ?? []).join()}`,
      create: async (device, api, tm) => {
        if (!device.capabilitiesObj?.dim && !device.capabilitiesObj?.onoff) throw new Error(`${device.name} has no dim or onoff capability`);
        const icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log));
        return { name: device.name, icon, zone: device.zone ?? null, members: groupMembers(device), caps: readCaps(device, LIGHT_CAPS), lastDim: 1 };
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
        t.members = groupMembers(device);
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

  /**
   * One entry per device, in the order asked for. A deleted device doesn't fail the others. A Homey group device
   * also gets its lights (`groupLights`, tracked too, so their changes go out as realtime events): its own colour is
   * only the last one set on the group, while a Mood or a Flow may have given its lights several.
   */
  async getState(deviceIds: string[]): Promise<LightDevice[]> {
    const tm = new Timings();
    const zonesP = readZones(this.homey, tm, this.log, 'Light');
    const caps = (t: Tracked) => Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }]));
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Light', async (t, id): Promise<LightDevice> => {
      const entry: LightDevice = { id, name: t.name, icon: t.icon, zone: zoneRef(await zonesP, t.zone), caps: caps(t) };
      if (t.members) {
        // One level: a group in a group (or a member gone missing) is left out.
        const members = await this.tracker.each(t.members, tm, this.log, 'Light group member', m => (m.members ? null : { id: m.key, caps: caps(m) }));
        entry.groupLights = members.filter((m): m is LightMember => !!m && !('missing' in m));
      }
      return entry;
    });
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

  /** The Moods of these zones (rooms), sorted by name. */
  async getMoods(zoneIds: string[]): Promise<LightMood[]> {
    const zones = new Set(zoneIds);
    if (!zones.size) return [];
    const all = await this.moods.get(MOODS_CACHE_MS);
    return all
      .filter(m => m && typeof m.id === 'string' && zones.has(m.zone))
      .map(m => ({ id: m.id, name: String(m.name ?? ''), zone: m.zone, colors: moodColors(m) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Starts a Mood. The app's token may only read them (no `homey.mood.set`), so it goes through the user's
   * personal API key (a KeyError says why it can't).
   */
  async setMood(id: string) {
    if (typeof id !== 'string' || !id) throw new Error(`Invalid mood id ${JSON.stringify(id)}`);
    try {
      await this.key.run(api => (api as any).moods.setMood({ id }));
    } catch (err) {
      this.lastMoodError = String((err as any)?.message ?? err);
      throw err;
    }
    this.lastMoodError = null;
    this.moodsStarted++;
    this.debug(`Started mood ${id}`);
  }

  /** For the diagnostics report: counts, never names. */
  async describeMoods() {
    let perZone: Record<string, number> | string;
    try {
      perZone = {};
      for (const m of await this.moods.get(MOODS_CACHE_MS)) perZone[m.zone] = (perZone[m.zone] ?? 0) + 1;
    } catch (err) {
      perZone = String((err as any)?.message ?? err);
    }
    return { perZone, started: this.moodsStarted, lastError: this.lastMoodError };
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
