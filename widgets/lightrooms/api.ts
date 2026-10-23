import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import type { LightChange } from '../../lib/LightService.js';
import { idList, keyResult, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

/** Lights by Room: Light Controls' service (`app.lights`), with each room's zone icon. */
export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Light rooms', query);
    return logged(app, 'Light rooms state failed:', async () => {
      const lights = await app.lights.getState(idList(query.deviceIds));
      const zones = [...new Set(lights.flatMap(d => ('missing' in d || !d.zone ? [] : [d.zone.id])))];
      return { lights, zoneIcons: await app.lights.zoneIcons(zones) };
    });
  },

  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string } & LightChange,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, () => `Light rooms change failed, body: ${JSON.stringify(body)}`, async () => {
      if (!body?.deviceId) throw new Error('Missing deviceId');
      await app.lights.set(body.deviceId, { dim: body.dim, onoff: body.onoff, temperature: body.temperature, hue: body.hue, saturation: body.saturation });
      return { ok: true };
    });
  },

  /** The Moods of these zones. */
  async getMoods({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, 'Light rooms moods failed:', async () => ({ moods: await app.lights.getMoods(idList(query.zones)) }));
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
