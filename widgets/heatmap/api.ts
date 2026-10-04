import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  async getHistory({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Heatmap widget: ${perf}`);
    if (!query.deviceId || !query.capabilityId) throw new Error('deviceId and capabilityId are required');
    try {
      return await app.heatmap.getHistory(query.deviceId, query.capabilityId, Number(query.days) || 7);
    } catch (err) {
      app.log('Heatmap history failed:', err);
      throw err;
    }
  },
};
