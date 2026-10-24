// One login to the active Homey (the one `npx homey select` picked) through the Homey CLI's own code, reused for every
// request: `homey api raw` logs in anew each time, and Homey answers a burst of logins with `Too many requests` for
// minutes. Shared by `test-dashboards.mjs` and `port-dashboard.mjs`.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export const APP_ID = JSON.parse(readFileSync(new URL('../.homeycompose/app.json', import.meta.url), 'utf8')).id;
/** The web dashboards (lib/WebDashboardService.ts), as the app setting keeps them. */
export const WEB_SETTING = `/api/manager/apps/app/${APP_ID}/setting/webDashboards`;
/** Homey's own dashboards. */
export const DASHBOARDS = '/api/manager/dashboards/dashboard/';
/** The typed tile names (lib/TileNameService.ts), by widget instance: a web dashboard widget's is `web-<dashboard>-<widget>`. */
export const TILE_NAMES = `/api/manager/apps/app/${APP_ID}/setting/tileNames`;
/** As many web dashboards as the app keeps. */
export const MAX_WEB_DASHBOARDS = 64;

/** Every widget's `widget.compose.json`, by id. */
export function widgetManifests() {
  const dir = new URL('../widgets/', import.meta.url);
  return Object.fromEntries(readdirSync(dir)
    .filter(id => existsSync(new URL(`${id}/widget.compose.json`, dir)))
    .map(id => [id, JSON.parse(readFileSync(new URL(`${id}/widget.compose.json`, dir), 'utf8'))]));
}

/**
 * Logs in and answers `{api(method, path, body), close()}`. The CLI's login goes through Athom's cloud; while that
 * says `Too many requests`, it tries again every 10 minutes, for an hour. `HOMEY_TOKEN` (a personal API key) and
 * `HOMEY_ADDRESS` (`http://<the Homey's IP>`) skip the cloud.
 */
export async function connect() {
  const { createHomeyApiClient, disposeHomeyApiClient } = await import(pathToFileURL(require.resolve('homey/lib/api/ApiCommandRuntime.mjs')).href);
  const login = async (tries = 7) => {
    const { HOMEY_TOKEN: token, HOMEY_ADDRESS: address } = process.env;
    if (token && address) return createHomeyApiClient({ token, address });
    try {
      return await createHomeyApiClient({});
    } catch (err) {
      if (tries <= 1 || err?.statusCode !== 429) throw err;
      console.log('The Athom cloud is rate limiting the login; trying again in 10 minutes.');
      await new Promise(resolve => setTimeout(resolve, 600000));
      return login(tries - 1);
    }
  };
  const client = await login();
  return {
    /** A request to the Homey's web API, as the CLI's logged-in user. */
    api: (method, path, body) => client.call({ method, path, ...(body === undefined ? {} : { body }) }),
    close: () => disposeHomeyApiClient(client),
  };
}
