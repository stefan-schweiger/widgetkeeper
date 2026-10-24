import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDevice, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import { bootApp } from './helpers/fakeApp.js';
import Diagnostics from '../lib/Diagnostics.js';
import Secrets from '../lib/secrets.js';
import { WEB_PASSWORD_SETTING } from '../lib/WebPassword.js';

vi.mock('homey', () => import('./helpers/homeySdk.js').then(m => m.homeyMock));
vi.mock('homey-api', () => homeyApiMock);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); keyApis.clear(); });

const KEY = 'pk-diagnostics-0123456789abcdef';
const PASSWORD = 'correct horse battery';
const RTSP = 'rtsp://admin:camera-secret@192.168.1.50:554/main';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A Reolink-like camera: a snapshot image and two RTSP streams, whose URL (with the password) only `getVideoUrl` gives. */
function camera() {
  return Object.assign(fakeDevice({ id: 'cam1', name: 'Driveway camera', class: 'camera', caps: {} }), {
    images: [{ type: 'camera', id: 'snapshot', title: 'Snapshot', imageObj: { id: 'img1', url: '/api/image/img1', lastUpdated: '2026-10-24T09:59:00Z' } }],
    videos: [{ type: 'camera', id: 'main', title: 'Camera (main)', videoObj: { id: 'vid1', type: 'rtsp' } }],
  });
}

describe('diagnostics', () => {
  it('report no secret: the API key, the password, its hash, sessions, popup tokens or a camera address', async () => {
    const getVideoUrl = vi.fn(async () => RTSP);
    keyApis.set(KEY, {
      sessions: { getSessionMe: async () => ({ scopes: ['homey'] }) },
      dashboards: { getDashboards: async () => ({}) },
    });
    const { app, homey } = await bootApp({ devices: [camera()], extraApi: { videos: { getVideoUrl } } });
    // The secrets in use: a saved key and a refused one, a password with a browser signed in and a wrong guess.
    expect(await app.apiKey.save(KEY)).toMatchObject({ ok: true });
    expect(await app.apiKey.save(`${KEY}-revoked`)).toEqual({ ok: false, reason: 'keyInvalid' });
    await app.webPassword.setPassword(PASSWORD);
    const { token } = await app.webPassword.login(PASSWORD) as { token: string };
    await app.webPassword.login(`${PASSWORD} wrong`);
    // Popups open on the screens, each with its token.
    void app.popups.ask({ target: 'all', text: 'Let the plumber in?', seconds: 60 });
    await app.popups.show({ target: 'name:hall', text: 'Dinner is ready', seconds: 60 });
    const tokens = [...(app.popups as any).open.values()].map((p: any) => p.token);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t: unknown) => typeof t === 'string' && t.length >= 16)).toBe(true);
    const stored = Secrets.for(homey).get(WEB_PASSWORD_SETTING) as { salt: string, hash: string };
    const secrets: Record<string, string> = {
      'API key': KEY, password: PASSWORD, 'password salt': stored.salt, 'password hash': stored.hash,
      'session token': token, 'session hash': sha256(token), 'popup token 1': tokens[0], 'popup token 2': tokens[1],
      'camera password': 'camera-secret', 'RTSP address': 'rtsp://',
    };

    for (const device of [undefined, 'cam1', 'Driveway']) {
      const report = await app.diagnostics.report(device);
      const text = JSON.stringify(report);
      const leaked = Object.entries(secrets).filter(([, secret]) => text.includes(secret)).map(([what]) => what);
      expect({ device, leaked }).toEqual({ device, leaked: [] });
      // Not vacuous: the report did read the devices, the cameras and the log.
      expect((report.cameras as any[]).map(c => c.id)).toEqual(['cam1']);
      expect((report.log as string[]).some(l => l.includes('The API key was not accepted'))).toBe(true);
    }
    expect(getVideoUrl).not.toHaveBeenCalled();
  });

  it('says which Node the app runs on, and finds a device by id or part of its name', async () => {
    const { app } = await bootApp({ devices: [camera()] });
    const report = await app.diagnostics.report('driveway');
    expect(report.node).toBe(process.version);
    expect(report.device).toMatchObject({ id: 'cam1', name: 'Driveway camera', class: 'camera' });
    expect((await app.diagnostics.report('cam1')).device).toMatchObject({ id: 'cam1' });
    expect((await app.diagnostics.report('porch')).device).toBe('No device matching "porch"');
  });

  it('keeps the last 500 log lines, errors with their stack', () => {
    const diagnostics = new Diagnostics({ manifest: {}, settings: { get: () => null } } as any);
    for (let i = 0; i < 600; i++) diagnostics.add('info', [`line ${i}`]);
    diagnostics.add('error', ['Read failed:', new Error('boom')]);
    const lines = (diagnostics as any).lines as string[];
    expect(lines).toHaveLength(500);
    expect(lines[0]).toMatch(/ line 101$/);
    expect(lines.at(-1)).toMatch(/ ERROR Read failed: Error: boom\n\s+at /);
  });

  it("reports the API's failure instead of the devices", async () => {
    const { app, api } = await bootApp();
    api.devices.getDevices.mockRejectedValue(new Error('Homey is busy'));
    const report = await app.diagnostics.report(undefined);
    expect(report.apiError).toMatch(/Homey is busy/);
    expect(report).not.toHaveProperty('devices');
  });
});
