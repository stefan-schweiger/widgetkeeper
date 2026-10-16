// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOW_ICON_PATHS } from '../lib/FlowService.js';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => {
  win = loadWidget('varpresets');
  loadMount('varpresets');
});

// Autocomplete items, as the widget settings keep them (listPresetValues()).
const item = (value: boolean | number | string, name = String(value)) => ({ id: `${typeof value}:${JSON.stringify(value)}`, name, value, type: typeof value });
const mode = (value: string) => ({ id: 'v1', name: 'House mode', type: 'string', value });
const away = { value1: item('Home'), value2: item('Away'), value3: item('Night'), value4: item('Holiday') };

function widget(settings: Record<string, unknown>, state: any = mode('Away'), opts: Record<string, unknown> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSet = vi.fn(async () => ({ ok: true }));
  const w = win.createVarPresetsWidget(root, { locale: 'en', onSet, ...opts });
  w.setPresets(win.varPresetsFromSettings(settings));
  if (state) w.setState(state);
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('.tw-btn')].map(b => ({
    text: b.querySelector('.tw-big')!.textContent,
    active: b.classList.contains('active'),
    disabled: b.disabled,
  }));
  const text = (sel: string) => {
    const el = root.querySelector<HTMLElement>(sel)!;
    return el.style.display === 'none' ? null : el.textContent;
  };
  const press = (i: number) => root.querySelectorAll<HTMLButtonElement>('.tw-btn')[i].click();
  return { w, root, buttons, name: () => text('.tw-name'), sub: () => text('.tw-sub'), press, onSet };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

describe('Variable Presets: settings', () => {
  it('takes the buttons with a value, in order, with their labels', () => {
    expect(win.varPresetsFromSettings({
      value1: item(21.5), label1: ' Warm ', value2: { id: 'none', name: 'None' }, value3: item(true), value4: item('Away'),
    })).toEqual([
      { value: 21.5, type: 'number', label: 'Warm' },
      { value: true, type: 'boolean', label: '' },
      { value: 'Away', type: 'string', label: '' },
    ]);
  });

  it('leaves out choices without a typed value', () => {
    expect(win.varPresetsFromSettings({
      value1: { id: 'x', name: 'x' }, value2: { id: 'y', name: 'y', value: '3', type: 'number' }, value3: { id: 'z', name: 'z', value: NaN, type: 'number' },
    })).toEqual([]);
    expect(win.varPresetsFromSettings({})).toEqual([]);
  });
});

describe('Variable Presets: buttons', () => {
  it('shows 2 to 4 buttons, the label else the value, the matching one lit', () => {
    const { root, buttons, name, sub } = widget({ ...away, label4: 'Vacation' });
    expect(root.querySelector<HTMLElement>('.tw-row')!.style.getPropertyValue('--tw-count')).toBe('4');
    expect(buttons()).toEqual([
      { text: 'Home', active: false, disabled: false },
      { text: 'Away', active: true, disabled: false },
      { text: 'Night', active: false, disabled: false },
      { text: 'Vacation', active: false, disabled: false },
    ]);
    expect(name()).toBe('House mode');
    expect(sub()).toBeNull();
    const two = widget({ value1: item('Home'), value3: item('Away') });
    expect(two.buttons().map(b => b.text)).toEqual(['Home', 'Away']);
    expect(two.root.querySelector<HTMLElement>('.tw-row')!.style.getPropertyValue('--tw-count')).toBe('2');
  });

  it('writes numbers in the locale and yes/no as words, and matches numbers without float noise', () => {
    const nums = widget({ value1: item(0.3), value2: item(1234.5), value3: item(-2) }, { id: 'n', name: 'Level', type: 'number', value: 0.1 + 0.2 });
    expect(nums.buttons().map(b => [b.text, b.active])).toEqual([['0.3', true], ['1,234.5', false], ['-2', false]]);
    const bools = widget({ value1: item(true, 'Yes'), label1: 'Home', value2: item(false, 'No') }, { id: 'b', name: 'Guests', type: 'boolean', value: false });
    expect(bools.buttons().map(b => [b.text, b.active])).toEqual([['Home', false], ['No', true]]);
  });

  it('says what the variable is when no button matches', () => {
    expect(widget(away, mode('Party')).sub()).toBe('Currently Party');
    expect(widget(away, mode('')).sub()).toBe('Currently –');
    expect(widget({ value1: item(20), value2: item(22) }, { id: 'n', name: 'Setpoint', type: 'number', value: 21.25 }).sub()).toBe('Currently 21.25');
    expect(widget({ value1: item(true) }, { id: 'b', name: 'Guests', type: 'boolean', value: false }).sub()).toBe('Currently No');
  });

  it('gives a yes/no variable without presets Yes and No', () => {
    const { buttons } = widget({}, { id: 'b', name: 'Guests', type: 'boolean', value: true });
    expect(buttons().map(b => [b.text, b.active])).toEqual([['Yes', true], ['No', false]]);
  });

  it('leaves out a preset of another type, and asks for presets when none is left', () => {
    const mixed = widget({ value1: item(21), value2: item('Away'), value3: item('Home') });
    expect(mixed.buttons().map(b => b.text)).toEqual(['Away', 'Home']);
    const none = widget({ value1: item(21) });
    expect(none.buttons()).toEqual([]);
    expect(none.sub()).toBe('Pick the buttons’ values in the widget settings.');
    expect(none.name()).toBeNull();
    // A yes/no variable with presets of another type doesn't fall back to Yes and No.
    expect(widget({ value1: item(21) }, { id: 'b', name: 'Guests', type: 'boolean', value: true }).buttons()).toEqual([]);
  });

  it('shows the presets disabled before the variable is known', () => {
    const { buttons, onSet, press } = widget(away, null);
    expect(buttons().map(b => [b.text, b.disabled])).toEqual([['Home', true], ['Away', true], ['Night', true], ['Holiday', true]]);
    press(0);
    expect(onSet).not.toHaveBeenCalled();
  });

  it('follows the variable: a change lights another button, another id is ignored', () => {
    const { w, buttons } = widget(away);
    w.pushChange({ id: 'v1', name: 'House mode', type: 'string', value: 'Night' });
    expect(buttons().map(b => b.active)).toEqual([false, false, true, false]);
    w.pushChange({ id: 'other', value: 'Home' });
    expect(buttons().map(b => b.active)).toEqual([false, false, true, false]);
  });
});

describe('Variable Presets: header', () => {
  it('takes the title over the name, and an icon only when one is picked', () => {
    const plain = widget(away);
    expect(plain.root.querySelector<HTMLElement>('.tw-device-icon')!.style.display).toBe('none');
    const own = widget(away, mode('Away'), { title: '  Mode  ', icon: 'home' });
    expect(own.name()).toBe('Mode');
    const box = own.root.querySelector<HTMLElement>('.tw-device-icon')!;
    expect(box.style.display).toBe('');
    expect(decodeURIComponent(box.style.getPropertyValue('--tw-icon'))).toContain(FLOW_ICON_PATHS.home.d);
    expect(widget(away, mode('Away'), { icon: 'nope' }).root.querySelector<HTMLElement>('.tw-device-icon')!.style.display).toBe('none');
  });

  it('has the colour picked, blue when missing or unknown, and the compact layout', () => {
    expect(widget(away, mode('Away'), { color: 'green' }).root.dataset.color).toBe('green');
    expect(widget(away).root.dataset.color).toBe('blue');
    expect(widget(away, mode('Away'), { color: 'grey' }).root.dataset.color).toBe('blue');
    const compact = widget(away, mode('Away'), { layout: 'compact' });
    expect(compact.root.classList.contains('tw-compact')).toBe(true);
    expect(compact.root.classList.contains('vp')).toBe(true);
  });

  it("has Flow Buttons' icons (the setting lists those)", () => {
    expect(win.VARPRESETS_ICON_PATHS).toEqual(FLOW_ICON_PATHS);
  });
});

describe('Variable Presets: setting the variable', () => {
  it('sends the value, keeps the button lit until the variable follows or 10 s pass', async () => {
    vi.useFakeTimers();
    const { buttons, press, onSet, w } = widget(away);
    press(2);
    expect(onSet).toHaveBeenCalledWith('Night');
    await vi.advanceTimersByTimeAsync(0);
    expect(buttons().map(b => b.active)).toEqual([false, false, true, false]);
    w.render();
    await vi.advanceTimersByTimeAsync(10100);
    expect(buttons().map(b => b.active)).toEqual([false, true, false, false]);
  });

  it("says what to do about the API key, or that it couldn't, and shakes the button", async () => {
    vi.useFakeTimers();
    const { buttons, press, onSet, sub, root } = widget(away);
    onSet.mockRejectedValueOnce(Object.assign(new Error('noKey'), { reason: 'noKey' }));
    press(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(sub()).toBe('To change variables, add an API key in the app settings.');
    expect(root.querySelectorAll('.tw-btn')[0].classList.contains('shake')).toBe(true);
    expect(buttons().map(b => b.active)).toEqual([false, true, false, false]);
    onSet.mockRejectedValueOnce(new Error('boom'));
    press(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(sub()).toBe('Could not change House mode.');
    await vi.advanceTimersByTimeAsync(8000);
    expect(sub()).toBeNull();
  });
});

describe('Variable Presets: mount', () => {
  function homey(settings: Record<string, unknown>, state: unknown) {
    const listeners: Record<string, (data: any) => void> = {};
    const api = vi.fn(async (method: string, path: string) => (method === 'GET' ? state : { ok: false, reason: 'keyScope' }));
    return {
      listeners,
      api,
      Homey: {
        getSettings: () => settings,
        api,
        on: (event: string, fn: (data: any) => void) => { listeners[event] = fn; },
        __: () => undefined,
        ready: vi.fn(),
        setHeight: vi.fn(),
      },
    };
  }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it("reads the variable, follows its events and says why a tap didn't change it", async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const h = homey({ variable: { id: 'v1', name: 'House mode' }, color: 'purple', ...away }, mode('Home'));
    win.mountVarPresetsWidget(h.Homey, { root, frame: root });
    await flush();
    expect(h.api).toHaveBeenCalledWith('GET', expect.stringMatching(/^\/state\?id=v1(&perf=.*)?$/));
    expect(h.Homey.ready).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.tw-btn.active')!.textContent).toBe('Home');
    h.listeners['variables:state']({ id: 'v1', name: 'House mode', type: 'string', value: 'Away' });
    expect(root.querySelector('.tw-btn.active')!.textContent).toBe('Away');
    (root.querySelectorAll('.tw-btn')[2] as HTMLButtonElement).click();
    await flush();
    expect(h.api).toHaveBeenCalledWith('POST', '/set', { id: 'v1', value: 'Night' });
    expect(root.querySelector('.tw-sub')!.textContent).toBe('The API key may not change variables: it needs Variables.');
    h.listeners['variables:state']({ id: 'v1', missing: true });
    expect(root.querySelector('.tw-sub')!.textContent).toBe('Variable not found');
  });

  it('asks for a variable when none is picked, and says when it was deleted', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const none = homey({}, null);
    win.mountVarPresetsWidget(none.Homey, { root, frame: root });
    await flush();
    expect(none.api).not.toHaveBeenCalled();
    expect(root.textContent).toBe('Pick a variable in the widget settings.');
    const root2 = document.createElement('div');
    const gone = homey({ variable: { id: 'v9', name: 'Old' }, ...away }, { id: 'v9', missing: true });
    win.mountVarPresetsWidget(gone.Homey, { root: root2, frame: root2 });
    await flush();
    expect(root2.querySelector('.tw-sub')!.textContent).toBe('Variable not found');
  });
});
