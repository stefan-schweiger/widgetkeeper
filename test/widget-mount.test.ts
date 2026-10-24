// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey as fakeAppHomey } from './helpers/fakeHomey.js';
import { fakeFrame, frameElements, mountName } from './helpers/fakeFrame.js';
import { loadMount, loadWidget, type WidgetName } from './helpers/loadWidget.js';
import { spyApp } from './helpers/spyApp.js';
import { WEB_APIS } from '../api.js';
import { callWidgetRoute } from '../lib/widgetRoutes.js';

// Each widget's mount.js wires it to a Homey: index.html with the frame's own, the Smart Stack with a stand-in.
const WIDGETS = readdirSync('widgets', { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'stack').map(d => d.name as WidgetName);

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('widget mount.js', () => {
  it.each(WIDGETS)('%s: index.html mounts it with the body and its classes', (id) => {
    const html = readFileSync(`widgets/${id}/public/index.html`, 'utf8');
    expect(html).toContain('<script src="mount.js"></script>');
    expect(html).toContain(`${mountName(id)}(Homey, { root: document.getElementById('root'), frame: document.body });`);
    const win = loadMount(id);
    expect(win[mountName(id)].frameClass).toBe(html.match(/<body class="([^"]+)">/)![1]);
  });

  it.each(WIDGETS)('%s: mounts into any element and tells Homey it is ready', async (id) => {
    const win = loadWidget(id);
    loadMount(id);
    const { frame, root } = frameElements();
    // Every API call fails, so every widget takes its error path.
    const Homey = fakeFrame({ device: { id: 'd1' }, slot1: { id: 'd1:measure_temperature' }, flow1: { id: 'flow:f1' } });
    expect(() => win[mountName(id)](Homey, { root, frame })).not.toThrow();
    await vi.advanceTimersByTimeAsync(2000);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    expect(root.childElementCount).toBeGreaterThan(0);
  });

  // A Smart Stack keeps every page mounted: the ones that redraw or poll on a timer stop it while another page shows.
  it.each(['cameras', 'charts', 'electricity', 'media', 'sparklines', 'timers'] as WidgetName[])("%s: answers the Smart Stack's setVisible", async (id) => {
    const win = loadWidget(id);
    loadMount(id);
    const root = document.createElement('div');
    document.body.append(root);
    const page = win[mountName(id)](fakeFrame({ device: { id: 'd1' }, slot1: { id: 'd1:measure_temperature' } }), { root, frame: root });
    await vi.advanceTimersByTimeAsync(0);
    expect(typeof page?.setVisible).toBe('function');
    expect(() => { page.setVisible(false); page.setVisible(true); }).not.toThrow();
  });
});

/**
 * Settings that give every widget something to ask for: a device, a slot, a chart, a flow, a variable, a counter, a
 * dashboard, a board … (each widget reads only its own).
 */
const SETTINGS = {
  device: { id: 'd1', name: 'Device' },
  capability: { id: 'measure_temperature', name: 'Temperature' },
  sensor: { id: 'd2:measure_temperature', name: 'Sensor' },
  slot1: { id: 'd1:measure_temperature', name: 'Device · Temperature' },
  second1: { id: 'measure_humidity', name: 'Humidity' },
  chart1: { id: 'd1:measure_power', name: 'Device · Power' },
  flow1: { id: 'flow:f1', name: 'Movie' },
  variable: { id: 'v1', name: 'Guests' },
  counter1: { id: 'Filter', name: 'Filter' },
  dashboard: { id: 'dash1', name: 'Hall' },
  dashboard1: { id: 'dash1', name: 'Hall' },
  col1: { id: 'measure_temperature', name: 'Temperature' },
  board: 'Kitchen',
  source: 'variable',
  name: 'Hall',
  showWeather: true,
  url: 'https://example.com/',
};

/** Widgets that make no request of their own here: the Spacer has no API, Web Page asks only for an address with a location in it. */
const NO_REQUESTS = ['spacer', 'webpage'];

describe('widget mount.js: its requests reach its own routes', () => {
  it.each(WIDGETS.filter(id => !NO_REQUESTS.includes(id)))('%s', async (id) => {
    const win = loadWidget(id);
    loadMount(id);
    const { frame, root } = frameElements();
    // Dashboard Shortcuts only works on a web dashboard, whose widget instances are `web-<dashboard>-<widget>`.
    const Homey = fakeFrame(SETTINGS, { deviceIds: ['d1'], instance: id === 'shortcuts' ? 'web-dash1-w1' : 'w1' });
    win[mountName(id)](Homey, { root, frame });
    await vi.advanceTimersByTimeAsync(2000);
    const requests = Homey.api.mock.calls as unknown as [string, string, unknown?][];
    expect(requests.length).toBeGreaterThan(0);

    const routes = Object.values<any>(manifest.widgets[id].api ?? {}).map(r => `${r.method} ${r.path}`);
    const homey = fakeAppHomey(fakeApi({}));
    homey.manifest = { ...homey.manifest, widgets: manifest.widgets };
    const { app, calls } = spyApp();
    homey.app = app;
    for (const [method, path, body] of requests) {
      const [pathname, qs] = path.split('?');
      expect([id, `${method} ${pathname}`, routes.includes(`${method} ${pathname}`)]).toEqual([id, `${method} ${pathname}`, true]);
      // The route takes what the widget sends: its handler runs through to the services without a missing argument.
      const query = Object.fromEntries(new URLSearchParams(qs ?? ''));
      await callWidgetRoute(homey, WEB_APIS, id, method, pathname, query, body ?? {});
    }
    expect(calls.length).toBeGreaterThan(0);
    // A device widget asks about the devices it was given.
    if (manifest.widgets[id].devices) expect([id, JSON.stringify(calls).includes('"d1"')]).toEqual([id, true]);
  });
});
