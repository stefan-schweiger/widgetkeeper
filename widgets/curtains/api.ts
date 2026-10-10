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
    logPerf(app, 'Curtains', query);
    return logged(app, 'Curtains state failed:', () => app.curtains.getState(idList(query.deviceIds)));
  },

  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, action?: unknown, position?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, `Curtain change failed, body: ${JSON.stringify(body)}`, async () => {
      if (!body?.deviceId) throw new Error('Missing deviceId');
      await app.curtains.set(body.deviceId, { action: body.action, position: body.position });
      return { ok: true };
    });
  },
};
