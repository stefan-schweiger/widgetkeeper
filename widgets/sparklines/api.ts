import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  /** `slots`: comma-separated `<deviceId>:<capabilityId>`; `span`: `1h`, `6h`, `24h`, `2d`, `3d`, `5d` or `7d`. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const slots = (query.slots || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Sparklines widget: ${perf}`);
    try {
      return await app.sparklines.getState(slots, query.span);
    } catch (err) {
      app.log('Sparklines state failed:', err);
      throw err;
    }
  },
};
