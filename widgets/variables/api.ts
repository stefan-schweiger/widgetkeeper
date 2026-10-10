import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, keyResult, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  /** `ids`: comma-separated Logic variable ids. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Flow variables', query);
    return logged(app, 'Flow variables state failed:', () => app.variables.getState(idList(query.ids)));
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
    const id = body?.id;
    if (typeof id !== 'string' || !id) throw new Error('Missing id');
    return keyResult(app, 'Flow variable set failed', () => app.variables.set(id, body.value));
  },
};
