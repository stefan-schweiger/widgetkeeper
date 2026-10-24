import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import { webApp } from './helpers/webApp.js';
import { WEB_REMOTE_SETTING } from '../lib/WebDashboardService.js';
import api from '../api.js';

vi.mock('homey-api', () => homeyApiMock);

afterEach(() => { keyApis.clear(); });

const routes: Record<string, { method: string, path: string, public?: boolean }> = JSON.parse(readFileSync('app.json', 'utf8')).api;

/**
 * The `/web/…` routes that answer without a web session: the setup (which answers `passwordRequired` itself), the
 * settings page's own (address and password) and signing in and out. Every other `/web/…` route is the page's and
 * must refuse while the web dashboards are off, away from home without remote access, and without the session
 * while a password is set; a new route lands in the table below by itself.
 */
const OPEN = ['getWebSetup', 'getWebAddress', 'getWebPassword', 'putWebPassword', 'postWebLogin', 'postWebLogout'];
const GUARDED = Object.entries(routes).filter(([name, r]) => r.path.startsWith('/web/') && !OPEN.includes(name)).map(([name]) => name);

/** A route's call with the arguments every handler takes; `query` carries `away` and `session`. */
const call = (homey: any, name: string, query: Record<string, string> = {}) =>
  (api as any)[name]({ homey, query, params: { id: 'nope' }, body: {} });

/** The error a call ends with, or '' when it answers. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe('web routes: who may call them', () => {
  it('names only routes that exist, and guards the page\'s thirteen and any new one', () => {
    for (const name of OPEN) expect([name, name in routes]).toEqual([name, true]);
    for (const name of [...OPEN, ...GUARDED]) expect([name, typeof (api as any)[name]]).toEqual([name, 'function']);
    expect(GUARDED).toEqual(expect.arrayContaining([
      'getWebDevices', 'getWebValues', 'postWebAutocomplete', 'putWebDashboard', 'putWebFront', 'deleteWebDashboard',
      'postWebDashboardCopy', 'getWebBackup', 'putWebBackup', 'postWebCall', 'getWebPopups', 'getWebPopupImage', 'postWebPopupAnswer',
    ]));
  });

  it.each(GUARDED)('%s refuses while the web dashboards are off', async (name) => {
    const { homey } = webApp({ enabled: false });
    expect(await failure(call(homey, name))).toMatch(/turned off/);
  });

  it.each(GUARDED)('%s refuses away from home until remote access is on', async (name) => {
    const { homey } = webApp();
    expect(await failure(call(homey, name, { away: '1' }))).toMatch(/turned off away from home/);
    homey.settings.set(WEB_REMOTE_SETTING, true);
    expect(await failure(call(homey, name, { away: '1' }))).not.toMatch(/turned off/);
  });

  it.each(GUARDED)('%s needs the session while a password is set', async (name) => {
    const { homey, password } = webApp();
    expect(await failure(call(homey, name))).not.toMatch(/password required|turned off/);
    await password.setPassword('correct horse');
    expect(await failure(call(homey, name))).toMatch(/password required/);
    expect(await failure(call(homey, name, { session: 'not-a-session' }))).toMatch(/password required/);
    const { token } = await password.login('correct horse') as { token: string };
    expect(await failure(call(homey, name, { session: token }))).not.toMatch(/password required|turned off/);
    password.logout(token);
    expect(await failure(call(homey, name, { session: token }))).toMatch(/password required/);
  });
});

describe('web routes: the editor\'s autocompletes', () => {
  /** The Smart Stack's dashboards (read with the app's stored key) and a Flow Buttons slot (no key). */
  function setup() {
    const dashboards = vi.fn(async () => [{ id: 'd1', name: 'Hall' }]);
    const flowList = vi.fn(async () => [{ id: 'flow:f1', name: 'Movie' }]);
    const app = webApp({ autocompletes: { stack: { dashboard: dashboards }, flows: { flow1: flowList } } });
    keyApis.set('weak-key', { sessions: { getSessionMe: async () => ({ scopes: ['homey.app.control'] }) } });
    keyApis.set('dashboards-key', { sessions: { getSessionMe: async () => ({ scopes: ['homey.dashboard.readonly'] }) } });
    const ask = (body: object) => api.postWebAutocomplete({ homey: app.homey, query: {}, body: { query: 'h', settings: { a: 1 }, ...body } });
    return { ...app, dashboards, flowList, ask };
  }

  it("lists the Smart Stack's dashboards only when the page's own key may read them", async () => {
    const { dashboards, ask } = setup();
    // The stored key could read them; a page whose key may not gets the reason as the only item, not the list.
    for (const [key, reason] of [[undefined, 'keyInvalid'], ['', 'keyInvalid'], ['unknown-key', 'keyInvalid'], ['weak-key', 'keyScope']]) {
      const items = await ask({ type: 'stack', setting: 'dashboard', key });
      expect([key, items]).toEqual([key, [expect.objectContaining({ id: 'none', name: reason })]]);
    }
    expect(dashboards).not.toHaveBeenCalled();
    await expect(ask({ type: 'stack', setting: 'dashboard', key: 'dashboards-key' })).resolves.toEqual([{ id: 'd1', name: 'Hall' }]);
    expect(dashboards).toHaveBeenCalledWith('h', { a: 1 });
  });

  it('answers the other autocompletes without asking for a key', async () => {
    const { flowList, ask } = setup();
    await expect(ask({ type: 'flows', setting: 'flow1' })).resolves.toEqual([{ id: 'flow:f1', name: 'Movie' }]);
    expect(flowList).toHaveBeenCalledWith('h', { a: 1 });
    await expect(ask({ type: 'flows', setting: 'nope' })).rejects.toThrow(/No autocomplete/);
  });

  // Only the listeners' own names: an object's property (`constructor`, `__proto__` …) is no autocomplete, also beside the
  // stored-key one (the security audit's S4; the service's own check is in web-dashboards.test.ts).
  it("refuses a setting or widget that's only an object's property, with any key", async () => {
    const { dashboards, flowList, ask } = setup();
    for (const [type, setting] of [['stack', 'constructor'], ['stack', '__proto__'], ['__proto__', 'dashboard'], ['constructor', 'flow1'], ['flows', 'toString']]) {
      await expect(ask({ type, setting, key: 'dashboards-key' })).rejects.toThrow(/No autocomplete/);
    }
    expect(dashboards).not.toHaveBeenCalled();
    expect(flowList).not.toHaveBeenCalled();
  });
});

describe('the personal API key routes', () => {
  const KEY = 'pk-0123456789abcdef-secret';

  it('say whether a key is saved, never the key, and never log it', async () => {
    const { homey, log } = webApp();
    await expect(api.getVariablesKey({ homey })).resolves.toEqual({ set: false });
    keyApis.set(KEY, { sessions: { getSessionMe: async () => ({ scopes: ['homey.logic'] }) } });
    const saved = await api.putVariablesKey({ homey, body: { key: ` ${KEY} ` } });
    expect(saved).toMatchObject({ ok: true, variables: true });
    await expect(api.getVariablesKey({ homey })).resolves.toEqual({ set: true });
    // A key Homey refuses: logged as refused, without the key.
    const refused = await api.putVariablesKey({ homey, body: { key: `${KEY}-revoked` } });
    expect(refused).toEqual({ ok: false, reason: 'keyInvalid' });
    expect(log).toHaveBeenCalled();
    const out = JSON.stringify([saved, refused, await api.getVariablesKey({ homey }), log.mock.calls.map(c => c.map(String))]);
    expect(out).not.toContain(KEY);
    // Anything but a string removes it, like ''.
    await expect(api.putVariablesKey({ homey, body: { key: 42 } })).resolves.toMatchObject({ ok: true, variables: false });
    await expect(api.getVariablesKey({ homey })).resolves.toEqual({ set: false });
  });
});
