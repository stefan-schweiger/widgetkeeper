import type Homey from 'homey';
import { devicesAndZones, listCapabilitySlots, matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { describeCapability, type CapabilityDescription } from './capabilities.js';
import DeviceTracker, { type TrackedEntry } from './DeviceTracker.js';
import { fetchSvgIcon } from './deviceIcon.js';
import Timings from './Timings.js';

export const VALUES_STATE_EVENT = 'values:state';
export const VALUES_COLOR_EVENT = 'values:color';
/** The app setting holding the tile colours set by Flows: `{ '<deviceId>:<capabilityId>': colour }`. */
export const VALUE_COLORS_SETTING = 'valueColors';
/** The colours a Flow can give a tile. `default` (not stored) resets it. */
export const TILE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type TileColor = typeof TILE_COLORS[number];

const SHOWN_TYPES = new Set(['number', 'boolean', 'enum', 'string']);

export type ValueCapability = CapabilityDescription & {
  /** The capability's own icon as an SVG data URL. Homey's standard capabilities have none. */
  icon: string | null,
};

/** A tile's second value: another capability of the same device, shown small beside the name. */
export type ValueSecond = { capabilityId: string, capability: ValueCapability, value: unknown };

export type ValueSlot =
  | { deviceId: string, capabilityId: string, name: string, capability: ValueCapability, value: unknown, color?: TileColor, second?: ValueSecond }
  | { deviceId: string, capabilityId: string, missing: true };

type Tracked = TrackedEntry & {
  deviceId: string,
  capabilityId: string,
  capability: ValueCapability,
  value: unknown,
};

/** A slot setting's id: `<deviceId>:<capabilityId>`. */
export function parseSlot(slot: string): { deviceId: string, capabilityId: string } | null {
  const i = slot.indexOf(':');
  if (i <= 0 || i === slot.length - 1) return null;
  return { deviceId: slot.slice(0, i), capabilityId: slot.slice(i + 1) };
}

/** `parseSlot()` for a tracker key, which must be a valid slot: anything else throws a clear error. */
function slotOf(key: string): { deviceId: string, capabilityId: string } {
  const s = parseSlot(key);
  if (!s) throw new Error(`Not a slot (<deviceId>:<capabilityId>): ${key}`);
  return s;
}

/** The device's capabilities a tile can show: readable numbers, booleans, enums and strings. */
export function valueCaps(device: any): string[] {
  const caps = device?.capabilitiesObj || {};
  return (device?.capabilities as string[] || Object.keys(caps))
    .filter(id => caps[id] && SHOWN_TYPES.has(caps[id].type) && caps[id].getable !== false);
}

/** The Device Values widget: one capability value per tile, kept live. */
export default class ValueService {

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    // One entry per `<deviceId>:<capabilityId>`, re-read on each request, so a rename or a deleted device shows.
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      deviceId: key => slotOf(key).deviceId,
      what: 'Value',
      signature: () => '', // one capability: a re-read without it fails in `refresh`
      create: async (device, api, tm, key) => {
        const { deviceId, capabilityId } = slotOf(key);
        const cap = device.capabilitiesObj?.[capabilityId];
        if (!cap) throw new Error(`${device.name} has no capability ${capabilityId}`);
        const icon = await tm.time('icon', () => fetchSvgIcon(api, cap.iconObj, `${device.name} ${capabilityId}`, this.log));
        return {
          deviceId,
          capabilityId,
          capability: { ...describeCapability(cap, capabilityId), icon },
          value: cap.value ?? null,
        };
      },
      listen: (t, device) => {
        const { deviceId, capabilityId } = t;
        this.debug(`Tracking value ${capabilityId} of ${device.name} (${deviceId}) = ${JSON.stringify(t.value)}`);
        return [device.makeCapabilityInstance(capabilityId, (value: unknown) => {
          t.value = value;
          this.homey.api.realtime(VALUES_STATE_EVENT, { deviceId, capabilityId, value });
        })];
      },
      refresh: (t, device) => {
        const cap = device.capabilitiesObj?.[t.capabilityId];
        if (!cap) throw new Error(`${device.name} has no capability ${t.capabilityId}`);
        t.capability = { ...describeCapability(cap, t.capabilityId), icon: t.capability.icon };
        t.value = cap.value ?? null;
      },
      label: t => `${t.capabilityId} of ${t.name}`,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }
  // ---------------------------------------------------------------- settings autocomplete

  /** Every device × capability pair, as `Device · Capability`, with `None` first. */
  listSlots(query: string): Promise<AutocompleteItem[]> {
    return listCapabilitySlots(this.homey, query, valueCaps);
  }

  /**
   * A tile's second value (`secondN`): the other values of the device picked in Tile N (`slot`, its id), by
   * capability title, with `None` first. Without a device in Tile N there's only `None`, saying to pick it first.
   */
  async listSecondValues(slot: string | undefined, query: string, tile: number): Promise<AutocompleteItem[]> {
    const none = this.homey.__('values.none') || 'None';
    const s = parseSlot(slot || '');
    const [devices] = s ? await devicesAndZones(this.homey) : [[]];
    const device = s && devices.find(d => d.id === s.deviceId);
    if (!s || !device) return [{ name: none, description: this.homey.__('values.pickTileFirst', { n: tile }), id: 'none' }];
    const items: AutocompleteItem[] = [];
    for (const id of valueCaps(device)) {
      if (id === s.capabilityId) continue;
      const c = describeCapability(device.capabilitiesObj[id], id);
      if (matches(query, c.title, id)) items.push({ name: c.title, description: c.units || undefined, id: `${device.id}:${id}` });
    }
    return withNone(none, query, items);
  }
  // ---------------------------------------------------------------- tile colours (Flow)

  /** The colours set by Flows, per `<deviceId>:<capabilityId>`. Kept in an app setting, so they survive restarts. */
  private colors(): Record<string, TileColor> {
    const v = this.homey.settings.get(VALUE_COLORS_SETTING);
    return v && typeof v === 'object' ? v : {};
  }

  /**
   * The Flow card "Set the tile colour of … to …": every tile showing that device value takes the colour
   * (a Flow can't address a widget instance). `default` removes it.
   */
  setColor(slot: string, color: string) {
    const s = parseSlot(slot);
    if (!s) throw new Error(`Not a device value: ${slot}`);
    const next = color === 'default' ? null : (TILE_COLORS as readonly string[]).includes(color) ? color as TileColor : undefined;
    if (next === undefined) throw new Error(`Unknown colour: ${color}`);
    const colors = { ...this.colors() };
    if ((colors[slot] ?? null) === next) return; // the tiles have it already
    if (next) colors[slot] = next;
    else delete colors[slot];
    this.homey.settings.set(VALUE_COLORS_SETTING, colors);
    this.homey.api.realtime(VALUES_COLOR_EVENT, { ...s, color: next });
    this.debug(`Tile colour of ${slot} set to ${color}`);
  }

  /** The Flow card's device value argument: the settings' list without `None`. */
  async listColorSlots(query: string): Promise<AutocompleteItem[]> {
    return (await this.listSlots(query)).filter(i => i.id !== 'none');
  }

  // ---------------------------------------------------------------- live state

  /**
   * One entry per slot, in the order asked for. A deleted device or capability doesn't fail the others. `seconds[i]`
   * is slot i's second value, a capability id of the same device; one that can't be read is left out of the entry.
   */
  async getState(slots: string[], seconds: (string | undefined)[] = []): Promise<ValueSlot[]> {
    const tm = new Timings();
    const colors = this.colors();
    const out = await Promise.all(slots.map(async (slot, i): Promise<ValueSlot | null> => {
      const s = parseSlot(slot);
      if (!s) return null;
      try {
        const t = await this.tracker.current(`${s.deviceId}:${s.capabilityId}`, tm);
        const color = colors[t.key];
        const second = await this.second(s.deviceId, seconds[i], s.capabilityId, tm);
        return {
          deviceId: t.deviceId, capabilityId: t.capabilityId, name: t.name, capability: { ...t.capability }, value: t.value,
          ...(color ? { color } : {}), ...(second ? { second } : {}),
        };
      } catch (err) {
        this.log(`Value ${slot} unavailable:`, err);
        return { ...s, missing: true };
      }
    }));
    this.debug(`Values state for ${slots.length} slots: ${tm.summary()}`);
    return out.filter((x): x is ValueSlot => x !== null);
  }

  /** A slot's second value, tracked like a slot of its own, or null for none, its own capability or one that can't be read. */
  private async second(deviceId: string, capabilityId: string | undefined, first: string, tm: Timings): Promise<ValueSecond | null> {
    if (!capabilityId || capabilityId === first) return null;
    try {
      const t = await this.tracker.current(`${deviceId}:${capabilityId}`, tm);
      return { capabilityId: t.capabilityId, capability: { ...t.capability }, value: t.value };
    } catch (err) {
      this.log(`Second value ${deviceId}:${capabilityId} unavailable:`, err);
      return null;
    }
  }

}
