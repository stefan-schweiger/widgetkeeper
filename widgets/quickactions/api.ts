import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const ids = (query.deviceIds || '').split(',').filter(Boolean);
    try {
      return await app.quickActions.getState(ids);
    } catch (err) {
      app.log('Quick actions state failed:', err);
      throw err;
    }
  },

  async trigger({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, value?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    try {
      if (!body?.deviceId) throw new Error('Missing deviceId');
      await app.quickActions.trigger(body.deviceId, body.value);
      return { ok: true };
    } catch (err) {
      app.log('Quick action failed, body:', JSON.stringify(body), err);
      throw err;
    }
  },
};
