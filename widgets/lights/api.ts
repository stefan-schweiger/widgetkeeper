import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import type { LightChange } from '../../lib/LightService.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Lights', query);
    return logged(app, 'Lights state failed:', () => app.lights.getState(idList(query.deviceIds)));
  },

  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string } & LightChange,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, `Light change failed, body: ${JSON.stringify(body)}`, async () => {
      if (!body?.deviceId) throw new Error('Missing deviceId');
      await app.lights.set(body.deviceId, { dim: body.dim, onoff: body.onoff, temperature: body.temperature, hue: body.hue, saturation: body.saturation });
      return { ok: true };
    });
  },
};
