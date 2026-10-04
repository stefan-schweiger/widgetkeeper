import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const ids = (query.deviceIds || '').split(',').filter(Boolean);
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Cameras widget: ${perf}`);
    try {
      return await app.cameras.getState(ids);
    } catch (err) {
      app.log('Cameras state failed:', err);
      throw err;
    }
  },

  /** A snapshot as base64, for a widget that can't load `/api/image/<id>` itself. */
  async getSnapshot({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!query.deviceId) throw new Error('deviceId required');
    try {
      return await app.cameras.getSnapshot(query.deviceId);
    } catch (err) {
      app.log(`Camera snapshot for ${query.deviceId} failed:`, err);
      throw err;
    }
  },

  async postOffer({ homey, body }: {
    homey: Homey,
    body: { videoId?: string, offer?: string },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!body?.videoId || typeof body.offer !== 'string') throw new Error('videoId and offer required');
    try {
      return await app.cameras.offer(body.videoId, body.offer);
    } catch (err) {
      app.log(`Camera video ${body.videoId} offer failed:`, err);
      throw err;
    }
  },

  async postKeepAlive({ homey, body }: {
    homey: Homey,
    body: { videoId?: string, streamId?: string },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!body?.videoId || !body.streamId) throw new Error('videoId and streamId required');
    await app.cameras.keepAlive(body.videoId, body.streamId);
    return { ok: true };
  },

  /** What the widget found out about loading snapshots and live view, for the diagnostics log. */
  async postReport({ homey, body }: {
    homey: Homey,
    body: { text?: string },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (typeof body?.text === 'string') app.debug(`Cameras widget: ${body.text.slice(0, 300)}`);
    return { ok: true };
  },
};
