import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  /**
   * The Electricity Overview's 49 hourly price slots (24 back, the current hour, 24 ahead), without a meter:
   * `{prices, fixedPrice, currency, language}`.
   */
  async getPrice({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Price badge widget: ${perf}`);
    const { prices, fixedPrice, currency, language } = await app.electricity.getSnapshot(null);
    return { prices, fixedPrice, currency, language };
  },
};
