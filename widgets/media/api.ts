import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { KeyError } from '../../lib/PersonalApiKey.js';
import { describeWidgetPerf } from '../../lib/Timings.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!query.deviceId) throw new Error('Missing deviceId');
    const perf = describeWidgetPerf(query.perf);
    if (perf) app.debug(`Media widget: ${perf}`);
    return app.media.getState(query.deviceId);
  },

  /** `{deviceId, capabilityId, value, maxVolume}`: one control (play, next, mute, the volume …). */
  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, capabilityId?: string, value?: unknown, maxVolume?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    try {
      if (!body?.deviceId || !body.capabilityId) throw new Error('Missing deviceId or capabilityId');
      await app.media.set(body.deviceId, body.capabilityId, body.value, body.maxVolume);
      return { ok: true };
    } catch (err) {
      app.log('Media change failed, body:', JSON.stringify(body), err);
      throw err;
    }
  },

  /**
   * `{deviceId, id}`: a button, the speaker's own Flow card or a flow. Without a usable API key it answers
   * `{ok: false, reason}` (`noKey`, `keyScope`, `keyInvalid`), so the widget can say what to do.
   */
  async button({ homey, body }: {
    homey: Homey,
    body: { deviceId?: unknown, id?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (typeof body?.deviceId !== 'string' || typeof body.id !== 'string' || !body.id) throw new Error('Missing deviceId or id');
    try {
      await app.media.runButton(body.deviceId, body.id);
      return { ok: true };
    } catch (err) {
      if (err instanceof KeyError) {
        if (err.reason !== 'noKey') app.log(`Media button failed (${err.reason}):`, err.message);
        return { ok: false, reason: err.reason };
      }
      app.log('Media button failed:', err);
      throw err;
    }
  },

  /** The album art as base64, for a frame that can't load `/api/image/…` itself. */
  async getArt({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!query.deviceId) throw new Error('Missing deviceId');
    return app.media.getArt(query.deviceId);
  },

  /** `{text}`: what the widget found (which album art route works), for the diagnostics log. */
  async report({ homey, body }: {
    homey: Homey,
    body: { text?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (typeof body?.text === 'string') app.debug(`Media widget: ${body.text.slice(0, 300)}`);
    return { ok: true };
  },
};
