import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { keyResult, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

/** Variable Presets: one Logic variable, read and set through the Variables widget's service. */
export default {
  /** `id`: the Logic variable's id. Answers `{id, name, type, value}`, or `{id, missing: true}` for a deleted one. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!query.id) throw new Error('Missing id');
    logPerf(app, 'Variable Presets', query);
    const [entry] = await logged(app, 'Variable Presets state failed:', () => app.variables.getState([query.id]));
    return entry;
  },

  /**
   * `{id, value}`: a button's value, which must match the variable's type. Without a usable API key it answers
   * `{ok: false, reason}` (`noKey`, `keyScope`, `keyInvalid`), so the widget can say what to do.
   */
  async set({ homey, body }: {
    homey: Homey,
    body: { id?: unknown, value?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    const id = body?.id;
    if (typeof id !== 'string' || !id) throw new Error('Missing id');
    return keyResult(app, 'Variable preset failed', () => app.variables.set(id, body.value));
  },
};
