import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { fakeApi, fakeHomey } from './fakeHomey.js';
import PersonalApiKey from '../../lib/PersonalApiKey.js';
import PopupService from '../../lib/PopupService.js';
import TileNameService from '../../lib/TileNameService.js';
import WebDashboardService, { WEB_ENABLED_SETTING } from '../../lib/WebDashboardService.js';
import WebPassword from '../../lib/WebPassword.js';

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));

/**
 * A fake Homey with the app the web routes (`api.ts`) need: the web dashboards (on unless `enabled: false`), their
 * password, tile names, popups and the personal API key, on `homey.app`. Test files that use it mock `homey-api`
 * (`vi.mock('homey-api', () => homeyApiMock)`).
 */
export function webApp({ enabled = true, autocompletes = {}, now = () => Date.now() }: {
  enabled?: boolean,
  autocompletes?: ConstructorParameters<typeof WebDashboardService>[2],
  now?: () => number,
} = {}) {
  const homey = fakeHomey(fakeApi({}));
  homey.manifest = { ...homey.manifest, widgets: manifest.widgets };
  homey.cloud = { getHomeyId: async () => 'homey-id', getLocalAddress: async () => '192.168.1.20:80' };
  if (enabled) homey.settings.set(WEB_ENABLED_SETTING, true);
  const log = vi.fn();
  const tileNames = new TileNameService(homey);
  const web = new WebDashboardService(homey, log, autocompletes, tileNames);
  const password = new WebPassword(homey, log, now);
  const popups = new PopupService(homey, { cameras: {} as any, web }, log);
  const apiKey = PersonalApiKey.for(homey, log);
  homey.app = { web, tileNames, webPassword: password, popups, apiKey, log, debug: vi.fn() };
  return { homey, web, password, popups, apiKey, tileNames, log };
}
