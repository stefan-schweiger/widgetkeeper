import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  /** Sensor Alarms' state, with only the motion, contact and camera detections of each device. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const ids = (query.deviceIds || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Sensor dots widget: ${perf}`);
    try {
      const devices = await app.sensorAlarms.getState(ids);
      return {
        devices: devices.map(d => ('missing' in d ? d : { ...d, alarms: d.alarms.filter(a => a.state) })),
        language: homey.i18n.getLanguage(),
      };
    } catch (err) {
      app.log('Sensor dots state failed:', err);
      throw err;
    }
  },
};
