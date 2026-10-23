import type { App } from 'homey';
import type WidgetkeeperApp from './app.js';
import { scopesAllow, type KeyUse } from './lib/PersonalApiKey.js';
import { idList } from './lib/widgetApi.js';
import { autocompleteKeyUse, callWidgetRoute, routeKeyUse, type WidgetApis } from './lib/widgetRoutes.js';
import dayssince from './widgets/dayssince/api.js';
import popups from './widgets/popups/api.js';
import shortcuts from './widgets/shortcuts/api.js';
import stack, { PAGE_APIS } from './widgets/stack/api.js';
import webpage from './widgets/webpage/api.js';

type Homey = App['homey'];

/**
 * Every widget's API, by widget id, for the web dashboards' frames (the Smart Stack's included, and Days Since, Dashboard
 * Shortcuts, Web Page and Popups, which aren't stack pages; a Popups widget on a web dashboard never calls it).
 */
export const WEB_APIS: WidgetApis = { ...PAGE_APIS, stack, dayssince, shortcuts, webpage, popups };

/** Why the web page's own key (`key`) may not do what the app's stored key would do here, or null when it may. */
async function pageKeyProblem(app: WidgetkeeperApp, key: unknown, use: KeyUse): Promise<'keyInvalid' | 'keyScope' | null> {
  const scopes = typeof key === 'string' && key ? await app.apiKey.scopesOf(key) : null;
  if (!scopes) return 'keyInvalid';
  return scopesAllow(scopes, use) ? null : 'keyScope';
}

/** The page opened through Homey's cloud says so on every request (`?away=1`); see `WEB_REMOTE_SETTING`. */
function isAway(query: Record<string, string> | undefined) {
  return query?.away === '1';
}

/**
 * While the web dashboards have a password (`WebPassword`), their routes only answer a browser that also signed in
 * with it: its session token is `?session=` on every request, on top of the personal API key Homey checks.
 */
function assertWebSession(app: WidgetkeeperApp, query: Record<string, string> | undefined) {
  app.web.assertEnabled(isAway(query));
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
    // Away from home without remote access: the same, and why.
    if (isAway(query) && !app.web.remote) {
      return { appId: homey.manifest.id, disabled: true, away: true, language, strings: await app.web.appStrings(language) };
    }
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
      front: app.web.front(),
      popups: app.popups.all(),
    };
  },

  /**
   * Used by the app settings page: the web dashboards page's address on the home network, and away from home through
   * Homey's cloud relay (`https://<homeyId>.connect.athom.com`, which serves the page and relays the API and socket;
   * the SDK has no getter for it). Shown while they're on.
   */
  async getWebAddress({ homey }: { homey: Homey }) {
    const [address, homeyId] = await Promise.all([homey.cloud.getLocalAddress(), homey.cloud.getHomeyId()]);
    const page = `/app/${homey.manifest.id}/settings/dashboard.html`;
    return { url: `http://${address.replace(/:80$/, '')}${page}`, remoteUrl: `https://${homeyId}.connect.athom.com${page}` };
  },

  /**
   * The web dashboards' editor: the devices a widget's devices setting may pick (`?type=&query=`; another app's widget
   * also sends its filter, `&class=&capabilities=&app=1`).
   */
  async getWebDevices({ homey, query }: { homey: Homey, query: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.devices(query.type || '', query.query || '', { class: query.class, capabilities: query.capabilities, app: query.app === '1' });
  },

  /** The web dashboards' editor: the devices and their values for a widget's device value slots (`?type=`). */
  async getWebValues({ homey, query }: { homey: Homey, query: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.valueDevices(query.type || '');
  },

  /**
   * The web dashboards' editor: an autocomplete setting's items (`{type, setting, query, settings, key}`). One that
   * reads with the app's stored key (the Smart Stack's dashboards) answers only when the page's own key may too.
   */
  async postWebAutocomplete({ homey, query, body }: { homey: Homey, query?: Record<string, string>, body: Record<string, any> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    const [type, setting] = [String(body?.type ?? ''), String(body?.setting ?? '')];
    const use = autocompleteKeyUse(type, setting);
    const problem = use && await pageKeyProblem(app, body?.key, use);
    if (problem) return [{ id: 'none', name: homey.__(`stack.${problem}`) || problem, description: homey.__('stack.keyHint') || '' }];
    return app.web.autocomplete(type, setting, String(body?.query ?? ''), body?.settings);
  },

  /** Saves a web dashboard (a new one gets an id); answers it as kept. */
  async putWebDashboard({ homey, query, body }: { homey: Homey, query?: Record<string, string>, body: unknown }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.save(body);
  },

  /** The front page's edit mode: `{order?: dashboard ids, widgets?: boolean}` (the carousel). */
  async putWebFront({ homey, query, body }: { homey: Homey, query?: Record<string, string>, body: unknown }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.saveFront(body);
  },

  async deleteWebDashboard({ homey, query, params }: { homey: Homey, query?: Record<string, string>, params: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.remove(params?.id || '');
  },

  /** The front page's edit mode: copies a dashboard right after it; answers `{dashboard, dashboards}`. */
  async postWebDashboardCopy({ homey, query, params }: { homey: Homey, query?: Record<string, string>, params: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.duplicate(params?.id || '');
  },

  /** The front page's edit mode: the web dashboards as one file (`WebBackup`), every one or those `?ids=a,b` names. */
  async getWebBackup({ homey, query }: { homey: Homey, query?: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.backup(query?.ids === undefined ? undefined : idList(query.ids));
  },

  /** The front page's edit mode: restores a backup's dashboards, keeping the others; answers `{dashboards, widgets, skipped}`. */
  async putWebBackup({ homey, query, body }: { homey: Homey, query?: Record<string, string>, body: unknown }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.web.restore(body);
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
    const problem = use && await pageKeyProblem(app, body?.key, use);
    if (problem) return { ok: false, reason: problem };
    return callWidgetRoute(homey, WEB_APIS, type, method, path, body?.query, body?.body);
  },

  /** Used by the app settings page: whether the web dashboards have a password, never the password. */
  async getWebPassword({ homey }: { homey: Homey }) {
    const app = homey.app as WidgetkeeperApp;
    return { set: app.webPassword.isSet };
  },

  /**
   * Used by the app settings page: sets the web dashboards' password (`{password: ''}` removes it). While one is set,
   * `current` must be it (anyone whose API key may call the app reaches this route, not only the owner).
   */
  async putWebPassword({ homey, body }: { homey: Homey, body: { password?: unknown, current?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    return app.webPassword.setPassword(typeof body?.password === 'string' ? body.password : '', body?.current);
  },

  /**
   * The web dashboards page, with its API key: signs the browser in with the password (`{password}` →
   * `{ok: true, token}` or `{ok: false, reason: notSet|wrong|locked, retryAfter}`).
   */
  async postWebLogin({ homey, query, body }: { homey: Homey, query?: Record<string, string>, body: { password?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    app.web.assertEnabled(isAway(query));
    return app.webPassword.login(body?.password);
  },

  /** The web dashboards page: signs the browser out (`?session=`). */
  async postWebLogout({ homey, query }: { homey: Homey, query?: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    app.webPassword.logout(query?.session);
    return null;
  },

  /** The web dashboards page: the open popups (after a reconnect, so a screen that was offline catches up). */
  async getWebPopups({ homey, query }: { homey: Homey, query?: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.popups.all();
  },

  /** The web dashboards page: a popup's picture, `{type, data}` (a camera's is read again on every call). */
  async getWebPopupImage({ homey, query, params }: { homey: Homey, query?: Record<string, string>, params: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.popups.imageFromSession(params.id);
  },

  /** The web dashboards page: the answer to a question (`{answer: true|false}`); the first one from any screen wins. */
  async postWebPopupAnswer({ homey, query, params, body }: {
    homey: Homey, query?: Record<string, string>, params: Record<string, string>, body: { answer?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    assertWebSession(app, query);
    return app.popups.answerFromSession(params.id, body?.answer);
  },

  /**
   * The prompt page a Popups widget opens in the phone app's in-app browser (`settings/popup.html`), which has no login:
   * public, so only the popup's token (`{t}`, in the body) lets it read the popup, its picture or answer it. Its first
   * call asks for the strings (`{strings: true}`); its polls don't.
   */
  async postPopup({ homey, params, body }: { homey: Homey, params: Record<string, string>, body: { t?: unknown, strings?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    const popup = app.popups.page(params.id, body?.t);
    if (body?.strings !== true) return popup;
    const language = homey.i18n.getLanguage();
    const strings = await app.web.appStrings(language);
    return { ...popup, language, strings: (strings as any)?.popups ?? {} };
  },

  async postPopupImage({ homey, params, body }: { homey: Homey, params: Record<string, string>, body: { t?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    return app.popups.imageWithToken(params.id, body?.t);
  },

  async postPopupAnswer({ homey, params, body }: { homey: Homey, params: Record<string, string>, body: { t?: unknown, answer?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    return app.popups.answerWithToken(params.id, body?.answer, body?.t);
  },
};
