import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchSvgIcon } from './deviceIcon.js';
import type { AutocompleteItem } from './HeatmapService.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;

export const VALUES_STATE_EVENT = 'values:state';

const SHOWN_TYPES = new Set(['number', 'boolean', 'enum', 'string']);

export type ValueCapability = {
  title: string,
  type: string,
  units: string | null,
  decimals: number | null,
  /** A number's range, when the capability has one (`dim` is 0–1 with `%` units). */
  min: number | null,
  max: number | null,
  /** An enum's values with their titles. */
  values: { id: string, title: string }[] | null,
  /** The capability's own icon as an SVG data URL. Homey's standard capabilities have none. */
  icon: string | null,
};

export type ValueSlot =
  | { deviceId: string, capabilityId: string, name: string, capability: ValueCapability, value: unknown }
  | { deviceId: string, capabilityId: string, missing: true };

type Tracked = {
  key: string,
  deviceId: string,
  capabilityId: string,
  name: string,
  capability: ValueCapability,
  value: unknown,
  instance: any,
  lastRequested: number,
};

/** A slot setting's id: `<deviceId>:<capabilityId>`. */
export function parseSlot(slot: string): { deviceId: string, capabilityId: string } | null {
  const i = slot.indexOf(':');
  if (i <= 0 || i === slot.length - 1) return null;
  return { deviceId: slot.slice(0, i), capabilityId: slot.slice(i + 1) };
}

/** The device's capabilities a tile can show: readable numbers, booleans, enums and strings. */
export function valueCaps(device: any): string[] {
  const caps = device?.capabilitiesObj || {};
  return (device?.capabilities as string[] || Object.keys(caps))
    .filter(id => caps[id] && SHOWN_TYPES.has(caps[id].type) && caps[id].getable !== false);
}

function describe(cap: any, id: string): Omit<ValueCapability, 'icon'> {
  return {
    title: typeof cap.title === 'string' && cap.title ? cap.title : id,
    type: cap.type,
    units: typeof cap.units === 'string' && cap.units ? cap.units : null,
    decimals: typeof cap.decimals === 'number' ? cap.decimals : null,
    min: typeof cap.min === 'number' ? cap.min : null,
    max: typeof cap.max === 'number' ? cap.max : null,
    values: cap.type === 'enum' && Array.isArray(cap.values)
      ? cap.values.map((v: any) => ({ id: String(v.id), title: typeof v.title === 'string' && v.title ? v.title : String(v.id) }))
      : null,
  };
}

function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

/** The Device Values widget: one capability value per tile, kept live. */
export default class ValueService {

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

  // ---------------------------------------------------------------- settings autocomplete

  /** Every device × capability pair, as `Device · Capability`. */
  async listSlots(query: string): Promise<AutocompleteItem[]> {
    const api = await getAppApi(this.homey);
    const [devices, zones] = await Promise.all([
      api.devices.getDevices(),
      api.zones.getZones().catch(() => ({})),
    ]);
    const items: AutocompleteItem[] = [];
    for (const d of Object.values(devices) as any[]) {
      const zone = (zones as any)[d.zone]?.name as string | undefined;
      for (const id of valueCaps(d)) {
        const c = describe(d.capabilitiesObj[id], id);
        const name = `${d.name} · ${c.title}`;
        if (!matches(query, name, zone, id)) continue;
        items.push({ name, description: [zone, c.units].filter(Boolean).join(' · ') || undefined, id: `${d.id}:${id}` });
      }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- live state

  /** One entry per slot, in the order asked for. A deleted device or capability doesn't fail the others. */
  async getState(slots: string[]): Promise<ValueSlot[]> {
    const tm = new Timings();
    const out = await Promise.all(slots.map(async (slot): Promise<ValueSlot | null> => {
      const s = parseSlot(slot);
      if (!s) return null;
      try {
        const t = await this.current(s.deviceId, s.capabilityId, tm);
        t.lastRequested = Date.now();
        return { deviceId: t.deviceId, capabilityId: t.capabilityId, name: t.name, capability: { ...t.capability }, value: t.value };
      } catch (err) {
        this.log(`Value ${slot} unavailable:`, err);
        return { ...s, missing: true };
      }
    }));
    this.debug(`Values state for ${slots.length} slots: ${tm.summary()}`);
    return out.filter((x): x is ValueSlot => x !== null);
  }

  /** The tracked entry, re-read when it was already tracked, so a rename or a deleted device shows. */
  private async current(deviceId: string, capabilityId: string, tm: Timings): Promise<Tracked> {
    const t = this.tracked.get(`${deviceId}:${capabilityId}`);
    if (!t) return this.ensureTracked(deviceId, capabilityId, tm);
    const api = await getAppApi(this.homey);
    let device: any;
    try {
      device = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId, $cache: false }));
    } catch (err) {
      this.dispose(t);
      throw err;
    }
    const cap = device.capabilitiesObj?.[capabilityId];
    if (!cap) {
      this.dispose(t);
      throw new Error(`${device.name} has no capability ${capabilityId}`);
    }
    t.name = device.name;
    t.capability = { ...describe(cap, capabilityId), icon: t.capability.icon };
    t.value = cap.value ?? null;
    return t;
  }

  private ensureTracked(deviceId: string, capabilityId: string, tm: Timings): Promise<Tracked> {
    const key = `${deviceId}:${capabilityId}`;
    const existing = this.tracked.get(key);
    if (existing) return Promise.resolve(existing);
    let p = this.trackPromises.get(key);
    if (!p) {
      p = this.track(deviceId, capabilityId, tm).finally(() => this.trackPromises.delete(key));
      this.trackPromises.set(key, p);
    }
    return p;
  }

  private async track(deviceId: string, capabilityId: string, tm: Timings): Promise<Tracked> {
    const api = await tm.time('api', () => getAppApi(this.homey));
    const device: any = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId }));
    const cap = device.capabilitiesObj?.[capabilityId];
    if (!cap) throw new Error(`${device.name} has no capability ${capabilityId}`);
    const icon = await tm.time('icon', () => fetchSvgIcon(api, cap.iconObj, `${device.name} ${capabilityId}`, this.log));
    const key = `${deviceId}:${capabilityId}`;
    const t: Tracked = {
      key,
      deviceId,
      capabilityId,
      name: device.name,
      capability: { ...describe(cap, capabilityId), icon },
      value: cap.value ?? null,
      instance: null,
      lastRequested: Date.now(),
    };
    t.instance = device.makeCapabilityInstance(capabilityId, (value: unknown) => {
      t.value = value;
      this.homey.api.realtime(VALUES_STATE_EVENT, { deviceId, capabilityId, value });
    });
    this.tracked.set(key, t);
    this.debug(`Tracking value ${capabilityId} of ${device.name} (${deviceId}) = ${JSON.stringify(t.value)}`);
    return t;
  }

  private tick() {
    const now = Date.now();
    for (const t of this.tracked.values()) {
      if (now - t.lastRequested > IDLE_TIMEOUT) this.dispose(t);
    }
  }

  private dispose(t: Tracked) {
    try { t.instance?.destroy(); } catch (err) { /* ignore */ }
    if (this.tracked.get(t.key) === t) this.tracked.delete(t.key);
    this.debug(`Stopped tracking ${t.capabilityId} of ${t.name}`);
  }

}
