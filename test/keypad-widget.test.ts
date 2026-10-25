// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOLEAN_WORDS } from '../lib/KeypadService.js';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => {
  win = loadWidget('keypad');
  loadMount('keypad');
});

const CODE = { id: `code:v1:${'a'.repeat(8)}:${'b'.repeat(16)}:${'c'.repeat(32)}`, name: '••••', digits: 4 };
// Autocomplete items, as the widget settings keep them.
const value = (v: boolean | number | string, name: string) => ({ id: `${typeof v}:${JSON.stringify(v)}`, name, value: v, type: typeof v });
const ALARM = {
  state: { id: 'cap:alarm:homealarm_state', name: 'Surveillance · Home Alarm state' },
  code: CODE,
  value1: value('armed', 'Armed'), label1: 'Arm', icon1: { id: 'shield' }, color1: 'red', code1: false,
  value2: value('partially_armed', 'Partially armed'), label2: 'Night', icon2: { id: 'moon' }, color2: 'purple', code2: false,
  flow3: { id: 'flow:f1', name: 'Disarm alarm' }, value3: value('disarmed', 'Disarmed'), icon3: { id: 'unlock' }, color3: 'green',
};
const VALUES = [{ id: 'armed', title: 'Armed' }, { id: 'disarmed', title: 'Disarmed' }, { id: 'partially_armed', title: 'Partially armed' }];
const alarm = (v: unknown, flows: any[] = [{ id: 'flow:f1', name: 'Disarm alarm', enabled: true, triggerable: true, advanced: false }]) => ({
  source: { kind: 'capability', deviceId: 'alarm', capabilityId: 'homealarm_state', name: 'Surveillance', capability: { title: 'Home Alarm state', type: 'enum', values: VALUES }, value: v },
  flows,
});

function widget(settings: Record<string, unknown>, state: any, opts: Record<string, unknown> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onPress = vi.fn(async (_body: object): Promise<any> => ({ ok: true, result: 'done' }));
  const { sourceId, code, buttons } = win.keypadSettings(settings);
  const w = win.createKeypadWidget(root, { locale: 'en', sourceId, code, buttons, title: settings.title, layout: settings.layout, onPress, ...opts });
  if (state) w.setState(state);
  const left = () => [root.querySelector('.kp-state')?.textContent, root.querySelector('.kp-sub')?.textContent];
  const buttonsShown = () => [...root.querySelectorAll<HTMLElement>('.kp-btn')].map(b => [
    b.querySelector('.kp-label')!.textContent,
    b.classList.contains('on') ? 'on' : '',
    b.querySelector('.kp-spin') ? 'spin' : b.querySelector('.kp-mark.code') ? 'code' : b.querySelector('.kp-mark') ? 'tick' : '',
    b.dataset.wkColor ?? 'grey',
  ].filter(Boolean).join(' '));
  const press = (i: number) => root.querySelectorAll<HTMLElement>('.kp-btn')[i].click();
  const keys = () => [...root.querySelectorAll<HTMLButtonElement>('.kp-key:not(.blank)')];
  const key = (k: string) => keys().find(b => b.getAttribute('aria-label') === (k === 'back' ? 'Delete' : k))!.click();
  const dots = () => [...root.querySelectorAll('.kp-dot')].map(d => (d.classList.contains('f') ? '●' : '○')).join('');
  return { w, root, onPress, left, buttons: buttonsShown, press, keys, key, dots, padOpen: () => root.classList.contains('pad-open') };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

describe('Keypad: settings', () => {
  it('reads the state, the code (never digits) and the buttons with a Flow or a value', () => {
    expect(win.keypadSettings({
      ...ALARM, value2: { id: 'none', name: 'None' }, flow2: { id: 'none' }, label3: ' Off ', color3: 'nope',
    })).toEqual({
      sourceId: 'cap:alarm:homealarm_state',
      code: { id: CODE.id, digits: 4 },
      buttons: [
        { n: 1, flow: null, flowName: '', value: { value: 'armed', type: 'string', name: 'Armed' }, label: 'Arm', icon: 'shield', color: 'red', needsCode: false },
        { n: 3, flow: 'flow:f1', flowName: 'Disarm alarm', value: { value: 'disarmed', type: 'string', name: 'Disarmed' }, label: 'Off', icon: 'unlock', color: 'blue', needsCode: true },
      ],
    });
    expect(win.keypadSettings({ state: { id: 'none' }, code: { id: 'none' } })).toEqual({ sourceId: null, code: null, buttons: [] });
    expect(win.keypadSettings({ code: { id: 'code:x', digits: 9 } }).code).toBeNull();
  });

  it("names a yes/no capability's values as the app's lists do", () => {
    expect(win.keypadBooleanWords).toEqual(BOOLEAN_WORDS);
  });
});

describe('Keypad: the state and the buttons', () => {
  it('shows the state, ticks the button it matches, and marks the one that wants the code', () => {
    const { left, buttons } = widget(ALARM, alarm('armed'));
    expect(left()).toEqual(['Armed', 'Surveillance']);
    expect(buttons()).toEqual(['Arm on tick red', 'Night purple', 'Disarm alarm code green']);
  });

  it('follows the state as it changes, with a title in place of the name', () => {
    const { w, left, buttons } = widget({ ...ALARM, title: ' Alarm ' }, alarm('armed'));
    w.pushValue('partially_armed');
    expect(left()).toEqual(['Partially armed', 'Alarm']);
    expect(buttons()).toEqual(['Arm red', 'Night on tick purple', 'Disarm alarm code green']);
    w.pushValue('panic');
    expect(left()).toEqual(['panic', 'Alarm']);
    expect(buttons().filter(b => b.includes(' on'))).toEqual([]);
  });

  it('makes a button per value of a list capability with no buttons set up, all behind the code', () => {
    const { buttons } = widget({ state: ALARM.state, code: CODE }, alarm('disarmed'));
    expect(buttons()).toEqual(['Armed code red', 'Disarmed on tick green', 'Partially armed code orange']);
  });

  it('makes Yes and No for a yes/no variable, and says the state in its words', () => {
    const tv = { source: { kind: 'variable', id: 'v1', name: 'TV time', type: 'boolean', value: true }, flows: [] };
    const { left, buttons } = widget({ state: { id: 'var:v1' } }, tv);
    expect(left()).toEqual(['Yes', 'TV time']);
    expect(buttons()).toEqual(['Yes on tick grey', 'No grey']);
    const lock = { source: { kind: 'capability', deviceId: 'd', capabilityId: 'locked', name: 'Front door', capability: { type: 'boolean' }, value: false }, flows: [] };
    expect(widget({ state: { id: 'cap:d:locked' } }, lock).buttons()).toEqual(['Locked green', 'Unlocked on tick red']);
  });

  it('without a state shows the title, and asks for buttons when there are none', () => {
    const flows = [{ id: 'flow:f1', name: 'Movie night', enabled: true, triggerable: true, advanced: false }];
    const { left, buttons } = widget({ flow1: { id: 'flow:f1', name: 'Old name' }, title: 'TV' }, { source: null, flows });
    expect(left()).toEqual(['TV', '']);
    expect(buttons()).toEqual(['Movie night blue']);
    const empty = widget({}, { source: null, flows: [] });
    expect(empty.root.querySelector('.kp-only')!.textContent).toBe('Pick the buttons in the widget settings.');
    expect(empty.root.classList.contains('kp-message-only')).toBe(true);
  });

  it('says a deleted device or variable is gone, keeping the buttons', () => {
    const { left, buttons } = widget(ALARM, { source: { kind: 'capability', deviceId: 'alarm', capabilityId: 'homealarm_state', missing: true }, flows: [] });
    expect(left()).toEqual(['–', 'Not found']);
    expect(buttons()).toHaveLength(3);
  });

  it("won't start a flow that's gone or off, and says so", () => {
    const off = widget(ALARM, alarm('armed', [{ id: 'flow:f1', name: 'Disarm alarm', enabled: false, triggerable: true, advanced: false }]));
    off.press(2);
    expect(off.left()).toEqual(['Armed', 'Disarm alarm is turned off.']);
    expect(off.padOpen()).toBe(false);
    const gone = widget(ALARM, alarm('armed', [{ id: 'flow:f1', missing: true }]));
    expect(gone.buttons()[2]).toBe('Disarm alarm code green');
    gone.press(2);
    expect(gone.left()[1]).toBe('Flow not found');
    expect(gone.onPress).not.toHaveBeenCalled();
  });
});

describe('Keypad: a button without the code', () => {
  it('sets the state at once, with a spinner then a tick, and shows the value until it is reported', async () => {
    vi.useFakeTimers();
    const { press, onPress, buttons, left, w } = widget(ALARM, alarm('disarmed'));
    press(1);
    expect(onPress).toHaveBeenCalledWith({ source: 'cap:alarm:homealarm_state', value: 'partially_armed' });
    expect(buttons()[1]).toBe('Night spin purple');
    await vi.advanceTimersByTimeAsync(400);
    expect(buttons()[1]).toBe('Night on tick purple');
    expect(left()[0]).toBe('Partially armed');
    w.pushValue('partially_armed');
    await vi.advanceTimersByTimeAsync(1500);
    expect(buttons()[1]).toBe('Night on tick purple');
  });

  it('goes back when the value never comes', async () => {
    vi.useFakeTimers();
    const { press, left } = widget(ALARM, alarm('disarmed'));
    press(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(left()[0]).toBe('Armed');
    await vi.advanceTimersByTimeAsync(10e3 + 100);
    expect(left()[0]).toBe('Disarmed');
  });

  it('shakes and says why when it fails', async () => {
    vi.useFakeTimers();
    const { press, onPress, left, root } = widget(ALARM, alarm('disarmed'));
    onPress.mockResolvedValueOnce({ ok: false, reason: 'keyScope' });
    press(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(left()[1]).toBe('The API key may not do this: it needs Start Flows, or Variables for a variable.');
    expect(root.querySelectorAll('.kp-btn')[0].classList.contains('shake')).toBe(true);
    onPress.mockResolvedValueOnce({ ok: true, result: 'notSetable' });
    press(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(left()[1]).toBe('This can’t be set from here: give the button a Flow.');
    onPress.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    press(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(left()[1]).toBe('Could not run Night.');
    await vi.advanceTimersByTimeAsync(8000);
    expect(left()[1]).toBe('Surveillance');
  });
});

describe('Keypad: the code pad', () => {
  it('opens for a button that wants the code, and sends the code with the last digit', async () => {
    const { press, padOpen, dots, key, onPress, root, buttons } = widget(ALARM, alarm('armed'));
    press(2);
    expect(padOpen()).toBe(true);
    expect(root.querySelector('.kp-pad-label')!.textContent).toBe('Disarm alarm');
    expect(dots()).toBe('○○○○');
    key('4');
    key('7');
    key('back');
    key('7');
    key('1');
    expect(dots()).toBe('●●●○');
    expect(onPress).not.toHaveBeenCalled();
    key('1');
    expect(onPress).toHaveBeenCalledWith({ flow: 'flow:f1', codeId: CODE.id, code: '4711' });
    expect(root.querySelector('.kp-dots')!.classList.contains('checking')).toBe(true);
    expect(root.querySelectorAll<HTMLButtonElement>('.kp-key')[0].disabled).toBe(true);
    await vi.waitFor(() => expect(padOpen()).toBe(false));
    expect(buttons()[2]).toBe('Disarm alarm tick green');
  });

  it('a wrong code: red dots that empty, and the tries left once they run low', async () => {
    vi.useFakeTimers();
    const { press, key, onPress, dots, left, root, padOpen } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: true, result: 'wrongCode', left: 4 });
    press(2);
    for (const k of '1234') key(k);
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.kp-dots')!.classList.contains('err')).toBe(true);
    expect(left()[1]).toBe('Wrong code');
    expect(padOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(dots()).toBe('○○○○');
    onPress.mockResolvedValueOnce({ ok: true, result: 'wrongCode', left: 2 });
    for (const k of '1235') key(k);
    await vi.advanceTimersByTimeAsync(0);
    expect(left()[1]).toBe('Wrong code. Tries left: 2');
  });

  it('too many tries: the keys stop and count down', async () => {
    vi.useFakeTimers();
    const { press, key, onPress, keys, left, root } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: true, result: 'locked', retryAfter: 3 });
    press(2);
    for (const k of '1234') key(k);
    await vi.advanceTimersByTimeAsync(0);
    expect(left()[1]).toBe('Too many tries. Try again in 3 s.');
    expect(keys().every(k => k.disabled)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(left()[1]).toBe('Too many tries. Try again in 2 s.');
    await vi.advanceTimersByTimeAsync(2000);
    expect(left()[1]).toBe('Surveillance');
    expect(keys().some(k => k.disabled)).toBe(false);
    expect(root.classList.contains('pad-open')).toBe(true);
  });

  it('a code made with another key: says to set it again and takes no more digits', async () => {
    const { press, key, onPress, keys, left } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: true, result: 'codeReset' });
    press(2);
    for (const k of '1234') key(k);
    await vi.waitFor(() => expect(left()[1]).toBe('Set the code again in the widget settings.'));
    expect(keys().every(k => k.disabled)).toBe(true);
  });

  it('a missing API key closes the pad and says so on the button', async () => {
    const { press, key, onPress, left, padOpen } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: false, reason: 'noKey' });
    press(2);
    for (const k of '1234') key(k);
    await vi.waitFor(() => expect(padOpen()).toBe(false));
    expect(left()[1]).toBe('To use this button, add an API key in the app settings.');
  });

  it('takes the keyboard while open; Escape, ✕ or 30 s alone close it', async () => {
    vi.useFakeTimers();
    const { press, dots, padOpen, root, onPress } = widget(ALARM, alarm('armed'));
    press(2);
    for (const k of ['4', '7', 'x']) document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    expect(dots()).toBe('●●○○');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(dots()).toBe('●○○○');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(padOpen()).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })); // closed: the keys are the page's again
    press(2);
    expect(dots()).toBe('○○○○');
    root.querySelector<HTMLButtonElement>('.kp-close')!.click();
    expect(padOpen()).toBe(false);
    press(2);
    await vi.advanceTimersByTimeAsync(30e3);
    expect(padOpen()).toBe(false);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('compact: square buttons and the pad in two rows of six over the whole widget', () => {
    const { root, press, keys } = widget({ ...ALARM, layout: 'compact' }, alarm('armed'));
    expect(root.classList.contains('kp-compact')).toBe(true);
    press(2);
    expect(keys().map(k => k.getAttribute('aria-label'))).toEqual(['1', '2', '3', '4', '5', 'Delete', '6', '7', '8', '9', '0']);
    expect(root.querySelector('.kp-pad-sub')!.textContent).toBe('Surveillance');
  });

  it('comfortable: the phone pad, 1–9, then 0 and delete', () => {
    const { press, keys } = widget(ALARM, alarm('armed'));
    press(2);
    expect(keys().map(k => k.getAttribute('aria-label'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Delete']);
  });
});

describe('Keypad: mount', () => {
  it('asks for the state with the flows, and follows the capability and the variable', async () => {
    const handlers = new Map<string, (data: any) => void>();
    const api = vi.fn(async (method: string, path: string) => (method === 'GET' ? alarm('armed') : { ok: true, result: 'done' }));
    const Homey = {
      getSettings: () => ALARM, __: () => undefined, api, on: (e: string, fn: any) => handlers.set(e, fn),
      ready: vi.fn(), setHeight: vi.fn(), hapticFeedback: vi.fn(),
    };
    const root = document.createElement('div');
    document.body.append(root);
    win.mountKeypadWidget(Homey, { root, frame: document.body });
    await vi.waitFor(() => expect(Homey.ready).toHaveBeenCalled());
    expect(api.mock.calls[0][1]).toMatch(/^\/state\?source=cap%3Aalarm%3Ahomealarm_state&flows=flow%3Af1&perf=/);
    handlers.get('values:state')!({ deviceId: 'alarm', capabilityId: 'homealarm_state', value: 'disarmed' });
    handlers.get('values:state')!({ deviceId: 'other', capabilityId: 'homealarm_state', value: 'armed' });
    expect(root.querySelector('.kp-state')!.textContent).toBe('Disarmed');
    root.querySelectorAll<HTMLElement>('.kp-btn')[0].click();
    expect(Homey.hapticFeedback).toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('POST', '/press', { source: 'cap:alarm:homealarm_state', value: 'armed' });
  });
});
