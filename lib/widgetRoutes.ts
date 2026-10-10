import type { App } from 'homey';
import type { KeyUse } from './PersonalApiKey.js';

type Homey = App['homey'];

/** Widget API handlers (each widget's `api.ts` default export), by widget id. */
export type WidgetApis = Record<string, Record<string, (args: any) => Promise<unknown>>>;

/**
 * A widget's API route: the handler of its own `api.ts` whose method and path (from the manifest, i.e. its
 * `widget.compose.json`) match, or null. Only those routes can be reached, as from the widget's own frame.
 */
export function findWidgetRoute(homey: Homey, apis: WidgetApis, type: string, method: string, path: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(apis, type)) return null;
  const routes = (homey.manifest as any)?.widgets?.[type]?.api ?? {};
  for (const [name, route] of Object.entries(routes) as [string, any][]) {
    if (route?.method === method && route?.path === path && typeof apis[type]?.[name] === 'function') return name;
  }
  return null;
}

/** A widget's request (`Homey.api(method, path, body)` in its frame), handed to that widget's API. */
export function callWidgetRoute(homey: Homey, apis: WidgetApis, type: string, method: string, path: string, query: unknown, body: unknown) {
  const route = findWidgetRoute(homey, apis, type, method, path);
  if (!route) throw new Error(`Not a widget route: ${type} ${method} ${path}`);
  const q = query && typeof query === 'object' ? Object.fromEntries(
    Object.entries(query as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
  ) : {};
  return apis[type][route]({ homey, query: q, body: body ?? {}, params: {} });
}

/**
 * The personal API key use a widget route acts with (the app's stored key: changing a variable, starting a flow,
 * running a speaker's card, reading a dashboard), or null for a route that doesn't. A Smart Stack's `/call` is its
 * page's route.
 */
export function routeKeyUse(type: string, method: string, path: string, body: unknown): KeyUse | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  switch (`${type} ${method} ${path}`) {
    case 'variables POST /set': return 'variables';
    case 'flows POST /trigger': return 'flows';
    case 'media POST /button': return String(b.id ?? '').startsWith('card:') ? 'cards' : 'flows';
    case 'stack GET /pages': return 'dashboards';
    case 'stack POST /call': return routeKeyUse(String(b.type ?? ''), String(b.method ?? ''), String(b.path ?? ''), b.body);
    default: return null;
  }
}
