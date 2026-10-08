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
    const { prices, priceError, fixedPrice, currency, language } = await app.electricity.getSnapshot(null);
    // A failed read is an error (the widget keeps the last prices), not "set them up in Homey Energy".
    const current = prices[Math.floor(prices.length / 2)];
    if (priceError && current?.price == null) throw new Error(`Could not read the prices: ${priceError}`);
    return { prices, fixedPrice, currency, language };
  },
};
