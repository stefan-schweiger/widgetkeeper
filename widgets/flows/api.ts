import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, keyResult, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  /** `ids`: comma-separated slot ids, `flow:<id>` or `advanced:<id>`. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Flow buttons', query);
    return logged(app, 'Flow buttons state failed:', () => app.flows.getState(idList(query.ids)));
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
    const id = body?.id;
    if (typeof id !== 'string' || !id) throw new Error('Missing id');
    return keyResult(app, 'Flow start failed', () => app.flows.trigger(id));
  },
};
