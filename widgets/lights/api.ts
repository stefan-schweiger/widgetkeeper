import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import type { LightChange } from '../../lib/LightService.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const ids = (query.deviceIds || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Lights widget: ${perf}`);
    try {
      return await app.lights.getState(ids);
    } catch (err) {
      app.log('Lights state failed:', err);
      throw err;
    }
  },

  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string } & LightChange,
  }) {
    const app = homey.app as WidgetkeeperApp;
    try {
      if (!body?.deviceId) throw new Error('Missing deviceId');
      await app.lights.set(body.deviceId, { dim: body.dim, onoff: body.onoff, temperature: body.temperature, hue: body.hue, saturation: body.saturation });
      return { ok: true };
    } catch (err) {
      app.log('Light change failed, body:', JSON.stringify(body), err);
      throw err;
    }
  },
};
