import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  /** Sensor Alarms' state, with only the motion, contact and camera detections of each device. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Sensor dots', query);
    return logged(app, 'Sensor dots state failed:', async () => {
      const devices = await app.sensorAlarms.getState(idList(query.deviceIds));
      return {
        devices: devices.map(d => ('missing' in d ? d : { ...d, alarms: d.alarms.filter(a => a.state) })),
        language: homey.i18n.getLanguage(),
      };
    });
  },
};
