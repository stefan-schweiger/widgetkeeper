import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf, requireId } from '../../lib/widgetApi.js';
import { tileNameRoutes, withTileNames } from '../../lib/TileNameService.js';

type Homey = App['homey'];

export default {
  ...tileNameRoutes,

  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Quick actions', query);
    return withTileNames(homey, query, logged(app, 'Quick actions state failed:', () => app.quickActions.getState(idList(query.deviceIds))));
  },

  async trigger({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, value?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, () => `Quick action failed, body: ${JSON.stringify(body)}`, async () => {
      await app.quickActions.trigger(requireId(body?.deviceId, 'deviceId'), body.value);
      return { ok: true };
    });
  },
};
