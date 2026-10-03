import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  async getForecast({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Weather widget: ${perf}`);
    try {
      return await app.weather.getForecast();
    } catch (err) {
      app.log('Weather forecast failed:', err);
      throw err;
    }
  },
};
