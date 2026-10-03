import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  async getSnapshot({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.log(`Electricity widget: ${perf}`);
    return app.electricity.getSnapshot(query.deviceId || null);
  },
};
