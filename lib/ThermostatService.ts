import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { listDevicesWhere, matches, type AutocompleteItem } from './autocomplete.js';
import { describeCapability } from './capabilities.js';
import DeviceTracker, { type TrackedEntry } from './DeviceTracker.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import Timings from './Timings.js';

const CONFIRM_TIMEOUT = 4000; // wait for a value to be reported before sending the next
const CONFIRM_POLL = 300;
const BASE_CAPS = ['onoff', 'target_temperature', 'thermostat_mode', 'measure_temperature'];

export const STATE_EVENT = 'thermostat:state';

type CapInfo = {
  title: string,
  units: string | null,
  values: { id: string, title: string }[] | null, // enum capabilities only
};

type ThermostatState = {
  name: string,
  icon: string | null, // the device's icon as an SVG data URL (the widget uses it as a mask)
  values: Record<string, unknown>,
  caps: Record<string, CapInfo>,
};

export type CapValue = { capabilityId: string, value: unknown };

/** A preset option: a value to set (`capabilityId`, `value`), or none (`Don't change`). */
type PresetOption = { name: string, capabilityId?: string, value?: unknown };

type Tracked = TrackedEntry & {
  name: string,
  icon: string | null,
  values: Record<string, unknown>,
  caps: Record<string, CapInfo>,
};

/** Capabilities a shortcut can set: the thermostat basics plus every settable enum (mode, fan, swing…). */
function relevantCaps(device: any): string[] {
  const obj = device.capabilitiesObj || {};
  return (device.capabilities as string[] || []).filter(id => BASE_CAPS.includes(id)
    || (obj[id]?.type === 'enum' && obj[id]?.setable !== false));
}

/** A device the thermostat widget can use (the same ones its device setting lists). */
export function isThermostat(device: any): boolean {
  return !!(device?.capabilities?.includes('target_temperature') || device?.capabilities?.includes('thermostat_mode'));
}

function capInfo(cap: any, id: string): CapInfo {
  const { title, units, values } = describeCapability(cap, id);
  return { title, units, values };
}

/** The capabilities and values of the ones a shortcut can set, read into the entry. */
function readState(t: Tracked, device: any) {
  for (const id of relevantCaps(device)) {
    const cap = device.capabilitiesObj[id];
    t.caps[id] = capInfo(cap, id);
    t.values[id] = cap?.value ?? null;
  }
}

/** A tracked device that can no longer be read. */
class MissingError extends Error {
  constructor(readonly reason: unknown) { super('Device unavailable'); }
}

export default class ThermostatService {

  private tracker: DeviceTracker<Tracked>;
  private applying = new Map<string, { gen: number, done: Promise<void> }>();

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    // An open widget keeps its entry alive indefinitely, so each request re-reads the device: a rename, changed
    // capabilities or a deleted device would otherwise never show.
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Thermostat capabilities',
      signature: device => (isThermostat(device) ? relevantCaps(device).join() : 'not a thermostat'),
      create: async (device, api, tm) => {
        this.assertThermostat(device);
        const t = { name: device.name, icon: await tm.time('icon', () => fetchDeviceIcon(api, device, this.log)), values: {}, caps: {} };
        readState(t as Tracked, device);
        return t;
      },
      listen: (t, device) => {
        const ids = Object.keys(t.caps);
        this.debug(`Tracking thermostat ${device.name} (${t.key}):`,
          ids.map(id => `${id}=${JSON.stringify(t.values[id])}${t.caps[id].values ? ` [${t.caps[id].values!.map(v => v.id).join('|')}]` : ''}`).join(', '));
        return ids.map(id => device.makeCapabilityInstance(id, (value: unknown) => {
          t.values[id] = value;
          this.homey.api.realtime(STATE_EVENT, { deviceId: t.key, capabilityId: id, value });
        }));
      },
      refresh: async (t, device, api, tm) => {
        t.name = device.name;
        t.icon = await tm.time('icon', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
        readState(t, device);
      },
      label: t => t.name,
      readError: err => new MissingError(err),
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }
  /** The widget API may only touch thermostat-like devices (the same ones the device setting lists). */
  private assertThermostat(device: any) {
    if (!isThermostat(device)) throw new Error(`${device?.name ?? 'Device'} is not a thermostat`);
  }

  /** The device's state, or `missing` when a tracked device can no longer be read (e.g. deleted). */
  async getState(deviceId: string): Promise<ThermostatState | { missing: true }> {
    const tm = new Timings();
    let t: Tracked;
    try {
      t = await this.tracker.current(deviceId, tm);
    } catch (err) {
      if (!(err instanceof MissingError)) throw err;
      this.log(`Thermostat ${deviceId} unavailable:`, err.reason);
      return { missing: true };
    }
    this.debug(`Thermostat state ${t.name}: ${tm.summary()}`);
    return { name: t.name, icon: t.icon, values: { ...t.values }, caps: t.caps };
  }

  /**
   * Sets the values one at a time, in the order given (the widget sends mode before temperature
   * and fan), except that `onoff=true` goes first and `onoff=false` last. Some drivers validate a
   * value against the current mode (e.g. allowed fan speeds), so after each value it waits until
   * the device reports it before sending the next one. Values the device already has are skipped.
   *
   * Applies to one device run one at a time. A newer apply supersedes an older one that is still
   * running: the older one stops before its next value, so two presets' values never interleave.
   */
  async apply(deviceId: string, values: CapValue[]) {
    const prev = this.applying.get(deviceId);
    const gen = (prev?.gen ?? 0) + 1;
    const superseded = () => this.applying.get(deviceId)?.gen !== gen;
    const run = (prev?.done ?? Promise.resolve()).then(() => this.applyNow(deviceId, values, superseded));
    const entry = { gen, done: run.then(() => {}, () => {}) };
    this.applying.set(deviceId, entry);
    try {
      await run;
    } finally {
      if (this.applying.get(deviceId) === entry) this.applying.delete(deviceId);
    }
  }

  private async applyNow(deviceId: string, values: CapValue[], superseded: () => boolean) {
    if (superseded()) return;
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    this.assertThermostat(device);
    const obj = device.capabilitiesObj || {};
    const allowed = relevantCaps(device);
    this.debug(`Apply requested for ${device.name}:`, JSON.stringify(values));
    for (const v of values) {
      if (!obj[v.capabilityId]) throw new Error(`${device.name} has no ${v.capabilityId} capability (it has ${Object.keys(obj).join(', ')})`);
      if (!allowed.includes(v.capabilityId) || obj[v.capabilityId].setable === false) throw new Error(`${v.capabilityId} is not settable`);
    }
    const rank = (v: CapValue) => (v.capabilityId !== 'onoff' ? 1 : v.value ? 0 : 2);
    const ordered = [...values].sort((a, b) => rank(a) - rank(b));
    const current: Record<string, unknown> = {};
    for (const id of Object.keys(obj)) current[id] = obj[id]?.value;

    // `current` follows the device during the apply: a mode change can change other values too
    // (many aircons keep a setpoint per mode), so a value is only skipped if it's there right now.
    const sent: string[] = [];
    for (const [i, v] of ordered.entries()) {
      if (current[v.capabilityId] === v.value) continue;
      if (superseded()) {
        this.debug(`Apply to ${device.name} superseded by a newer one (after ${sent.join(', ') || 'nothing'})`);
        return;
      }
      try {
        await device.setCapabilityValue({ capabilityId: v.capabilityId, value: v.value });
      } catch (err) {
        this.log(`Setting ${v.capabilityId}=${JSON.stringify(v.value)} on ${device.name} failed (after ${sent.join(', ') || 'nothing'}):`, err);
        throw err;
      }
      sent.push(`${v.capabilityId}=${JSON.stringify(v.value)}`);
      if (i < ordered.length - 1) {
        const latest = await this.waitForValue(api, deviceId, v, superseded);
        for (const id of Object.keys(latest ?? {})) current[id] = latest![id]?.value;
      }
    }
    this.debug(`Applied to ${device.name}:`, sent.join(', ') || 'nothing to change');
  }

  /** Waits for the device to report the value. Returns the last capabilities read (null if none could be). */
  private async waitForValue(api: any, deviceId: string, v: CapValue, superseded: () => boolean): Promise<Record<string, any> | null> {
    const until = Date.now() + CONFIRM_TIMEOUT;
    let latest: Record<string, any> | null = null;
    while (Date.now() < until) {
      if (superseded()) return latest;
      try {
        const d = await api.devices.getDevice({ id: deviceId, $cache: false });
        latest = d.capabilitiesObj ?? null;
        if (latest?.[v.capabilityId]?.value === v.value) return latest;
      } catch (err) { /* keep waiting */ }
      await new Promise(resolve => this.homey.setTimeout(resolve, CONFIRM_POLL));
    }
    this.log(`${v.capabilityId}=${JSON.stringify(v.value)} not confirmed within ${CONFIRM_TIMEOUT} ms, continuing`);
    return latest;
  }

  // ---------------------------------------------------------------- settings autocomplete

  listDevices(query: string): Promise<AutocompleteItem[]> {
    return listDevicesWhere(this.homey, query, isThermostat);
  }

  /** Every value of every settable enum capability, e.g. "Fan speed: Medium". */
  async listEnumOptions(deviceId: string | undefined, query: string): Promise<PresetOption[]> {
    const device = await this.getDeviceForSettings(deviceId);
    const items: PresetOption[] = [];
    for (const id of relevantCaps(device)) {
      const info = capInfo(device.capabilitiesObj[id], id);
      for (const v of info.values || []) {
        items.push({ name: `${info.title}: ${v.title}`, capabilityId: id, value: v.id });
      }
    }
    return [this.unchanged(), ...items.filter(i => matches(query, i.name))];
  }

  /** Target temperatures within the capability's range and step. */
  async listTemperatures(deviceId: string | undefined, query: string): Promise<PresetOption[]> {
    const device = await this.getDeviceForSettings(deviceId);
    const cap = device.capabilitiesObj?.target_temperature;
    if (!cap) return [this.unchanged()];
    const min = typeof cap.min === 'number' ? cap.min : 16;
    const max = typeof cap.max === 'number' ? cap.max : 30;
    const step = typeof cap.step === 'number' && cap.step > 0 ? cap.step : 0.5;
    const units = typeof cap.units === 'string' ? cap.units : '°C';
    const items: PresetOption[] = [];
    for (let v = min; v <= max + 1e-9 && items.length < 200; v += step) {
      const value = Math.round(v * 100) / 100;
      items.push({ name: `${value} ${units}`, capabilityId: 'target_temperature', value });
    }
    return [this.unchanged(), ...items.filter(i => matches(query, i.name))];
  }

  private unchanged(): PresetOption {
    return { name: this.homey.__('thermostat.unchanged') || "Don't change" };
  }

  private async getDeviceForSettings(deviceId: string | undefined) {
    if (!deviceId) throw new Error(this.homey.__('thermostat.selectDeviceFirst') || 'Select a device first');
    const api = await getAppApi(this.homey);
    return api.devices.getDevice({ id: deviceId });
  }

}
