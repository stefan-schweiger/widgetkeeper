import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';
import { VariableWriteError } from '../../lib/VariableService.js';

type Homey = App['homey'];

export default {
  /** `ids`: comma-separated Logic variable ids. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const ids = (query.ids || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Flow variables widget: ${perf}`);
    try {
      return await app.variables.getState(ids);
    } catch (err) {
      app.log('Flow variables state failed:', err);
      throw err;
    }
  },

  /**
   * `{id, value}`: the value must match the variable's type. Without a usable API key it answers
   * `{ok: false, reason}` (`noKey`, `keyScope`, `keyInvalid`), so the widget can say what to do.
   */
  async set({ homey, body }: {
    homey: Homey,
    body: { id?: unknown, value?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (typeof body?.id !== 'string' || !body.id) throw new Error('Missing id');
    try {
      await app.variables.set(body.id, body.value);
      return { ok: true };
    } catch (err) {
      if (err instanceof VariableWriteError) {
        if (err.reason !== 'noKey') app.log(`Flow variable set failed (${err.reason}):`, err.message);
        return { ok: false, reason: err.reason };
      }
      app.log('Flow variable set failed:', err);
      throw err;
    }
  },
};
