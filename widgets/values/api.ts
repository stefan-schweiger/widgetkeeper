import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';
import { tileNameRoutes, withTileNames } from '../../lib/TileNameService.js';

type Homey = App['homey'];

export default {
  ...tileNameRoutes,

  /**
   * `slots`: comma-separated `<deviceId>:<capabilityId>`. `seconds` (optional): each slot's second value, a capability id of
   * the same device, comma-separated in the slots' order (empty for none).
   */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Device values', query);
    return withTileNames(homey, query, logged(app, 'Device values state failed:', () => app.values.getState(idList(query.slots), (query.seconds || '').split(','))));
  },
};
