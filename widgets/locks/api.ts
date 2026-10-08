import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  /** `deviceIds`: comma-separated. One entry per device, in order (`{id, missing: true}` for a deleted one). */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const ids = (query.deviceIds || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Locks widget: ${perf}`);
    try {
      return { devices: await app.locks.getState(ids), language: homey.i18n.getLanguage() };
    } catch (err) {
      app.log('Locks state failed:', err);
      throw err;
    }
  },

  /** `{deviceId, capabilityId: 'locked' | 'garagedoor_closed', value}`. */
  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: unknown, capabilityId?: unknown, value?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (typeof body?.deviceId !== 'string' || !body.deviceId) throw new Error('Missing deviceId');
    try {
      await app.locks.set(body.deviceId, body.capabilityId, body.value);
      return { ok: true };
    } catch (err) {
      app.log('Lock change failed:', err);
      throw err;
    }
  },
};
