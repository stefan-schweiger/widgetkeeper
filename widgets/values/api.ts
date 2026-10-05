import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  /** `slots`: comma-separated `<deviceId>:<capabilityId>`. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const slots = (query.slots || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Device values widget: ${perf}`);
    try {
      return await app.values.getState(slots);
    } catch (err) {
      app.log('Device values state failed:', err);
      throw err;
    }
  },
};
