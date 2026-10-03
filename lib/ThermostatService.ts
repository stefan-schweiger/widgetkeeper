import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchDeviceIcon } from './deviceIcon.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;
const CONFIRM_TIMEOUT = 4000; // wait for a value to be reported before sending the next
const CONFIRM_POLL = 300;
const BASE_CAPS = ['onoff', 'target_temperature', 'thermostat_mode', 'measure_temperature'];

export const STATE_EVENT = 'thermostat:state';

export type CapInfo = {
  title: string,
  units: string | null,
  values: { id: string, title: string }[] | null, // enum capabilities only
};

export type ThermostatState = {
  name: string,
  icon: string | null, // the device's icon as an SVG data URL (the widget uses it as a mask)
  values: Record<string, unknown>,
  caps: Record<string, CapInfo>,
};

export type CapValue = { capabilityId: string, value: unknown };

export type AutocompleteItem = { name: string, description?: string, [key: string]: unknown };

type Tracked = {
  deviceId: string,
  name: string,
  icon: string | null,
  values: Record<string, unknown>,
  caps: Record<string, CapInfo>,
  instances: any[],
  lastRequested: number,
};

/** Capabilities a shortcut can set: the thermostat basics plus every settable enum (mode, fan, swing…). */
function relevantCaps(device: any): string[] {
  const obj = device.capabilitiesObj || {};
  return (device.capabilities as string[] || []).filter(id => BASE_CAPS.includes(id)
    || (obj[id]?.type === 'enum' && obj[id]?.setable !== false));
}

function isThermostat(device: any): boolean {
  return !!(device?.capabilities?.includes('target_temperature') || device?.capabilities?.includes('thermostat_mode'));
}

function capInfo(cap: any, id: string): CapInfo {
  return {
    title: typeof cap?.title === 'string' ? cap.title : id,
    units: typeof cap?.units === 'string' ? cap.units : null,
    values: Array.isArray(cap?.values)
      ? cap.values.map((v: any) => ({ id: String(v.id), title: typeof v.title === 'string' ? v.title : String(v.id) }))
      : null,
  };
}

function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

export default class ThermostatService {

  private tracked = new Map<string, Tracked>();
  private trackPromises = new Map<string, Promise<Tracked>>();
  private applying = new Map<string, { gen: number, done: Promise<void> }>();
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(private homey: Homey.App['homey'], private log: (...args: any[]) => void) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    for (const t of this.tracked.values()) this.dispose(t);
  }

  private getApi(): Promise<any> {
    return getAppApi(this.homey);
  }

  /** The widget API may only touch thermostat-like devices (the same ones the device setting lists). */
  private assertThermostat(device: any) {
    if (!isThermostat(device)) throw new Error(`${device?.name ?? 'Device'} is not a thermostat`);
  }

  async getState(deviceId: string): Promise<ThermostatState> {
    const t = await this.ensureTracked(deviceId);
    t.lastRequested = Date.now();
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
    const api = await this.getApi();
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    this.assertThermostat(device);
    const obj = device.capabilitiesObj || {};
    const allowed = relevantCaps(device);
    this.log(`Apply requested for ${device.name}:`, JSON.stringify(values));
    for (const v of values) {
      if (!obj[v.capabilityId]) throw new Error(`${device.name} has no ${v.capabilityId} capability (it has ${Object.keys(obj).join(', ')})`);
      if (!allowed.includes(v.capabilityId) || obj[v.capabilityId].setable === false) throw new Error(`${v.capabilityId} is not settable`);
    }
    const rank = (v: CapValue) => (v.capabilityId !== 'onoff' ? 1 : v.value ? 0 : 2);
    const ordered = [...values].sort((a, b) => rank(a) - rank(b));
    const current: Record<string, unknown> = {};
    for (const id of Object.keys(obj)) current[id] = obj[id]?.value;

    const sent: string[] = [];
    for (const [i, v] of ordered.entries()) {
      if (current[v.capabilityId] === v.value) continue;
      if (superseded()) {
        this.log(`Apply to ${device.name} superseded by a newer one (after ${sent.join(', ') || 'nothing'})`);
        return;
      }
      try {
        await device.setCapabilityValue({ capabilityId: v.capabilityId, value: v.value });
      } catch (err) {
        this.log(`Setting ${v.capabilityId}=${JSON.stringify(v.value)} on ${device.name} failed (after ${sent.join(', ') || 'nothing'}):`, err);
        throw err;
      }
      sent.push(`${v.capabilityId}=${JSON.stringify(v.value)}`);
      if (i < ordered.length - 1) await this.waitForValue(api, deviceId, v, superseded);
    }
    this.log(`Applied to ${device.name}:`, sent.join(', ') || 'nothing to change');
  }

  private async waitForValue(api: any, deviceId: string, v: CapValue, superseded: () => boolean) {
    const until = Date.now() + CONFIRM_TIMEOUT;
    while (Date.now() < until) {
      if (superseded()) return;
      try {
        const d = await api.devices.getDevice({ id: deviceId, $cache: false });
        if (d.capabilitiesObj?.[v.capabilityId]?.value === v.value) return;
      } catch (err) { /* keep waiting */ }
      await new Promise(resolve => this.homey.setTimeout(resolve, CONFIRM_POLL));
    }
    this.log(`${v.capabilityId}=${JSON.stringify(v.value)} not confirmed within ${CONFIRM_TIMEOUT} ms, continuing`);
  }

  // ---------------------------------------------------------------- settings autocomplete

  async listDevices(query: string): Promise<AutocompleteItem[]> {
    const api = await this.getApi();
    const [devices, zones] = await Promise.all([
      api.devices.getDevices(),
      api.zones.getZones().catch(() => ({})),
    ]);
    return (Object.values(devices) as any[])
      .filter(isThermostat)
      .map(d => ({ name: d.name as string, description: (zones as any)[d.zone]?.name, id: d.id as string }))
      .filter(d => matches(query, d.name, d.description))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every value of every settable enum capability, e.g. "Fan speed: Medium". */
  async listEnumOptions(deviceId: string | undefined, query: string): Promise<AutocompleteItem[]> {
    const device = await this.getDeviceForSettings(deviceId);
    const items: AutocompleteItem[] = [];
    for (const id of relevantCaps(device)) {
      const info = capInfo(device.capabilitiesObj[id], id);
      for (const v of info.values || []) {
        items.push({ name: `${info.title}: ${v.title}`, capabilityId: id, value: v.id });
      }
    }
    return [this.unchanged(), ...items.filter(i => matches(query, i.name))];
  }

  /** Target temperatures within the capability's range and step. */
  async listTemperatures(deviceId: string | undefined, query: string): Promise<AutocompleteItem[]> {
    const device = await this.getDeviceForSettings(deviceId);
    const cap = device.capabilitiesObj?.target_temperature;
    if (!cap) return [this.unchanged()];
    const min = typeof cap.min === 'number' ? cap.min : 16;
    const max = typeof cap.max === 'number' ? cap.max : 30;
    const step = typeof cap.step === 'number' && cap.step > 0 ? cap.step : 0.5;
    const units = typeof cap.units === 'string' ? cap.units : '°C';
    const items: AutocompleteItem[] = [];
    for (let v = min; v <= max + 1e-9 && items.length < 200; v += step) {
      const value = Math.round(v * 100) / 100;
      items.push({ name: `${value} ${units}`, capabilityId: 'target_temperature', value });
    }
    return [this.unchanged(), ...items.filter(i => matches(query, i.name))];
  }

  private unchanged(): AutocompleteItem {
    return { name: this.homey.__('thermostat.unchanged') || "Don't change" };
  }

  private async getDeviceForSettings(deviceId: string | undefined) {
    if (!deviceId) throw new Error(this.homey.__('thermostat.selectDeviceFirst') || 'Select a device first');
    const api = await this.getApi();
    return api.devices.getDevice({ id: deviceId });
  }

  // ---------------------------------------------------------------- live state

  private ensureTracked(deviceId: string): Promise<Tracked> {
    const existing = this.tracked.get(deviceId);
    if (existing) return Promise.resolve(existing);
    let p = this.trackPromises.get(deviceId);
    if (!p) {
      p = this.track(deviceId).finally(() => this.trackPromises.delete(deviceId));
      this.trackPromises.set(deviceId, p);
    }
    return p;
  }

  private async track(deviceId: string): Promise<Tracked> {
    const api = await this.getApi();
    const device = await api.devices.getDevice({ id: deviceId });
    this.assertThermostat(device);
    const ids = relevantCaps(device);
    const t: Tracked = {
      deviceId,
      name: device.name,
      icon: await fetchDeviceIcon(api, device, this.log),
      values: {},
      caps: {},
      instances: [],
      lastRequested: Date.now(),
    };
    for (const id of ids) {
      const cap = device.capabilitiesObj[id];
      t.caps[id] = capInfo(cap, id);
      t.values[id] = cap?.value ?? null;
      t.instances.push(device.makeCapabilityInstance(id, (value: unknown) => {
        t.values[id] = value;
        this.homey.api.realtime(STATE_EVENT, { deviceId, capabilityId: id, value });
      }));
    }
    this.tracked.set(deviceId, t);
    this.log(`Tracking thermostat ${device.name} (${deviceId}):`,
      ids.map(id => `${id}=${JSON.stringify(t.values[id])}${t.caps[id].values ? ` [${t.caps[id].values!.map(v => v.id).join('|')}]` : ''}`).join(', '));
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
      try { i.destroy(); } catch (err) { /* ignore */ }
    }
    this.tracked.delete(t.deviceId);
    this.log(`Stopped tracking ${t.name}`);
  }

}
