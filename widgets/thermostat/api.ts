import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import type { CapValue } from '../../lib/ThermostatService.js';
import { logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!query.deviceId) throw new Error('Missing deviceId');
    logPerf(app, 'Thermostat', query);
    return logged(app, 'Thermostat state failed:', () => app.thermostat.getState(query.deviceId));
  },

  async apply({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, values?: CapValue[] },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, () => `Thermostat apply failed, body: ${JSON.stringify(body)}`, async () => {
      if (!body?.deviceId || !Array.isArray(body.values)) throw new Error('Missing deviceId or values');
      await app.thermostat.apply(body.deviceId, body.values);
      return { ok: true };
    });
  },
};
