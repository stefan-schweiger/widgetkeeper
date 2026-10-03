import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;

export const SA_STATE_EVENT = 'sensoralarms:state';

/**
 * Alarms that report a state (someone moved, a door opened) rather than a fault; the widget setting decides.
 * Cameras' person, vehicle and pet detections are motion too.
 */
const STATE_ALARMS = new Set(['alarm_motion', 'alarm_contact', 'alarm_person', 'alarm_vehicle', 'alarm_pet']);

export type SensorAlarm = {
  capabilityId: string,
  title: string,
  value: boolean | null,
  /** Motion, contact or a camera detection: only counted when the widget's `includeStates` setting is on. */
  state: boolean,
};

export type SensorAlarmDevice =
  | { id: string, name: string, icon: string | null, alarms: SensorAlarm[] }
  | { id: string, missing: true };

type Tracked = {
  deviceId: string,
  name: string,
  icon: string | null,
  alarms: SensorAlarm[],
  instances: any[],
  lastRequested: number,
};

/** Every boolean `alarm_*` capability of the device, custom ones (e.g. `alarm_radon`) included. */
export function alarmCaps(device: any): SensorAlarm[] {
  const caps = device?.capabilitiesObj || {};
  return Object.keys(caps)
    .filter(id => id.split('.')[0].startsWith('alarm_') && caps[id]?.type === 'boolean')
    .map(id => ({
      capabilityId: id,
      title: typeof caps[id].title === 'string' && caps[id].title ? caps[id].title : id,
      value: typeof caps[id].value === 'boolean' ? caps[id].value : null,
      state: STATE_ALARMS.has(id.split('.')[0]),
    }));
}

const sameIds = (a: SensorAlarm[], b: SensorAlarm[]) =>
  a.length === b.length && a.every((x, i) => x.capabilityId === b[i].capabilityId);

export default class SensorAlarmService {

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

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<SensorAlarmDevice[]> {
    const tm = new Timings();
    const out = await Promise.all(deviceIds.map(async (id): Promise<SensorAlarmDevice> => {
      try {
        const t = await this.current(id, tm);
        t.lastRequested = Date.now();
        return { id, name: t.name, icon: t.icon, alarms: t.alarms.map(a => ({ ...a })) };
      } catch (err) {
        this.log(`Sensor alarm device ${id} unavailable:`, err);
        return { id, missing: true };
      }
    }));
    this.debug(`Sensor alarms state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  // ---------------------------------------------------------------- live state

  /**
   * The tracked entry, re-read from the device when it was already tracked: an open widget keeps the
   * entry alive indefinitely, so a rename, new alarm capabilities or a deleted device would otherwise never show.
   */
  private async current(deviceId: string, tm: Timings): Promise<Tracked> {
    const t = this.tracked.get(deviceId);
    if (!t) return this.ensureTracked(deviceId, tm);
    const api = await getAppApi(this.homey);
    let device: any;
    try {
      device = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId, $cache: false }));
    } catch (err) {
      this.dispose(t);
      throw err;
    }
    const alarms = alarmCaps(device);
    if (!sameIds(alarms, t.alarms)) {
      this.debug(`Alarm capabilities of ${device.name} changed`);
      this.dispose(t);
      return this.ensureTracked(deviceId, tm);
    }
    t.name = device.name;
    t.icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
    t.alarms = alarms;
    return t;
  }

  private ensureTracked(deviceId: string, tm: Timings): Promise<Tracked> {
    const existing = this.tracked.get(deviceId);
    if (existing) return Promise.resolve(existing);
    let p = this.trackPromises.get(deviceId);
    if (!p) {
      p = this.track(deviceId, tm).finally(() => this.trackPromises.delete(deviceId));
      this.trackPromises.set(deviceId, p);
    }
    return p;
  }

  private async track(deviceId: string, tm: Timings): Promise<Tracked> {
    const api = await tm.time('api', () => getAppApi(this.homey));
    const device: any = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId }));
    const icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log));
    const t: Tracked = {
      deviceId,
      name: device.name,
      icon,
      alarms: alarmCaps(device),
      instances: [],
      lastRequested: Date.now(),
    };
    for (const { capabilityId } of t.alarms) {
      t.instances.push(device.makeCapabilityInstance(capabilityId, (value: unknown) => {
        const a = t.alarms.find(x => x.capabilityId === capabilityId);
        if (a) a.value = typeof value === 'boolean' ? value : null;
        this.homey.api.realtime(SA_STATE_EVENT, { deviceId, capabilityId, value });
      }));
    }
    this.tracked.set(deviceId, t);
    this.debug(`Tracking alarms of ${device.name} (${deviceId}): ${t.alarms.map(a => `${a.capabilityId}=${a.value}`).join(', ') || 'none'}`);
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
      try { i?.destroy(); } catch (err) { /* ignore */ }
    }
    if (this.tracked.get(t.deviceId) === t) this.tracked.delete(t.deviceId);
    this.debug(`Stopped tracking ${t.name}`);
  }

}
