import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { keyResult, logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (!query.deviceId) throw new Error('Missing deviceId');
    logPerf(app, 'Media', query);
    return app.media.getState(query.deviceId, { cards: query.cards === '1' });
  },

  /** Every speaker, for the widget's switcher. */
  async getSpeakers({ homey }: { homey: Homey }) {
    const app = homey.app as WidgetkeeperApp;
    return { speakers: await app.media.listSpeakers() };
  },

  /** `{deviceId, capabilityId, value, maxVolume}`: one control (play, next, mute, the volume …). */
  async set({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, capabilityId?: string, value?: unknown, maxVolume?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, `Media change failed, body: ${JSON.stringify(body)}`, async () => {
      if (!body?.deviceId || !body.capabilityId) throw new Error('Missing deviceId or capabilityId');
      await app.media.set(body.deviceId, body.capabilityId, body.value, body.maxVolume);
      return { ok: true };
    });
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
    const { deviceId, id } = body ?? {};
    if (typeof deviceId !== 'string' || typeof id !== 'string' || !id) throw new Error('Missing deviceId or id');
    return keyResult(app, 'Media button failed', () => app.media.runButton(deviceId, id));
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
