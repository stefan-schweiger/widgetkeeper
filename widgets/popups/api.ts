import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  /** `name`: the widget's screen name. The popups open for it and for everywhere, and the name is remembered for the Flow cards. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Popups', query);
    return app.popups.forScreen(query.name);
  },
};
