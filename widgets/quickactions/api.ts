import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Quick actions', query);
    return logged(app, 'Quick actions state failed:', () => app.quickActions.getState(idList(query.deviceIds)));
  },

  async trigger({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, value?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, `Quick action failed, body: ${JSON.stringify(body)}`, async () => {
      if (!body?.deviceId) throw new Error('Missing deviceId');
      await app.quickActions.trigger(body.deviceId, body.value);
      return { ok: true };
    });
  },
};
