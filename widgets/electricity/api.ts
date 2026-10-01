import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';

type Homey = App['homey'];

export default {
  async getSnapshot({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return app.electricity.getSnapshot(query.deviceId || null);
  },
};
