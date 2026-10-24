import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { keyResult, logged, logPerf, requireId } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export default {
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const deviceId = requireId(query.deviceId, 'deviceId');
    logPerf(app, 'Media', query);
    return app.media.getState(deviceId, { cards: query.cards === '1' });
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
    return logged(app, () => `Media change failed, body: ${JSON.stringify(body)}`, async () => {
      await app.media.set(requireId(body?.deviceId, 'deviceId'), requireId(body.capabilityId, 'capabilityId'), body.value, body.maxVolume);
      return { ok: true };
    });
  },

  /**
   * `{deviceId, id}`: a button, the speaker's own Flow card, its app's or a flow. Without a usable API key it answers
   * `{ok: false, reason}` (`noKey`, `keyScope`, `keyInvalid`), so the widget can say what to do.
   */
  async button({ homey, body }: {
    homey: Homey,
    body: { deviceId?: unknown, id?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    const { deviceId, id } = body ?? {};
    // A flow button needs no speaker, so the deviceId may be empty.
    if (typeof deviceId !== 'string') throw new Error('Missing deviceId');
    const buttonId = requireId(id, 'id');
    return keyResult(app, 'Media button failed', () => app.media.runButton(deviceId, buttonId));
  },

  /** The album art as base64, for a frame that can't load `/api/image/…` itself. */
  async getArt({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return app.media.getArt(requireId(query.deviceId, 'deviceId'));
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
