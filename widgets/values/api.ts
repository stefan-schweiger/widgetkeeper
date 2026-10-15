import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';
import { tileNameRoutes } from '../../lib/TileNameService.js';

type Homey = App['homey'];

export default {
  ...tileNameRoutes,

  /** `slots`: comma-separated `<deviceId>:<capabilityId>`. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Device values', query);
    return logged(app, 'Device values state failed:', () => app.values.getState(idList(query.slots)));
  },
};
