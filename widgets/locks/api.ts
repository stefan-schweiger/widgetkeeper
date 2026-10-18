import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';
import { tileNameRoutes, withTileNames } from '../../lib/TileNameService.js';

type Homey = App['homey'];

export default {
  ...tileNameRoutes,

  /**
   * `deviceIds`: comma-separated. One entry per device, in order (`{id, missing: true}` for a deleted one). `open`: the
   * widget's Open capability, if any.
   */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Locks', query);
    return withTileNames(homey, query, logged(app, 'Locks state failed:', async () => (
      { devices: await app.locks.getState(idList(query.deviceIds), query.open || null), language: homey.i18n.getLanguage() }
    )));
  },

  /** `{deviceId, capabilityId: 'locked' | 'garagedoor_closed', value}`. */
  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: unknown, capabilityId?: unknown, value?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    const deviceId = body?.deviceId;
    if (typeof deviceId !== 'string' || !deviceId) throw new Error('Missing deviceId');
    return logged(app, 'Lock change failed:', async () => {
      await app.locks.set(deviceId, body.capabilityId, body.value);
      return { ok: true };
    });
  },

  /** `{deviceId, capabilityId}`: opens (unlatches) a lock with the widget's Open capability. */
  async open({ homey, body }: {
    homey: Homey,
    body: { deviceId?: unknown, capabilityId?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    const deviceId = body?.deviceId;
    if (typeof deviceId !== 'string' || !deviceId) throw new Error('Missing deviceId');
    return logged(app, 'Lock open failed:', async () => {
      await app.locks.open(deviceId, body.capabilityId);
      return { ok: true };
    });
  },
};
