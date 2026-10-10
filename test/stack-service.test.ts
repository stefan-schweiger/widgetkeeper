import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import { API_KEY_SETTING, KeyError } from '../lib/PersonalApiKey.js';
import StackService, { dashboardPages, STACK_RESUME_EVENT, STACK_SHOW_EVENT, STACK_TYPES } from '../lib/StackService.js';
import stackApi, { PAGE_APIS } from '../widgets/stack/api.js';
import { findWidgetRoute } from '../lib/widgetRoutes.js';

vi.mock('homey-api', () => homeyApiMock);

const APP = 'com.thomassidor.widgetkeeper';
const ours = (id: string, widget: string, data: object = {}) =>
  ({ id, title: null, type: 'app_webview', data: { appWidgetId: `homey:app:${APP}:${widget}`, ...data } });

/** A dashboard as `dashboards.getDashboards()` gives it (checked on the Homey, 2026-10-10). */
const KITCHEN = {
  id: 'dash1',
  name: 'Kitchen stack',
  columns: [
    {
      id: 'c1',
      widgets: [
        ours('w-timers', 'timers', { settings: { minutes1: 5 } }),
        { id: 'w-native', title: null, type: 'light_group', data: { lightIds: ['l1'] } },
        ours('w-cams', 'cameras', { deviceIds: ['cam1', 'cam2'], settings: { refresh: '10' } }),
      ],
    },
    {
      id: 'c2',
      widgets: [
        ours('w-stack', 'stack', { settings: { dashboard: { id: 'dash1' } } }),
        { id: 'w-other', type: 'app_webview', data: { appWidgetId: 'homey:app:com.other:clock', settings: {} } },
        ours('w-media', 'media', { settings: { device: { id: 'spk1', name: 'Kitchen' } } }),
      ],
    },
  ],
};

function setup(scopes = ['homey.dashboard.readonly']) {
  const homey = fakeHomey(fakeApi({}));
  homey.__ = (key: string, tokens?: any) => (key === 'stack.pageCount' ? `${tokens.count} widgets` : undefined);
  const getDashboards = vi.fn(async () => {
    if (!scopes.some(s => s.startsWith('homey.dashboard') || s === 'homey')) throw new Error('Missing Scopes: homey.dashboard.readonly');
    return { dash1: KITCHEN, dash2: { id: 'dash2', name: 'Energy', columns: [] } };
  });
  keyApis.set('key', { sessions: { getSessionMe: async () => ({ scopes }) }, dashboards: { getDashboards } });
  homey.settings.set(API_KEY_SETTING, 'key');
  return { homey, service: new StackService(homey, () => {}), getDashboards };
}

afterEach(() => { keyApis.clear(); vi.useRealTimers(); });

describe('dashboardPages', () => {
  it("keeps this app's widgets, column by column, without a stack in the stack", () => {
    expect(dashboardPages(KITCHEN, APP)).toEqual([
      { id: 'w-timers', type: 'timers', title: null, settings: { minutes1: 5 }, deviceIds: [] },
      { id: 'w-cams', type: 'cameras', title: null, settings: { refresh: '10' }, deviceIds: ['cam1', 'cam2'] },
      { id: 'w-media', type: 'media', title: null, settings: { device: { id: 'spk1', name: 'Kitchen' } }, deviceIds: [] },
    ]);
  });

  it('copes with a dashboard without columns', () => {
    expect(dashboardPages({ id: 'x' }, APP)).toEqual([]);
    expect(dashboardPages(null, APP)).toEqual([]);
  });

  it('knows every widget of the app but the stack', () => {
    const app = JSON.parse(readFileSync('app.json', 'utf8'));
    expect([...STACK_TYPES].sort()).toEqual(Object.keys(app.widgets).filter(id => id !== 'stack').sort());
    // The widget's own list (TYPES in widget.js) must match too.
    const js = readFileSync('widgets/stack/public/widget.js', 'utf8');
    for (const type of STACK_TYPES) expect(js).toMatch(new RegExp(`\\b${type}: 'mount\\w+Widget'`));
  });
});

describe('StackService', () => {
  it('reads the pages through the API key, sharing a read for a minute', async () => {
    const { service, getDashboards } = setup();
    const res = await service.getPages('dash1');
    expect(res.pages.map(p => p.id)).toEqual(['w-timers', 'w-cams', 'w-media']);
    expect(res.missing).toBeUndefined();
    await service.getPages('dash1');
    expect(getDashboards).toHaveBeenCalledTimes(1);
  });

  it('says when the dashboard is gone', async () => {
    const { service } = setup();
    expect(await service.getPages('nope')).toEqual({ pages: [], missing: true, requests: [], now: expect.any(Number) });
  });

  it("turns a key without the permission into keyScope, and no key into noKey", async () => {
    const { service, homey } = setup(['homey.flow.start']);
    await expect(service.getPages('dash1')).rejects.toMatchObject({ reason: 'keyScope' });
    homey.settings.unset(API_KEY_SETTING);
    await expect(service.getPages('dash1')).rejects.toBeInstanceOf(KeyError);
    await expect(service.getPages('dash1')).rejects.toMatchObject({ reason: 'noKey' });
  });

  it('lists the dashboards by name with their page count', async () => {
    const { service } = setup();
    expect(await service.listDashboards('')).toEqual([
      { id: 'dash2', name: 'Energy', description: '0 widgets' },
      { id: 'dash1', name: 'Kitchen stack', description: '3 widgets' },
    ]);
    expect((await service.listDashboards('kitch')).map(d => d.id)).toEqual(['dash1']);
  });

  it('keeps Flow requests until they run out, newest first, and ends them all on resume', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    const { service, homey } = setup();
    service.show('cameras', 5);
    service.show('media', 10);
    const t0 = Date.now();
    expect(homey.api.realtime).toHaveBeenCalledWith(STACK_SHOW_EVENT, { type: 'cameras', until: t0 + 5 * 60e3, now: t0 });
    expect(service.activeRequests()).toEqual([{ type: 'media', until: t0 + 10 * 60e3 }, { type: 'cameras', until: t0 + 5 * 60e3 }]);
    vi.advanceTimersByTime(6 * 60e3);
    expect(service.activeRequests().map(r => r.type)).toEqual(['media']);
    service.resume();
    expect(service.activeRequests()).toEqual([]);
    expect(homey.api.realtime).toHaveBeenLastCalledWith(STACK_RESUME_EVENT, {});
  });

  it('says in the dashboard list what the API key needs, as an item the widget skips', async () => {
    const { service, homey } = setup(['homey.flow.start']);
    homey.__ = (key: string) => ({ 'stack.keyScope': 'The API key may not read dashboards.', 'stack.keyHint': 'Add one' } as any)[key];
    expect(await service.listDashboards('')).toEqual([{ id: 'none', name: 'The API key may not read dashboards.', description: 'Add one' }]);
    homey.settings.unset(API_KEY_SETTING);
    expect((await service.listDashboards(''))[0]).toMatchObject({ id: 'none', name: 'noKey' });
  });

  it("doesn't let a hanging read hold up the diagnostics", async () => {
    vi.useFakeTimers();
    const { service, getDashboards } = setup();
    getDashboards.mockImplementation(() => new Promise(() => {}));
    const report = service.describe();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await report).dashboards).toBe('timeout');
  });

  it('refuses an unknown widget or no time', () => {
    const { service } = setup();
    expect(() => service.show('stack', 5)).toThrow();
    expect(() => service.show('nope', 5)).toThrow();
    expect(() => service.show('media', 0)).toThrow();
  });
});

describe('stack widget API', () => {
  const app = JSON.parse(readFileSync('app.json', 'utf8'));
  const homeyWith = (appExtra: object) => {
    const homey = fakeHomey(fakeApi({}));
    homey.manifest = { ...homey.manifest, widgets: app.widgets };
    homey.app = { log: vi.fn(), debug: vi.fn(), ...appExtra };
    return homey;
  };

  it("finds a page's route only among its widget's own", () => {
    const homey = homeyWith({});
    expect(findWidgetRoute(homey, PAGE_APIS, 'timers', 'POST', '/start')).toBe('start');
    expect(findWidgetRoute(homey, PAGE_APIS, 'timers', 'GET', '/state')).toBe('getState');
    expect(findWidgetRoute(homey, PAGE_APIS, 'timers', 'GET', '/start')).toBeNull();
    expect(findWidgetRoute(homey, PAGE_APIS, 'stack', 'POST', '/call')).toBeNull();
    expect(findWidgetRoute(homey, PAGE_APIS, '../../api', 'GET', '/diagnostics')).toBeNull();
  });

  it("hands a page's request to its widget's API, as from its own frame", async () => {
    const startTimer = vi.fn(async () => ({ instance: 'w-timers', timers: [], now: 1 }));
    const homey = homeyWith({ timers: { startTimer } });
    const res = await stackApi.call({ homey, body: { type: 'timers', method: 'POST', path: '/start', body: { instance: 'w-timers', minutes: 5, label: '' } } });
    expect(startTimer).toHaveBeenCalledWith('w-timers', 5, '');
    expect(res).toEqual({ instance: 'w-timers', timers: [], now: 1 });
    await expect(stackApi.call({ homey, body: { type: 'timers', method: 'DELETE', path: '/start' } })).rejects.toThrow(/Not a widget route/);
  });

  it('passes the query as strings', async () => {
    const getState = vi.fn(async () => ({ instance: 'w', timers: [], now: 1 }));
    const homey = homeyWith({ timers: { getState } });
    await stackApi.call({ homey, body: { type: 'timers', method: 'GET', path: '/state', query: { instance: 'w' } } });
    expect(getState).toHaveBeenCalledWith('w');
  });

  it('answers a key problem with its reason', async () => {
    const homey = homeyWith({ stack: { getPages: async () => { throw new KeyError('noKey'); } } });
    expect(await stackApi.getPages({ homey, query: { dashboardId: 'd' } })).toEqual({ ok: false, reason: 'noKey', language: 'en' });
  });
});
