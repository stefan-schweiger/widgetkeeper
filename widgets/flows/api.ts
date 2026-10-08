import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { KeyError } from '../../lib/PersonalApiKey.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  /** `ids`: comma-separated slot ids, `flow:<id>` or `advanced:<id>`. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const ids = (query.ids || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Flow buttons widget: ${perf}`);
    try {
      return await app.flows.getState(ids);
    } catch (err) {
      app.log('Flow buttons state failed:', err);
      throw err;
    }
  },

  /**
   * `{id}`: starts the flow. Without a usable API key it answers `{ok: false, reason}` (`noKey`, `keyScope`,
   * `keyInvalid`), so the widget can say what to do.
   */
  async trigger({ homey, body }: {
    homey: Homey,
    body: { id?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (typeof body?.id !== 'string' || !body.id) throw new Error('Missing id');
    try {
      await app.flows.trigger(body.id);
      return { ok: true };
    } catch (err) {
      if (err instanceof KeyError) {
        if (err.reason !== 'noKey') app.log(`Flow start failed (${err.reason}):`, err.message);
        return { ok: false, reason: err.reason };
      }
      app.log('Flow start failed:', err);
      throw err;
    }
  },
};
