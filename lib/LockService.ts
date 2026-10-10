import type Homey from 'homey';
import { getAppApi, lastUpdatedMs } from './appApi.js';
import { presentCaps } from './capabilities.js';
import DeviceTracker, { type TrackedEntry } from './DeviceTracker.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import Timings from './Timings.js';

export const LOCKS_STATE_EVENT = 'locks:state';

/**
 * The capabilities the Locks widget reads, and the value of each that counts as secure: a lock that's
 * locked, a contact sensor that's closed, a garage door that's closed.
 */
export const LOCK_CAPS = { locked: true, alarm_contact: false, garagedoor_closed: true } as const;
export type LockCapId = keyof typeof LOCK_CAPS;
/** Only these can be set from the widget (a contact sensor can't). */
export const SETTABLE_LOCK_CAPS: LockCapId[] = ['locked', 'garagedoor_closed'];

export type LockCap = { value: unknown, setable: boolean, lastUpdated: number | null };

export type LockDevice =
  | { id: string, name: string, icon: string | null, caps: Partial<Record<LockCapId, LockCap>> }
  | { id: string, missing: true };

type Tracked = TrackedEntry & {
  name: string,
  icon: string | null,
  caps: Partial<Record<LockCapId, LockCap>>,
};

/** The lock capabilities the device has, in `LOCK_CAPS` order. */
export function lockCaps(device: any): LockCapId[] {
  return presentCaps(device, Object.keys(LOCK_CAPS) as LockCapId[]);
}

function readCaps(device: any): Partial<Record<LockCapId, LockCap>> {
  const out: Partial<Record<LockCapId, LockCap>> = {};
  for (const id of lockCaps(device)) {
    const c = device.capabilitiesObj[id];
    out[id] = {
      value: c.value ?? null,
      setable: SETTABLE_LOCK_CAPS.includes(id) && c.setable !== false,
      lastUpdated: lastUpdatedMs(c.lastUpdated),
    };
  }
  return out;
}

/** The Locks widget: locks, doors and garage doors, and whether they're all locked and closed. */
export default class LockService {

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Lock capabilities',
      signature: device => lockCaps(device).join(),
      create: async (device, api, tm) => {
        if (!lockCaps(device).length) throw new Error(`${device.name} has no lock, contact or garage door capability`);
        const icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log));
        return { name: device.name, icon, caps: readCaps(device) };
      },
      listen: (t, device) => {
        const instances = (Object.keys(t.caps) as LockCapId[]).map(id => device.makeCapabilityInstance(id, (value: unknown) => {
          const at = Date.now();
          const cap = t.caps[id];
          if (cap) {
            cap.value = value;
            cap.lastUpdated = at;
          }
          this.homey.api.realtime(LOCKS_STATE_EVENT, { deviceId: t.key, capabilityId: id, value, t: at });
        }));
        this.debug(`Tracking lock ${device.name} (${t.key}): ${JSON.stringify(Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, c.value])))}`);
        return instances;
      },
      refresh: async (t, device, api, tm) => {
        t.name = device.name;
        t.icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
        t.caps = readCaps(device);
      },
      label: t => `lock ${t.name}`,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<LockDevice[]> {
    const tm = new Timings();
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Lock device', (t, id): LockDevice => (
      { id, name: t.name, icon: t.icon, caps: Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }])) }
    ));
    this.debug(`Locks state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  /**
   * Locks or unlocks a lock, or closes or opens a garage door. Nothing else can be set. The widget's `allowUnlock`
   * can't be checked here (a widget API call doesn't carry its widget's settings); the caller is a signed-in user,
   * who can unlock it in the Homey app anyway.
   */
  async set(deviceId: string, capabilityId: unknown, value: unknown) {
    if (!SETTABLE_LOCK_CAPS.includes(capabilityId as LockCapId)) throw new Error(`Can't set ${JSON.stringify(capabilityId)}`);
    if (typeof value !== 'boolean') throw new Error(`Invalid value ${JSON.stringify(value)}`);
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    const cap = device.capabilitiesObj?.[capabilityId as string];
    if (!cap) throw new Error(`${device.name} has no ${capabilityId}`);
    if (cap.setable === false) throw new Error(`${device.name}'s ${capabilityId} can't be set`);
    await device.setCapabilityValue({ capabilityId, value });
    this.debug(`Lock ${device.name}: ${capabilityId}=${value}`);
  }

}
