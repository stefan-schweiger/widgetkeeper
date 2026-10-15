import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import type { LightChange } from '../../lib/LightService.js';
import { idList, keyResult, logged, logPerf } from '../../lib/widgetApi.js';
import { tileNameRoutes, withTileNames } from '../../lib/TileNameService.js';

type Homey = App['homey'];

export default {
  ...tileNameRoutes,

  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Lights', query);
    return withTileNames(homey, query, logged(app, 'Lights state failed:', () => app.lights.getState(idList(query.deviceIds))));
  },

  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string } & LightChange,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, () => `Light change failed, body: ${JSON.stringify(body)}`, async () => {
      if (!body?.deviceId) throw new Error('Missing deviceId');
      await app.lights.set(body.deviceId, { dim: body.dim, onoff: body.onoff, temperature: body.temperature, hue: body.hue, saturation: body.saturation });
      return { ok: true };
    });
  },

  /** The Moods of these zones (`palette: moods`). */
  async getMoods({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, 'Light moods failed:', async () => ({ moods: await app.lights.getMoods(idList(query.zones)) }));
  },

  /** Starts a Mood through the personal API key: `{ok: false, reason}` without a usable one. */
  async setMood({ homey, body }: {
    homey: Homey,
    body: { id?: string },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return keyResult(app, 'Could not start the mood', () => app.lights.setMood(String(body?.id ?? '')));
  },
};
