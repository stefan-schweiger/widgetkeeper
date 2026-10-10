import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { isStackType } from '../../lib/StackService.js';
import { keyResult, logPerf } from '../../lib/widgetApi.js';
import { callWidgetRoute, findWidgetRoute, type WidgetApis } from '../../lib/widgetRoutes.js';
import electricity from '../electricity/api.js';
import thermostat from '../thermostat/api.js';
import quickactions from '../quickactions/api.js';
import sensoralarms from '../sensoralarms/api.js';
import sensordots from '../sensordots/api.js';
import weather from '../weather/api.js';
import heatmap from '../heatmap/api.js';
import cameras from '../cameras/api.js';
import values from '../values/api.js';
import lights from '../lights/api.js';
import sparklines from '../sparklines/api.js';
import variables from '../variables/api.js';
import flows from '../flows/api.js';
import price from '../price/api.js';
import timers from '../timers/api.js';
import locks from '../locks/api.js';
import curtains from '../curtains/api.js';
import media from '../media/api.js';

type Homey = App['homey'];

/** Each page widget's own API (its `api.ts`), by widget id. */
export const PAGE_APIS: WidgetApis = {
  electricity, thermostat, quickactions, sensoralarms, sensordots, weather, heatmap, cameras, values,
  lights, sparklines, variables, flows, price, timers, locks, curtains, media,
};

/** A page's API route (`findWidgetRoute()`), or null; a stack's own routes can't be reached from a page. */
export function findRoute(homey: Homey, type: string, method: string, path: string): string | null {
  return isStackType(type) ? findWidgetRoute(homey, PAGE_APIS, type, method, path) : null;
}

export default {
  /**
   * `dashboardId`: that dashboard's pages (this app's widgets on it) and the Flow requests running. Without a
   * usable API key it answers `{ok: false, reason}` (`noKey`, `keyScope`, `keyInvalid`), so the widget can say what to do.
   */
  async getPages({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Smart stack', query);
    const language = homey.i18n.getLanguage();
    return { ...await keyResult(app, 'Smart stack pages failed', () => app.stack.getPages(query.dashboardId || '')), language };
  },

  /**
   * `{type, method, path, query, body}`: a page's own request (`Homey.api(method, path, body)` in its widget),
   * handed to that widget's API as if it came from its own frame.
   */
  async call({ homey, body }: {
    homey: Homey,
    body: { type?: unknown, method?: unknown, path?: unknown, query?: unknown, body?: unknown },
  }) {
    const type = String(body?.type ?? '');
    if (!isStackType(type)) throw new Error(`Not a widget route: ${type} ${body?.method} ${body?.path}`);
    return callWidgetRoute(homey, PAGE_APIS, type, String(body?.method ?? ''), String(body?.path ?? ''), body?.query, body?.body);
  },
};
