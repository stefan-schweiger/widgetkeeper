import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  /**
   * The Electricity Overview's 49 hourly price slots (24 back, the current hour, 24 ahead), without a meter:
   * `{prices, fixedPrice, currency, language}`. `costs=0`: the bare spot prices.
   */
  async getPrice({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Price badge', query);
    const { prices, priceError, fixedPrice, currency, language } = await app.electricity.getSnapshot(null, { costs: query.costs !== '0' });
    // A failed read is an error (the widget keeps the last prices), not "set them up in Homey Energy".
    const current = prices[Math.floor(prices.length / 2)];
    if (priceError && current?.price == null) throw new Error(`Could not read the prices: ${priceError}`);
    return { prices, fixedPrice, currency, language };
  },
};
