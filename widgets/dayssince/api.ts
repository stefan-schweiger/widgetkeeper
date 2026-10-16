import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { counterKey, MAX_WIDGET_COUNTERS, type CounterDef } from '../../lib/DaysSinceService.js';
import { logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

/** The widget's counters, sent as JSON in `counters`: `[{name, amber, red}]` (days; 0 or null is off). */
function defsOf(raw: unknown): CounterDef[] {
  if (raw == null || raw === '') return [];
  let list: unknown;
  try {
    list = JSON.parse(String(raw));
  } catch (err) {
    throw new Error('Invalid counters');
  }
  if (!Array.isArray(list) || list.length > MAX_WIDGET_COUNTERS) throw new Error('Invalid counters');
  return list.map((d: any) => {
    if (!d || typeof d.name !== 'string' || !counterKey(d.name)) throw new Error('Invalid counters');
    return { name: d.name, amber: d.amber, red: d.red };
  });
}

export default {
  /**
   * `counters`: the widget's counters (JSON). Each is created when it's new and takes the widget's intervals; answers
   * them in that order with the Homey's clock and language (`{now, language, counters}`).
   */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Days Since', query);
    return { language: homey.i18n.getLanguage(), ...app.daysSince.sync(defsOf(query.counters)) };
  },

  /** `{name}`: a tap on a counter starts it again from now, undoable for a minute (`{now, counter}`). */
  async reset({ homey, body }: {
    homey: Homey,
    body: { name?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return app.daysSince.reset(body?.name, true);
  },

  /** `{name, at}`: undoes that reset (`at` is the `resetAt` it answered); `{now, undone, counter}`. */
  async undo({ homey, body }: {
    homey: Homey,
    body: { name?: unknown, at?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return app.daysSince.undo(body?.name, body?.at);
  },
};
