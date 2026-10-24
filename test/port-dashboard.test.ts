import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ESM script without types
import { portDashboard } from '../scripts/port-dashboard.mjs';

// `npm run port-dashboard` turns a Homey dashboard into a web dashboard (scripts/port-dashboard.mjs).
const APP = 'com.example.app';
const manifests = {
  weather: { settings: [{ id: 'density' }, { id: 'rows' }] },
  lights: { settings: [{ id: 'palette' }], devices: {} },
};
const app = (id: string, widget: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ id, title: 'Shown', titleHidden: false, type: 'app_webview', data: { appWidgetId: `homey:app:${APP}:${widget}`, ...data }, ...extra });

describe('porting a Homey dashboard', () => {
  it('keeps the columns, ids, titles, settings and devices of our widgets', () => {
    const { dashboard, skipped, names } = portDashboard({
      id: 'dash-1', name: 'Kitchen',
      columns: [
        { id: 'c1', widgets: [app('w1', 'weather', { settings: { density: 'detailed', showNext: true } }, { titleHidden: true })] },
        { id: 'c2', widgets: [app('w2', 'lights', { settings: { palette: 'warm' }, deviceIds: ['d1', 'd2'] })] },
      ],
    }, manifests, APP);
    expect(skipped).toEqual([]);
    expect(dashboard).toEqual({
      id: 'dash-1', name: 'Kitchen', theme: 'auto', background: 'default',
      columns: [
        [{ id: 'w1', type: 'weather', title: '', settings: { density: 'detailed' }, deviceIds: [] }],
        [{ id: 'w2', type: 'lights', title: 'Shown', settings: { palette: 'warm' }, deviceIds: ['d1', 'd2'] }],
      ],
    });
    expect(names).toEqual({ 'web-dash-1-w1': 'w1', 'web-dash-1-w2': 'w2' });
  });

  it("leaves out Homey's own widgets and unknown ones of ours, and keeps other apps' as they are", () => {
    const { dashboard, skipped } = portDashboard({
      id: 'd', name: 'Mixed',
      columns: [{ id: 'c', widgets: [
        { id: 'n1', title: null, titleHidden: true, type: 'light_group', data: { name: 'Living Room', lightIds: ['x'] } },
        app('n2', 'popups'),
        { id: 'n3', title: 'Clock', titleHidden: false, type: 'app_webview', data: { appWidgetId: 'homey:app:com.other:clock', settings: { size: 2 } } },
      ] }],
    }, manifests, APP);
    expect(skipped.map((s: { type: string }) => s.type)).toEqual(['light_group', 'popups']);
    expect(dashboard.columns).toEqual([[{ id: 'n3', type: 'homey:app:com.other:clock', title: 'Clock', settings: { size: 2 }, deviceIds: [] }]]);
  });

  it('puts columns past the sixth into the sixth', () => {
    const columns = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, widgets: [app(`w${i}`, 'weather')] }));
    const { dashboard } = portDashboard({ id: 'd', name: 'Wide', columns }, manifests, APP);
    expect(dashboard.columns).toHaveLength(6);
    expect(dashboard.columns[5].map((w: { id: string }) => w.id)).toEqual(['w5', 'w6', 'w7']);
  });
});
