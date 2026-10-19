import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';
import { tileNameRoutes, withTileNames } from '../../lib/TileNameService.js';

type Homey = App['homey'];

export default {
  ...tileNameRoutes,

  /**
   * `ids`: comma-separated web dashboard ids. Answers `{current, tiles}`: the dashboard holding this widget instance
   * (`instance`, `web-<dashboard>-<widget>`) and each dashboard's name; with `instance` inside `{state, tileNames}`.
   */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Dashboard shortcuts', query);
    return withTileNames(homey, query, logged(app, 'Dashboard shortcuts state failed:', async () => app.web.shortcuts(idList(query.ids), query.instance)));
  },
};
