import type { App } from 'homey';
import type WidgetkeeperApp from './app.js';
import { scopesAllow } from './lib/PersonalApiKey.js';
import { callWidgetRoute, routeKeyUse, type WidgetApis } from './lib/widgetRoutes.js';
import stack, { PAGE_APIS } from './widgets/stack/api.js';

type Homey = App['homey'];

/** Every widget's API, by widget id, for the web dashboards' frames (the Smart Stack's included). */
const WEB_APIS: WidgetApis = { ...PAGE_APIS, stack };

/**
 * While the web dashboards have a password (`WebPassword`), their routes only answer a browser that also signed in
 * with it: its session token is `?session=` on every request, on top of the personal API key Homey checks.
 */
function assertWebSession(app: WidgetkeeperApp, query: Record<string, string> | undefined) {
  app.web.assertEnabled();
  if (app.webPassword.isSet && !app.webPassword.check(query?.session)) throw new Error('Web dashboards password required');
}

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
   * Used by the app settings page: whether the personal API key (Variables and Flow Buttons) is saved, never
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
  async getWebSetup({ homey, query }: { homey: Homey, query?: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    const language = homey.i18n.getLanguage();
    // Turned off: only what the page needs to say so.
    if (!app.web.enabled) return { appId: homey.manifest.id, disabled: true, language, strings: await app.web.appStrings(language) };
    // A password set and this browser not signed in with it: only what the page needs to ask for it.
    if (app.webPassword.isSet && !app.webPassword.check(query?.session)) {
      return { appId: homey.manifest.id, passwordRequired: true, language, strings: await app.web.appStrings(language) };
    }
    // The Homey id is for the realtime socket's handshake (`handshakeClient {token, homeyId}`).
    const [homeyId, strings] = await Promise.all([homey.cloud.getHomeyId(), app.web.appStrings(language)]);
    return {
      appId: homey.manifest.id,
      homeyId,
      language,
      strings,
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
    assertWebSession(app, query);
    return app.web.devices(query.type || '', query.query || '');
  },

  /** The web dashboards' editor: the devices and their values for a widget's device value slots (`?type=`). */
  async getWebValues({ homey, query }: { homey: Homey, query: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.valueDevices(query.type || '');
  },

  /** The web dashboards' editor: an autocomplete setting's items (`{type, setting, query, settings}`). */
  async postWebAutocomplete({ homey, query, body }: { homey: Homey, query?: Record<string, string>, body: Record<string, any> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.autocomplete(String(body?.type ?? ''), String(body?.setting ?? ''), String(body?.query ?? ''), body?.settings);
  },

  /** Saves a web dashboard (a new one gets an id); answers it as kept. */
  async putWebDashboard({ homey, query, body }: { homey: Homey, query?: Record<string, string>, body: unknown }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.save(body);
  },

  async deleteWebDashboard({ homey, query, params }: { homey: Homey, query?: Record<string, string>, params: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.remove(params?.id || '');
  },

  /**
   * `{type, method, path, query, body, key}`: a web dashboard widget's own request (`Homey.api(method, path, body)`
   * in its frame), handed to that widget's API as if it came from a Homey dashboard. A route that acts with the
   * app's stored key (a variable, a flow, a speaker's card, a dashboard; `routeKeyUse()`) runs only when the page's
   * own `key` may do the same, so a weaker key can't borrow the stored one's permissions. Otherwise it answers
   * `{ok: false, reason}`, as those routes do without a usable key.
   */
  async postWebCall({ homey, query, body }: {
    homey: Homey,
    query?: Record<string, string>,
    body: { type?: unknown, method?: unknown, path?: unknown, query?: unknown, body?: unknown, key?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    const [type, method, path] = [String(body?.type ?? ''), String(body?.method ?? ''), String(body?.path ?? '')];
    const use = routeKeyUse(type, method, path, body?.body);
    if (use) {
      const scopes = typeof body?.key === 'string' && body.key ? await app.apiKey.scopesOf(body.key) : null;
      if (!scopes) return { ok: false, reason: 'keyInvalid' };
      if (!scopesAllow(scopes, use)) return { ok: false, reason: 'keyScope' };
    }
    return callWidgetRoute(homey, WEB_APIS, type, method, path, body?.query, body?.body);
  },

  /** Used by the app settings page: whether the web dashboards have a password, never the password. */
  async getWebPassword({ homey }: { homey: Homey }) {
    const app = homey.app as WidgetkeeperApp;
    return { set: app.webPassword.isSet };
  },

  /** Used by the app settings page: sets the web dashboards' password (`{password: ''}` removes it). */
  async putWebPassword({ homey, body }: { homey: Homey, body: { password?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    return app.webPassword.setPassword(typeof body?.password === 'string' ? body.password : '');
  },

  /**
   * The web dashboards page, with its API key: signs the browser in with the password (`{password}` →
   * `{ok: true, token}` or `{ok: false, reason: notSet|wrong|locked, retryAfter}`).
   */
  async postWebLogin({ homey, body }: { homey: Homey, body: { password?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    app.web.assertEnabled();
    return app.webPassword.login(body?.password);
  },

  /** The web dashboards page: signs the browser out (`?session=`). */
  async postWebLogout({ homey, query }: { homey: Homey, query?: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    app.webPassword.logout(query?.session);
    return null;
  },
};
