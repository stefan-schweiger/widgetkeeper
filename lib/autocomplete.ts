import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { describeCapability } from './capabilities.js';

/** An item of a widget setting's or a Flow card argument's autocomplete. */
export type AutocompleteItem = { name: string, description?: string, image?: string, id: string };

/** Whether any of the texts contains the query (case-insensitive); an empty query matches everything. */
export function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

/** "None" first (id `none`, which the widgets skip), so a slot can be emptied again; left out when the query doesn't match it. */
export function withNone(none: string, query: string, items: AutocompleteItem[]): AutocompleteItem[] {
  return matches(query, none) ? [{ name: none, id: 'none' }, ...items] : items;
}

/** Every device and the zones, for the lists below. A failed zone read only loses the descriptions. */
async function devicesAndZones(homey: Homey.App['homey']): Promise<[any[], Record<string, any>]> {
  const api = await getAppApi(homey);
  const [devices, zones] = await Promise.all([
    api.devices.getDevices(),
    api.zones.getZones().catch(() => ({})),
  ]);
  return [Object.values(devices) as any[], zones as Record<string, any>];
}

/** The devices that pass `filter`, by name, described by their zone. */
export async function listDevicesWhere(homey: Homey.App['homey'], query: string, filter: (device: any) => boolean): Promise<AutocompleteItem[]> {
  const [devices, zones] = await devicesAndZones(homey);
  return devices
    .filter(filter)
    .map(d => ({ name: d.name as string, description: zones[d.zone]?.name as string | undefined, id: d.id as string }))
    .filter(d => matches(query, d.name, d.description))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every device × capability pair that `capsOf` gives, as `Device · Capability` with the id `<deviceId>:<capabilityId>`,
 * described by the zone and the units. "None" first, so a tile can be emptied again: its id has no colon, so the
 * widget skips the slot.
 */
export async function listCapabilitySlots(homey: Homey.App['homey'], query: string, capsOf: (device: any) => string[]): Promise<AutocompleteItem[]> {
  const [devices, zones] = await devicesAndZones(homey);
  const items: AutocompleteItem[] = [];
  for (const d of devices) {
    const zone = zones[d.zone]?.name as string | undefined;
    for (const id of capsOf(d)) {
      const c = describeCapability(d.capabilitiesObj[id], id);
      const name = `${d.name} · ${c.title}`;
      if (!matches(query, name, zone, id)) continue;
      items.push({ name, description: [zone, c.units].filter(Boolean).join(' · ') || undefined, id: `${d.id}:${id}` });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return withNone(homey.__('values.none') || 'None', query, items);
}
