import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import type { CapValue } from '../../lib/ThermostatService.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!query.deviceId) throw new Error('Missing deviceId');
    try {
      return await app.thermostat.getState(query.deviceId);
    } catch (err) {
      app.log('Thermostat state failed:', err);
      throw err;
    }
  },

  async apply({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, values?: CapValue[] },
  }) {
    const app = homey.app as WidgetkeeperApp;
    try {
      if (!body?.deviceId || !Array.isArray(body.values)) throw new Error('Missing deviceId or values');
      await app.thermostat.apply(body.deviceId, body.values);
      return { ok: true };
    } catch (err) {
      app.log('Thermostat apply failed, body:', JSON.stringify(body), err);
      throw err;
    }
  },
};
