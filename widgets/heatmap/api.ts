import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  async getHistory({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Heatmap', query);
    if (!query.deviceId || !query.capabilityId) throw new Error('deviceId and capabilityId are required');
    return logged(app, 'Heatmap history failed:', () => app.heatmap.getHistory(query.deviceId, query.capabilityId, Number(query.days) || 7));
  },
};
