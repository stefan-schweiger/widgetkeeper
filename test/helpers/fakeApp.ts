import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { fakeApi, fakeHomey, type FakeDevice } from './fakeHomey.js';
import WidgetkeeperApp from '../../app.js';

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));

export type FakeCard = {
  kind: 'triggers' | 'conditions' | 'actions',
  id: string,
  run: ((args: any, state?: any) => Promise<unknown>) | null,
  autocompletes: Record<string, (query: string, args?: any) => Promise<unknown>>,
  trigger: ReturnType<typeof vi.fn>,
};

/**
 * Homey's Flow manager for the app's own cards (`app.json`'s `flow`): each card records its run and argument
 * autocomplete listeners and its triggers. Like the SDK, asking for a card the manifest doesn't have throws.
 */
function fakeFlow() {
  const cards = new Map<string, FakeCard>();
  const get = (kind: FakeCard['kind']) => (id: string) => {
    if (!(manifest.flow?.[kind] ?? []).some((c: any) => c.id === id)) throw new Error(`Invalid Flow Card ID: ${id}`);
    const key = `${kind}:${id}`;
    let card = cards.get(key);
    if (!card) {
      const c: FakeCard & Record<string, any> = {
        kind, id, run: null, autocompletes: {},
        trigger: vi.fn(async () => {}),
        registerRunListener(fn: FakeCard['run']) { c.run = fn; return c; },
        registerArgumentAutocompleteListener(name: string, fn: any) { c.autocompletes[name] = fn; return c; },
      };
      card = c;
      cards.set(key, card);
    }
    return card;
  };
  return { cards, getActionCard: get('actions'), getTriggerCard: get('triggers'), getConditionCard: get('conditions') };
}

/** Homey's dashboards manager: each widget records its settings' autocomplete listeners; an unknown widget throws. */
function fakeDashboards() {
  const widgets = new Map<string, { autocompletes: Record<string, any> }>();
  return {
    widgets,
    getWidget(id: string) {
      if (!Object.prototype.hasOwnProperty.call(manifest.widgets, id)) throw new Error(`Invalid widget: ${id}`);
      let w = widgets.get(id);
      if (!w) {
        const entry: { autocompletes: Record<string, any> } & Record<string, any> = {
          autocompletes: {},
          registerSettingAutocompleteListener(setting: string, fn: any) { entry.autocompletes[setting] = fn; return entry; },
        };
        w = entry;
        widgets.set(id, w);
      }
      return w;
    },
  };
}

/**
 * The whole app, booted (`onInit()`) on a fake Homey with the real manifest's widgets and Flow cards. The app token's
 * API (`homey.fakeApi`) also answers `sessions.getSessionMe()` (the diagnostics' `apiScopes`).
 */
export async function bootApp({ devices = [] as FakeDevice[], extraApi = {} as Record<string, unknown> } = {}) {
  const api: any = fakeApi({ devices });
  api.sessions = { getSessionMe: vi.fn(async () => ({ scopes: ['homey.device.readonly', 'homey.logic.readonly'] })) };
  Object.assign(api, extraApi);
  const homey = fakeHomey(api);
  homey.manifest = { ...homey.manifest, widgets: manifest.widgets, flow: manifest.flow };
  homey.version = '13.0.0';
  homey.cloud = { getHomeyId: async () => 'homey-id', getLocalAddress: async () => '192.168.1.20:80' };
  homey.flow = fakeFlow();
  homey.dashboards = fakeDashboards();
  const app = new WidgetkeeperApp();
  (app as any).homey = homey;
  homey.app = app;
  await app.onInit();
  return { app, homey, api, flow: homey.flow as ReturnType<typeof fakeFlow>, dashboards: homey.dashboards as ReturnType<typeof fakeDashboards> };
}

export { manifest };
