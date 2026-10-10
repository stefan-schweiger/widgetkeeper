import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  async getSnapshot({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Electricity', query);
    return app.electricity.getSnapshot(query.deviceId || null, { costs: query.costs !== '0' });
  },
};
