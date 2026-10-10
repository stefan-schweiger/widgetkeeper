// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget, type WidgetName } from './helpers/loadWidget.js';

// Each widget's mount.js wires it to a Homey: index.html with the frame's own, the Smart Stack with a stand-in.
const WIDGETS = readdirSync('widgets', { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'stack').map(d => d.name as WidgetName);

const mountName = (id: string) => readFileSync(`widgets/${id}/public/mount.js`, 'utf8').match(/window\.(mount\w+Widget) =/)![1];

/** A Homey stand-in whose API calls all fail, so every widget takes its error path. */
function fakeHomey(settings: object = {}) {
  return {
    api: vi.fn(async () => { throw new Error('offline'); }),
    on: vi.fn(),
    ready: vi.fn(),
    setHeight: vi.fn(),
    getSettings: () => settings,
    getDeviceIds: () => ['d1'],
    getWidgetInstanceId: () => 'w1',
    hapticFeedback: vi.fn(),
    __: (key: string) => key,
  };
}

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
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    document.body.append(frame);
    const Homey = fakeHomey({ device: { id: 'd1' }, slot1: { id: 'd1:measure_temperature' }, flow1: { id: 'flow:f1' } });
    expect(() => win[mountName(id)](Homey, { root, frame })).not.toThrow();
    await vi.advanceTimersByTimeAsync(2000);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    expect(root.childElementCount).toBeGreaterThan(0);
  });
});
