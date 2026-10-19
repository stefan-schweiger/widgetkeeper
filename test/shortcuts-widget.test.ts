// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';
import { touch as fireTouch } from './helpers/touch.js';

let win: any;
beforeAll(() => { win = loadWidget('shortcuts'); loadMount('shortcuts'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.head.innerHTML = ''; document.body.innerHTML = ''; });

const state = (current: string | null, ...tiles: any[]) => ({ current, tiles });
const dash = (id: string, name: string) => ({ id, name });

function widget(s: any, extra: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onOpen = vi.fn();
  const onHaptic = vi.fn();
  const w = win.createShortcutsWidget(root, { onOpen, onHaptic, ...extra });
  w.setState(s);
  const rows = () => [...root.querySelectorAll<HTMLElement>('.sc-row')];
  const row = (i: number) => rows()[i];
  const message = () => root.querySelector<HTMLElement>('.sc-message')!;
  return { w, root, rows, row, onOpen, onHaptic, message };
}

describe('render', () => {
  it("shows one pill per tile: its colour and icon, then the dashboard's name", () => {
    const { rows, row } = widget(state(null, dash('a', 'Lights'), dash('b', 'Sensors'), { id: 'c', missing: true }), {
      tiles: [{ id: 'a', color: 'purple', icon: 'bulb' }, { id: 'b', color: 'nope', icon: 'nope' }, { id: 'c' }],
    });
    expect(rows().map(r => r.querySelector('.sc-name')!.textContent)).toEqual(['Lights', 'Sensors', 'Dashboard not found']);
    expect(rows().map(r => r.dataset.color)).toEqual(['purple', 'blue', 'blue']);
    expect(row(0).querySelector('.sc-icon path')!.getAttribute('d')).toBe(win.WidgetkeeperKit.icons.bulb.d);
    // An unknown icon is the dashboard glyph, filled.
    expect(row(1).querySelector('.sc-icon path')!.getAttribute('d')).toBe(win.WidgetkeeperKit.icons.dashboard.d);
    expect(row(1).querySelector('.sc-icon path')!.classList.contains('filled')).toBe(true);
    expect(row(2).classList.contains('missing')).toBe(true);
    expect(rows().map(r => r.getAttribute('role'))).toEqual(['link', 'link', null]);
  });

  it('has two columns unless set to one', () => {
    expect(widget(state(null, dash('a', 'A'))).root.dataset.columns).toBe('2');
    expect(widget(state(null, dash('a', 'A')), { columns: '1' }).root.dataset.columns).toBe('1');
  });

  it('marks the dashboard it is on', () => {
    const { rows, row } = widget(state('b', dash('a', 'Lights'), dash('b', 'Sensors')));
    expect(rows().map(r => r.classList.contains('current'))).toEqual([false, true]);
    expect(row(1).getAttribute('aria-current')).toBe('page');
    expect(row(1).hasAttribute('role')).toBe(false);
    expect(row(0).hasAttribute('aria-current')).toBe(false);
  });

  it('shows a persistent message instead of the pills', () => {
    const { w, rows, message } = widget(state(null, dash('a', 'A')));
    w.setMessage('Pick dashboards in the widget settings.');
    expect(rows()).toHaveLength(0);
    expect(message().textContent).toBe('Pick dashboards in the widget settings.');
  });

  it('takes a transient message over the pills, which stay', () => {
    const { w, rows, message } = widget(state(null, dash('a', 'A')));
    w.setMessage('Could not load the dashboards.', true);
    expect(rows()).toHaveLength(1);
    expect(message().classList.contains('error')).toBe(true);
    vi.advanceTimersByTime(8000);
    expect(message().style.display).toBe('none');
  });
});

describe('open', () => {
  it('opens a dashboard on a tap, with haptic feedback', () => {
    const { row, onOpen, onHaptic } = widget(state('x', dash('a', 'Lights'), dash('b', 'Sensors')));
    row(1).click();
    expect(onOpen).toHaveBeenCalledWith('b');
    expect(onHaptic).toHaveBeenCalledTimes(1);
  });

  it('opens on Enter, and on a touch tap but not a drag', () => {
    const { row, onOpen } = widget(state(null, dash('a', 'Lights')));
    row(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireTouch(row(0), 'touchstart', 10);
    fireTouch(row(0), 'touchmove', 40);
    fireTouch(row(0), 'touchend', 40);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireTouch(row(0), 'touchstart', 10);
    fireTouch(row(0), 'touchend', 12);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('does nothing for the dashboard it is on, or a missing one', () => {
    const { row, onOpen, onHaptic } = widget(state('a', dash('a', 'Lights'), { id: 'b', missing: true }));
    row(0).click();
    row(1).click();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onHaptic).not.toHaveBeenCalled();
  });
});

describe('mounted', () => {
  function mount(settings: object, instance: unknown = 'web-d-1-w1', api = vi.fn(async (_m: string, _p: string) => ({ state: state('d-1', dash('d-1', 'Home'), dash('x', 'Lights')), tileNames: { x: 'Lamps' } }))) {
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    document.body.append(frame);
    const Homey = {
      api, on: vi.fn(), ready: vi.fn(), setHeight: vi.fn(), hapticFeedback: vi.fn(), popup: vi.fn(),
      getSettings: () => settings, getDeviceIds: () => [], getWidgetInstanceId: () => instance, __: (key: string) => key,
    };
    win.mountShortcutsWidget(Homey, { root, frame });
    return { Homey, root, api };
  }
  const picked = { dashboard1: { id: 'd-1', name: 'Home' }, color1: 'green', dashboard2: { id: 'x', name: 'Lights' }, icon2: { id: 'bulb', name: 'Light bulb' }, dashboard3: { id: 'none', name: 'None' } };

  it("reads the picked dashboards with the instance, and opens one through Homey.popup('#/d/<id>')", async () => {
    const { Homey, root, api } = mount(picked);
    await vi.advanceTimersByTimeAsync(10);
    expect(api).toHaveBeenCalledWith('GET', expect.stringMatching(/^\/state\?ids=d-1,x.*&instance=web-d-1-w1$/));
    const rows = [...root.querySelectorAll<HTMLElement>('.sc-row')];
    expect(rows.map(r => r.querySelector('.sc-name')!.textContent)).toEqual(['Home', 'Lamps']);
    expect(rows.map(r => r.dataset.color)).toEqual(['green', 'blue']);
    expect(rows[0].classList.contains('current')).toBe(true);
    rows[1].click();
    expect(Homey.popup).toHaveBeenCalledWith('#/d/x');
  });

  it('says so outside a web dashboard, without asking the app', async () => {
    const { root, api, Homey } = mount(picked, '3f2c9a1e-homey-dashboard-widget');
    await vi.advanceTimersByTimeAsync(10);
    expect(api).not.toHaveBeenCalled();
    expect(root.querySelector('.sc-message')!.textContent).toBe('Dashboard Shortcuts only work on web dashboards.');
    expect(Homey.ready).toHaveBeenCalled();
  });

  it('asks for dashboards when none is picked', async () => {
    const { root, api } = mount({ dashboard1: { id: 'none', name: 'None' } });
    await vi.advanceTimersByTimeAsync(10);
    expect(api).not.toHaveBeenCalled();
    expect(root.querySelector('.sc-message')!.textContent).toBe('Pick dashboards in the widget settings.');
  });

  it('shows the error when the first read fails', async () => {
    const { root } = mount(picked, 'web-d-1-w1', vi.fn(async () => { throw new Error('offline'); }));
    await vi.advanceTimersByTimeAsync(10);
    expect(root.querySelector('.sc-row')).toBeNull();
    expect(root.querySelector('.sc-message')!.textContent).toBe('Could not load the dashboards.');
  });
});

describe('rename mode', () => {
  it('hides the field of a missing dashboard, and a renamed tile opens nothing', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('widgets/shortcuts/public/widget.css', 'utf8');
    document.head.append(style);
    const { w, root, row, onOpen } = widget(state(null, dash('a', 'Lights'), dash('b', 'Sensors')), { renameTiles: true, onRename: vi.fn(async () => {}) });
    const fields = () => [...root.querySelectorAll<HTMLInputElement>('.wk-rename')];
    expect(fields()).toHaveLength(2);
    expect(row(0).hasAttribute('role')).toBe(false);
    row(0).click();
    expect(onOpen).not.toHaveBeenCalled();
    w.setState(state(null, { id: 'a', missing: true }, dash('b', 'Sensors')));
    const shown = fields().filter(f => root.contains(f) && getComputedStyle(f).display !== 'none');
    expect(shown.map(f => f.placeholder)).toEqual(['Sensors']);
  });
});
