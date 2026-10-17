import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { STATE_ALARMS, type SensorAlarm } from '../../lib/SensorAlarmService.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

/**
 * The alarms a dot shows: Sensor Alarms' states (motion, presence, contact and camera detections) and vibration
 * (wk-049: the Aqara lumi.vibration.aq1). Not `state`, since Sensor Alarms counts vibration as an alarm.
 */
export const ACTIVITY_CAPS = [...STATE_ALARMS, 'alarm_vibration'];

/** A device's alarms that are activity, sub-capabilities (`alarm_vibration.x`) included. */
export function activityAlarms(alarms: SensorAlarm[]): SensorAlarm[] {
  return alarms.filter(a => ACTIVITY_CAPS.includes(a.capabilityId.split('.')[0]));
}

export default {
  /** Sensor Alarms' state, with only the motion, presence, contact, vibration and camera detections of each device. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Sensor dots', query);
    return logged(app, 'Sensor dots state failed:', async () => {
      const devices = await app.sensorAlarms.getState(idList(query.deviceIds));
      return {
        devices: devices.map(d => ('missing' in d ? d : { ...d, alarms: activityAlarms(d.alarms) })),
        language: homey.i18n.getLanguage(),
      };
    });
  },
};
