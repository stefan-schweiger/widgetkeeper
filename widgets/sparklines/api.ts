import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  /** `slots`: comma-separated `<deviceId>:<capabilityId>`; `span`: `1h`, `6h`, `24h`, `2d`, `3d`, `5d` or `7d`. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Sparklines', query);
    return logged(app, 'Sparklines state failed:', () => app.sparklines.getState(idList(query.slots), query.span));
  },
};
