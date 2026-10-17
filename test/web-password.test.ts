import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import WebDashboardService, { WEB_ENABLED_SETTING } from '../lib/WebDashboardService.js';
import WebPassword, { WEB_PASSWORD_SETTING, WEB_SESSIONS_SETTING } from '../lib/WebPassword.js';
import api from '../api.js';

vi.mock('homey-api', () => homeyApiMock);

const app = JSON.parse(readFileSync('app.json', 'utf8'));

function setup({ enabled = true, now = () => Date.now() } = {}) {
  const homey = fakeHomey(fakeApi({}));
  homey.manifest = { ...homey.manifest, widgets: app.widgets };
  if (enabled) homey.settings.set(WEB_ENABLED_SETTING, true);
  const log = vi.fn();
  const web = new WebDashboardService(homey, log, {});
  const password = new WebPassword(homey, log, now);
  homey.app = { web, webPassword: password, log, debug: vi.fn() };
  homey.cloud = { getHomeyId: async () => 'homey-id' };
  return { homey, web, password, log };
}

describe('web dashboards password', () => {
  it('checks one sign-in at a time, so a burst of guesses is locked out like single ones', async () => {
    const { password } = setup();
    await password.setPassword('correct horse');
    const results = await Promise.all([...Array.from({ length: 8 }, () => password.login('wrong guess')), password.login('correct horse')]);
    expect(results.filter(r => r.ok)).toHaveLength(0);
    expect(results.at(-1)).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('keeps only a salted hash, and signs a browser in with the right password', async () => {
    const { homey, password } = setup();
    expect(password.isSet).toBe(false);
    await expect(password.login('whatever')).resolves.toEqual({ ok: false, reason: 'notSet' });
    await expect(password.setPassword('short')).resolves.toEqual({ ok: false, reason: 'tooShort' });
    await expect(password.setPassword('correct horse')).resolves.toEqual({ ok: true });
    expect(JSON.stringify(homey.settings.get(WEB_PASSWORD_SETTING))).not.toContain('correct horse');
    await expect(password.login('wrong horse')).resolves.toEqual({ ok: false, reason: 'wrong' });
    const res = await password.login('correct horse');
    expect(res.ok).toBe(true);
    const token = (res as any).token;
    expect(password.check(token)).toBe(true);
    expect(password.check('nope')).toBe(false);
    // Only the token's hash is stored.
    expect(JSON.stringify(homey.settings.get(WEB_SESSIONS_SETTING))).not.toContain(token);
    // A restart keeps the browser signed in.
    expect(new WebPassword(homey, vi.fn()).check(token)).toBe(true);
    password.logout(token);
    expect(password.check(token)).toBe(false);
  });

  it('signs every browser out when the password changes or is removed', async () => {
    const { password } = setup();
    await password.setPassword('first password');
    const { token } = (await password.login('first password')) as any;
    await password.setPassword('second password');
    expect(password.check(token)).toBe(false);
    const { token: second } = (await password.login('second password')) as any;
    await password.setPassword('');
    expect(password.isSet).toBe(false);
    expect(password.check(second)).toBe(false);
  });

  it('locks the login after five wrong passwords, longer each time', async () => {
    let now = 1e12;
    const { password } = setup({ now: () => now });
    await password.setPassword('correct horse');
    for (let i = 0; i < 4; i++) await expect(password.login('x')).resolves.toEqual({ ok: false, reason: 'wrong' });
    await expect(password.login('x')).resolves.toEqual({ ok: false, reason: 'locked', retryAfter: 30 });
    // Locked: even the right one waits.
    await expect(password.login('correct horse')).resolves.toMatchObject({ reason: 'locked' });
    now += 31e3;
    await expect(password.login('x')).resolves.toEqual({ ok: false, reason: 'locked', retryAfter: 60 });
    now += 61e3;
    await expect(password.login('correct horse')).resolves.toMatchObject({ ok: true });
    await expect(password.login('x')).resolves.toEqual({ ok: false, reason: 'wrong' });
  });
});

describe('web dashboards password: the app API', () => {
  it('sets the password from the app settings, and signs a browser in', async () => {
    const { homey, password } = setup();
    await expect(api.putWebPassword({ homey, body: { password: 'correct horse' } })).resolves.toEqual({ ok: true });
    await expect(api.getWebPassword({ homey })).resolves.toEqual({ set: true });
    const res = await api.postWebLogin({ homey, body: { password: 'correct horse' } });
    expect(password.check((res as any).token)).toBe(true);
    await api.postWebLogout({ homey, query: { session: (res as any).token } });
    expect(password.check((res as any).token)).toBe(false);
  });

  it('answers the web routes only with a session while a password is set', async () => {
    const { homey, web, password } = setup();
    // No password: the key alone is enough, as before.
    await expect(api.getWebSetup({ homey, query: {} })).resolves.toHaveProperty('dashboards');
    await password.setPassword('correct horse');
    const setupRes = await api.getWebSetup({ homey, query: {} });
    expect(setupRes).toMatchObject({ passwordRequired: true, language: 'en' });
    expect(setupRes).not.toHaveProperty('dashboards');
    expect(setupRes).not.toHaveProperty('homeyId');
    await expect(api.putWebDashboard({ homey, query: {}, body: { name: 'x' } })).rejects.toThrow(/password required/);
    await expect(api.getWebDevices({ homey, query: { type: 'lights', session: 'nope' } })).rejects.toThrow(/password required/);
    await expect(api.postWebCall({ homey, query: {}, body: { type: 'timers', method: 'GET', path: '/state' } })).rejects.toThrow(/password required/);
    await expect(api.deleteWebDashboard({ homey, query: {}, params: { id: 'x' } })).rejects.toThrow(/password required/);
    const { token } = (await password.login('correct horse')) as any;
    const session = { session: token };
    await expect(api.getWebSetup({ homey, query: session })).resolves.toHaveProperty('dashboards');
    const saved = await api.putWebDashboard({ homey, query: session, body: { name: 'Kitchen', columns: [[]] } });
    expect(web.list()).toHaveLength(1);
    await api.deleteWebDashboard({ homey, query: session, params: { id: saved.id } });
    expect(web.list()).toHaveLength(0);
  });

  it('refuses to sign in while the web dashboards are off', async () => {
    const { homey, password } = setup({ enabled: false });
    await password.setPassword('correct horse');
    await expect(api.postWebLogin({ homey, body: { password: 'correct horse' } })).rejects.toThrow(/turned off/);
  });
});
