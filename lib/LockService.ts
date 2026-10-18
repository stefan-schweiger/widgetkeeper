import type Homey from 'homey';
import { getAppApi, lastUpdatedMs } from './appApi.js';
import { devicesAndZones, matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { describeCapability, presentCaps, readCaps, type CapState } from './capabilities.js';
import DeviceTracker, { type TrackedEntry } from './DeviceTracker.js';
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
  /** `open`: the capability that opens (unlatches) the lock, when the widget picked one and this lock has it. */
  | { id: string, name: string, icon: string | null, caps: Partial<Record<LockCapId, LockCap>>, open?: string }
  | { id: string, missing: true };

type Tracked = TrackedEntry & {
  icon: string | null,
  caps: Partial<Record<LockCapId, LockCap>>,
  /** `lockButtons()`: what the widget's Open button may set. */
  buttons: string[],
};

/** The lock capabilities the device has, in `LOCK_CAPS` order. */
export function lockCaps(device: any): LockCapId[] {
  return presentCaps(device, Object.keys(LOCK_CAPS) as LockCapId[]);
}

/**
 * A lock's other setable on/off capabilities: what may open (unlatch) it. Homey has no standard one (Matter's
 * `open_lock`, Shelly Loqed's `open` …), so the widget's `openCapability` setting picks one of these. None on a
 * device without `locked`.
 */
export function lockButtons(device: any): string[] {
  const caps = device?.capabilitiesObj || {};
  if (!caps.locked) return [];
  return Object.keys(caps).filter(id => !(id in LOCK_CAPS) && caps[id]?.type === 'boolean' && caps[id].setable !== false);
}

/** `readCaps()` of the lock capabilities, with when each last changed; only `SETTABLE_LOCK_CAPS` can be set. */
function readLockCaps(device: any): Partial<Record<LockCapId, LockCap>> {
  const out: Partial<Record<LockCapId, LockCap>> = {};
  for (const [id, c] of Object.entries(readCaps(device, Object.keys(LOCK_CAPS))) as [LockCapId, CapState][]) {
    out[id] = { ...c, setable: c.setable && SETTABLE_LOCK_CAPS.includes(id), lastUpdated: lastUpdatedMs(device.capabilitiesObj[id].lastUpdated) };
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
      signature: device => `${lockCaps(device).join()}|${lockButtons(device).join()}`,
      create: async (device) => {
        if (!lockCaps(device).length) throw new Error(`${device.name} has no lock, contact or garage door capability`);
        return { caps: readLockCaps(device), buttons: lockButtons(device) };
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
      refresh: (t, device) => { t.caps = readLockCaps(device); t.buttons = lockButtons(device); },
      label: t => `lock ${t.name}`,
      iconLog: log,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /**
   * One entry per device, in the order asked for. A deleted device doesn't fail the others. `openCap`: the widget's
   * Open capability; each lock that has it says so (`open`).
   */
  async getState(deviceIds: string[], openCap?: string | null): Promise<LockDevice[]> {
    const tm = new Timings();
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Lock device', (t, id): LockDevice => ({
      id, name: t.name, icon: t.icon, caps: Object.fromEntries(Object.entries(t.caps).map(([k, c]) => [k, { ...c }])),
      ...(openCap && t.buttons.includes(openCap) ? { open: openCap } : {}),
    }));
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

  /**
   * Opens (unlatches) a lock: sets one of its `lockButtons()` to true. As with `set()`, the widget's `allowUnlock`
   * can't be checked here.
   */
  async open(deviceId: string, capabilityId: unknown) {
    if (typeof capabilityId !== 'string' || !capabilityId) throw new Error(`Can't open with ${JSON.stringify(capabilityId)}`);
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    if (!device.capabilitiesObj?.locked) throw new Error(`${device.name} isn't a lock`);
    if (!lockButtons(device).includes(capabilityId)) throw new Error(`${device.name}'s ${capabilityId} can't open it`);
    await device.setCapabilityValue({ capabilityId, value: true });
    this.debug(`Lock ${device.name}: opened with ${capabilityId}`);
  }

  /**
   * The Open button's choices: every lock's `lockButtons()`, one item per capability id (its title, the id and the
   * locks with it), buttons (not getable) first, then "None".
   */
  async listOpenCapabilities(query: string): Promise<AutocompleteItem[]> {
    const found = new Map<string, { title: string, button: boolean, locks: string[] }>();
    const [devices] = await devicesAndZones(this.homey);
    for (const device of devices) {
      for (const id of lockButtons(device)) {
        const cap = device.capabilitiesObj[id];
        const entry = found.get(id) ?? { title: describeCapability(cap, id).title, button: cap.getable === false, locks: [] };
        entry.locks.push(device.name);
        found.set(id, entry);
      }
    }
    const items = [...found]
      .filter(([id, c]) => matches(query, c.title, id, ...c.locks))
      .sort(([a, x], [b, y]) => Number(y.button) - Number(x.button) || x.title.localeCompare(y.title) || a.localeCompare(b))
      .map(([id, c]) => ({ name: c.title, description: [id, c.locks.sort((a, b) => a.localeCompare(b)).join(', ')].join(' · '), id }));
    return withNone(this.homey.__('values.none') || 'None', query, items);
  }

}
