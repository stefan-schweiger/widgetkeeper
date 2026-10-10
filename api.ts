import type { App } from 'homey';
import type WidgetkeeperApp from './app.js';
import { callWidgetRoute, type WidgetApis } from './lib/widgetRoutes.js';
import stack, { PAGE_APIS } from './widgets/stack/api.js';

type Homey = App['homey'];

/** Every widget's API, by widget id, for the web dashboards' frames (the Smart Stack's included). */
const WEB_APIS: WidgetApis = { ...PAGE_APIS, stack };

export default {
  /**
   * Used by the app settings page: `GET /diagnostics[?device=<id or name>]`. With `heatmap=<deviceId>:<capabilityId>[:<days>]`,
   * the report also has the heatmap widget's history for it (`npm run diagnostics -- --heatmap …`).
   */
  async getDiagnostics({ homey, query }: { homey: Homey, query: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    const report: Record<string, unknown> = await app.diagnostics.report(query.device || undefined);
    if (query.heatmap) {
      const [deviceId, capabilityId, days] = query.heatmap.split(':');
      try {
        report.heatmapHistory = await app.heatmap.getHistory(deviceId, capabilityId, Number(days) || 7);
      } catch (err) {
        report.heatmapHistory = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return report;
  },

  /**
   * Used by the app settings page: whether the personal API key (Flow Variables and Flow Buttons) is saved, never
   * the key itself. The path predates Flow Buttons.
   */
  async getVariablesKey({ homey }: { homey: Homey }) {
    const app = homey.app as WidgetkeeperApp;
    return { set: app.apiKey.has() };
  },

  /**
   * Used by the app settings page: checks and saves the personal API key (`{key: ''}` removes it). The answer says
   * whether it may change variables and start flows, or why it wasn't saved.
   */
  async putVariablesKey({ homey, body }: { homey: Homey, body: { key?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    return app.apiKey.save(typeof body?.key === 'string' ? body.key : '');
  },

  /**
   * The web dashboards page (`settings/dashboard.html`, opened in a browser with a personal API key): what it needs
   * to start: the widget types and their settings, the app's strings and the dashboards, all in Homey's language.
   */
  async getWebSetup({ homey }: { homey: Homey }) {
    const app = homey.app as WidgetkeeperApp;
    const language = homey.i18n.getLanguage();
    // Turned off: only what the page needs to say so.
    if (!app.web.enabled) return { appId: homey.manifest.id, disabled: true, language, strings: await app.web.appStrings(language) };
    return {
      appId: homey.manifest.id,
      // For the realtime socket's handshake (`handshakeClient {token, homeyId}`).
      homeyId: await homey.cloud.getHomeyId(),
      language,
      strings: await app.web.appStrings(language),
      widgets: app.web.widgetTypes(language),
      dashboards: app.web.list(),
    };
  },

  /** Used by the app settings page: the web dashboards page's address on the home network (shown while they're on). */
  async getWebAddress({ homey }: { homey: Homey }) {
    const address = await homey.cloud.getLocalAddress();
    return { url: `http://${address.replace(/:80$/, '')}/app/${homey.manifest.id}/settings/dashboard.html` };
  },

  /** The web dashboards' editor: the devices a widget's devices setting may pick (`?type=&query=`). */
  async getWebDevices({ homey, query }: { homey: Homey, query: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    app.web.assertEnabled();
    return app.web.devices(query.type || '', query.query || '');
  },

  /** The web dashboards' editor: an autocomplete setting's items (`{type, setting, query, settings}`). */
  async postWebAutocomplete({ homey, body }: { homey: Homey, body: Record<string, any> }) {
    const app = homey.app as WidgetkeeperApp;
    app.web.assertEnabled();
    return app.web.autocomplete(String(body?.type ?? ''), String(body?.setting ?? ''), String(body?.query ?? ''), body?.settings);
  },

  /** Saves a web dashboard (a new one gets an id); answers it as kept. */
  async putWebDashboard({ homey, body }: { homey: Homey, body: unknown }) {
    const app = homey.app as WidgetkeeperApp;
    app.web.assertEnabled();
    return app.web.save(body);
  },

  async deleteWebDashboard({ homey, params }: { homey: Homey, params: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    app.web.assertEnabled();
    return app.web.remove(params?.id || '');
  },

  /**
   * `{type, method, path, query, body}`: a web dashboard widget's own request (`Homey.api(method, path, body)` in
   * its frame), handed to that widget's API as if it came from a Homey dashboard.
   */
  async postWebCall({ homey, body }: {
    homey: Homey,
    body: { type?: unknown, method?: unknown, path?: unknown, query?: unknown, body?: unknown },
  }) {
    (homey.app as WidgetkeeperApp).web.assertEnabled();
    return callWidgetRoute(homey, WEB_APIS, String(body?.type ?? ''), String(body?.method ?? ''), String(body?.path ?? ''), body?.query, body?.body);
  },
};
