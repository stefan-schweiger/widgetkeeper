import type Homey from 'homey';
import { devicesAndZones, matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { describeCapability } from './capabilities.js';
import DeviceTracker, { readZones, zoneRef, type TrackedEntry } from './DeviceTracker.js';
import Timings from './Timings.js';

export const VM_STATE_EVENT = 'valuematrix:state';

/** A column: one capability id, described from the first picked device that has it. */
export type MatrixColumn = { capabilityId: string, title: string, units: string | null, decimals: number | null };

export type MatrixDevice =
  | { id: string, name: string, zone: { id: string, name: string } | null, values: Record<string, number | null> }
  | { id: string, missing: true };

export type MatrixState = { columns: (MatrixColumn | null)[], devices: MatrixDevice[] };

type Tracked = TrackedEntry & {
  deviceId: string,
  capabilityId: string,
  zone: string | null,
  /** The device hasn't the capability as a number: a striped cell. */
  absent: boolean,
  column: MatrixColumn | null,
  value: number | null,
};

/** A tracker key, `<deviceId>:<capabilityId>`: device ids have no colon, so the first one splits it. */
function keyOf(key: string): { deviceId: string, capabilityId: string } {
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) throw new Error(`Not a matrix cell (<deviceId>:<capabilityId>): ${key}`);
  return { deviceId: key.slice(0, i), capabilityId: key.slice(i + 1) };
}

/** The device's number capabilities that can be read: what a column can show. */
export function matrixCaps(device: any): string[] {
  const caps = device?.capabilitiesObj || {};
  return Object.keys(caps).filter(id => caps[id]?.type === 'number' && caps[id].getable !== false);
}

const toNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function columnOf(device: any, capabilityId: string): MatrixColumn | null {
  if (!matrixCaps(device).includes(capabilityId)) return null;
  const c = describeCapability(device.capabilitiesObj[capabilityId], capabilityId);
  return { capabilityId, title: c.title, units: c.units, decimals: c.decimals };
}

/**
 * The Value Matrix widget: the picked devices as rows (the widget groups them into rooms) and a capability per column.
 * Each cell is tracked on its own, like a Device Values tile; a device without the capability is a cell marked absent.
 */
export default class ValueMatrixService {

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      deviceId: key => keyOf(key).deviceId,
      what: 'Matrix capability',
      // Whether the device has it: one that gains or loses it is tracked again.
      signature: (device, key) => (columnOf(device, keyOf(key).capabilityId) ? 'number' : ''),
      create: async (device, api, tm, key) => {
        const { deviceId, capabilityId } = keyOf(key);
        const column = columnOf(device, capabilityId);
        return {
          deviceId, capabilityId, zone: device.zone ?? null, absent: !column, column,
          value: column ? toNumber(device.capabilitiesObj[capabilityId].value) : null,
        };
      },
      listen: (t, device) => {
        if (t.absent) return [];
        const { deviceId, capabilityId } = t;
        this.debug(`Tracking matrix value ${capabilityId} of ${device.name} (${deviceId}) = ${t.value}`);
        return [device.makeCapabilityInstance(capabilityId, (raw: unknown) => {
          const value = toNumber(raw);
          t.value = value;
          this.homey.api.realtime(VM_STATE_EVENT, { deviceId, capabilityId, value });
        })];
      },
      refresh: (t, device) => {
        t.zone = device.zone ?? null;
        t.column = columnOf(device, t.capabilityId);
        t.value = t.column ? toNumber(device.capabilitiesObj[t.capabilityId].value) : null;
      },
      label: t => `matrix value ${t.capabilityId} of ${t.name}`,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /**
   * Every number capability on the Homey, by id (a column shows it for each device that has it), named by its title
   * and described by its units and how many devices have it; `None` first.
   */
  async listColumns(query: string): Promise<AutocompleteItem[]> {
    const [devices] = await devicesAndZones(this.homey);
    const byId = new Map<string, { title: string, units: string | null, count: number }>();
    for (const d of devices) {
      for (const id of matrixCaps(d)) {
        const seen = byId.get(id);
        if (seen) { seen.count++; continue; }
        const c = describeCapability(d.capabilitiesObj[id], id);
        byId.set(id, { title: c.title, units: c.units, count: 1 });
      }
    }
    const items: AutocompleteItem[] = [];
    for (const [id, c] of byId) {
      if (!matches(query, c.title, id, c.units ?? undefined)) continue;
      const count = this.homey.__('valuematrix.devices', { count: c.count }) || `${c.count} devices`;
      items.push({ name: c.title, description: [c.units, count].filter(Boolean).join(' · '), id });
    }
    items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return withNone(this.homey.__('valuematrix.none') || 'None', query, items);
  }

  /**
   * The columns (described from the first device that has each, null when none does) and one entry per device in the
   * order asked for: its zone and a value per column it has. A deleted device doesn't fail the others.
   */
  async getState(deviceIds: string[], capabilityIds: string[]): Promise<MatrixState> {
    const tm = new Timings();
    const zonesP = readZones(this.homey, tm, this.log, 'Value matrix');
    const reads = await Promise.all(deviceIds.map(id => this.tracker.each(capabilityIds.map(c => `${id}:${c}`), tm, this.log, 'Matrix value', t => t)));
    const zones = await zonesP;
    const devices = deviceIds.map((id, i): MatrixDevice => {
      const read = reads[i].filter((c): c is Tracked => !('missing' in c));
      if (!read.length && capabilityIds.length) return { id, missing: true };
      const values: Record<string, number | null> = {};
      for (const t of read) {
        if (!t.absent) values[t.capabilityId] = t.value;
      }
      return { id, name: read[0]?.name ?? '', zone: zoneRef(zones, read[0]?.zone ?? null), values };
    });
    // Each column described by the first device (in the order picked) that has it.
    const columns = capabilityIds.map((c) => {
      for (const list of reads) {
        const t = list.find((x): x is Tracked => !('missing' in x) && x.capabilityId === c && !!x.column);
        if (t) return { ...t.column! };
      }
      return null;
    });
    this.debug(`Value matrix state for ${deviceIds.length} devices × ${capabilityIds.length} values: ${tm.summary()}`);
    return { columns, devices };
  }

}
