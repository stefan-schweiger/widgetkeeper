import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  /**
   * The Electricity Overview's hourly price slots (24 back, the current hour, 24 ahead; 36 with `hours=36`),
   * without a meter: `{prices, fixedPrice, currency, language}`. `costs=0`: the bare spot prices.
   */
  async getPrice({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Price badge', query);
    const { prices, priceError, fixedPrice, currency, language } = await app.electricity.getSnapshot(null, {
      costs: query.costs !== '0',
      futureHours: query.hours === '36' ? 36 : 24,
    });
    // A failed read is an error (the widget keeps the last prices), not "set them up in Homey Energy".
    const current = prices[24]; // the current hour
    if (priceError && current?.price == null) throw new Error(`Could not read the prices: ${priceError}`);
    return { prices, fixedPrice, currency, language };
  },
};
