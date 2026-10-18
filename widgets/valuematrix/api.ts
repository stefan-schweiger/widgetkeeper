import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';
import { tileNameRoutes, withTileNames } from '../../lib/TileNameService.js';

type Homey = App['homey'];

export default {
  ...tileNameRoutes,

  /** `deviceIds` and `capabilityIds` (the columns, in order): comma-separated. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Value matrix', query);
    return withTileNames(homey, query, logged(app, 'Value matrix state failed:', () => app.valueMatrix.getState(idList(query.deviceIds), idList(query.capabilityIds))));
  },
};
