import type Homey from 'homey';
import { getAppApi, lastUpdatedMs } from './appApi.js';
import DeviceTracker, { type TrackedEntry } from './DeviceTracker.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import Timings from './Timings.js';

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
  /** When the value last changed (ms), from the capability's `lastUpdated`. */
  lastUpdated: number | null,
};

export type SensorAlarmDevice =
  | { id: string, name: string, icon: string | null, alarms: SensorAlarm[] }
  | { id: string, missing: true };

type Tracked = TrackedEntry & {
  name: string,
  icon: string | null,
  alarms: SensorAlarm[],
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
      lastUpdated: lastUpdatedMs(caps[id].lastUpdated),
    }));
}

export default class SensorAlarmService {

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    // An open widget keeps its entries alive indefinitely, so each request re-reads the device: a rename, new alarm
    // capabilities or a deleted device would otherwise never show.
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Alarm capabilities',
      signature: device => alarmCaps(device).map(a => a.capabilityId).join(),
      create: async (device, api, tm) => {
        const icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log));
        return { name: device.name, icon, alarms: alarmCaps(device) };
      },
      listen: (t, device) => {
        const instances = t.alarms.map(({ capabilityId }) => device.makeCapabilityInstance(capabilityId, (value: unknown) => {
          const now = Date.now();
          const a = t.alarms.find(x => x.capabilityId === capabilityId);
          if (a) {
            a.value = typeof value === 'boolean' ? value : null;
            a.lastUpdated = now;
          }
          this.homey.api.realtime(SA_STATE_EVENT, { deviceId: t.key, capabilityId, value, t: now });
        }));
        this.debug(`Tracking alarms of ${device.name} (${t.key}): ${t.alarms.map(a => `${a.capabilityId}=${a.value}`).join(', ') || 'none'}`);
        return instances;
      },
      refresh: async (t, device, api, tm) => {
        t.name = device.name;
        t.icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
        t.alarms = alarmCaps(device);
      },
      label: t => t.name,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<SensorAlarmDevice[]> {
    const tm = new Timings();
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Sensor alarm device', (t, id): SensorAlarmDevice => (
      { id, name: t.name, icon: t.icon, alarms: t.alarms.map(a => ({ ...a })) }
    ));
    this.debug(`Sensor alarms state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

}
