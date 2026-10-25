// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOLEAN_WORDS } from '../lib/KeypadService.js';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => {
  win = loadWidget('keypad');
  loadMount('keypad');
});

// The code setting keeps a code made on the app settings page; its length comes with the state.
const CODE = { id: 'c1', name: 'Alarm', description: 'A 4-digit code' };
const CODE_STATE = { id: 'c1', name: 'Alarm', digits: 4 };
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
const FLOW = { id: 'flow:f1', name: 'Disarm alarm', enabled: true, triggerable: true, advanced: false };
const alarm = (v: unknown, { flows = [FLOW], code = CODE_STATE }: { flows?: object[], code?: object | null } = {}) => ({
  source: { kind: 'capability', deviceId: 'alarm', capabilityId: 'homealarm_state', name: 'Surveillance', capability: { title: 'Home Alarm state', type: 'enum', values: VALUES }, value: v },
  flows,
  code,
});

function widget(settings: Record<string, unknown>, state: any, opts: Record<string, unknown> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onPress = vi.fn(async (_body: object): Promise<any> => ({ ok: true, result: 'done' }));
  const w = win.createKeypadWidget(root, {
    locale: 'en', ...win.keypadSettings(settings), title: settings.title, layout: settings.layout, onPress, ...opts,
  });
  if (state) w.setState(state);
  const left = () => [root.querySelector('.kp-state')?.textContent, root.querySelector('.kp-sub')?.textContent];
  const buttonsShown = () => [...root.querySelectorAll<HTMLElement>('.kp-btn')].map(b => [
    b.querySelector('.kp-label')!.textContent,
    b.classList.contains('on') ? 'on' : '',
    b.classList.contains('target') ? 'target' : '',
    b.querySelector('.kp-spin') ? 'spin' : b.querySelector('.kp-mark.code') ? 'code' : b.querySelector('.kp-mark') ? 'tick' : '',
    b.dataset.wkColor ?? 'grey',
  ].filter(Boolean).join(' '));
  const press = (i: number) => root.querySelectorAll<HTMLElement>('.kp-btn')[i].click();
  const keys = () => [...root.querySelectorAll<HTMLButtonElement>('.kp-key:not(.blank)')];
  const key = (k: string) => keys().find(b => b.getAttribute('aria-label') === ({ back: 'Delete', left: 'Clear' }[k] ?? k))!.click();
  const type = (digits: string) => { for (const k of digits) key(k); };
  const dots = () => [...root.querySelectorAll('.kp-dot')].map(d => (d.classList.contains('f') ? '●' : d.classList.contains('next') ? '◌' : '○')).join('');
  const label = () => root.querySelector('.kp-pad-label')!.textContent;
  return { w, root, onPress, left, buttons: buttonsShown, press, keys, key, type, dots, label, padOpen: () => root.classList.contains('pad-open') };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

describe('Keypad: settings', () => {
  it("reads the state, the code's id, when the keypad shows, and the buttons with a Flow, a value or a label", () => {
    expect(win.keypadSettings({
      ...ALARM, keypad: 'always', value2: { id: 'none', name: 'None' }, flow2: { id: 'none' }, label3: ' Off ', color3: 'nope',
    })).toEqual({
      sourceId: 'cap:alarm:homealarm_state',
      codeId: 'c1',
      keypad: 'always',
      buttons: [
        { n: 1, flow: null, flowName: '', value: { value: 'armed', type: 'string', name: 'Armed' }, label: 'Arm', icon: 'shield', color: 'red', needsCode: false },
        { n: 2, flow: null, flowName: '', value: null, label: 'Night', icon: 'moon', color: 'purple', needsCode: false }, // the trigger only
        { n: 3, flow: 'flow:f1', flowName: 'Disarm alarm', value: { value: 'disarmed', type: 'string', name: 'Disarmed' }, label: 'Off', icon: 'unlock', color: 'blue', needsCode: true },
      ],
    });
    expect(win.keypadSettings({ ...ALARM, value2: { id: 'none' }, label2: ' ' }).buttons.map((b: any) => b.n)).toEqual([1, 3]);
    expect(win.keypadSettings({ code: { id: 'any', name: 'Any code' } }).codeId).toBe('any');
    expect(win.keypadSettings({ state: { id: 'none' }, code: { id: 'none' }, keypad: 'nope' })).toEqual({ sourceId: null, codeId: null, keypad: 'tap', buttons: [] });
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
    const tv = { source: { kind: 'variable', id: 'v1', name: 'TV time', type: 'boolean', value: true }, flows: [], code: null };
    const { left, buttons } = widget({ state: { id: 'var:v1' } }, tv);
    expect(left()).toEqual(['Yes', 'TV time']);
    expect(buttons()).toEqual(['Yes on tick grey', 'No grey']);
    const lock = { source: { kind: 'capability', deviceId: 'd', capabilityId: 'locked', name: 'Front door', capability: { type: 'boolean' }, value: false }, flows: [], code: null };
    expect(widget({ state: { id: 'cap:d:locked' } }, lock).buttons()).toEqual(['Locked green', 'Unlocked on tick red']);
  });

  it('without a state shows the title, and asks for buttons when there are none', () => {
    const flows = [{ id: 'flow:f1', name: 'Movie night', enabled: true, triggerable: true, advanced: false }];
    const { left, buttons } = widget({ flow1: { id: 'flow:f1', name: 'Old name' }, title: 'TV' }, { source: null, flows, code: null });
    expect(left()).toEqual(['TV', '']);
    expect(buttons()).toEqual(['Movie night blue']);
    const empty = widget({}, { source: null, flows: [], code: null });
    expect(empty.root.querySelector('.kp-only')!.textContent).toBe('Pick the buttons in the widget settings.');
    expect(empty.root.classList.contains('kp-message-only')).toBe(true);
  });

  it('says a deleted device or variable is gone, keeping the buttons', () => {
    const { left, buttons } = widget(ALARM, { source: { kind: 'capability', deviceId: 'alarm', capabilityId: 'homealarm_state', missing: true }, flows: [], code: CODE_STATE });
    expect(left()).toEqual(['–', 'Not found']);
    expect(buttons()).toHaveLength(3);
  });

  it("won't start a flow that's gone or off, and says so", () => {
    const off = widget(ALARM, alarm('armed', { flows: [{ ...FLOW, enabled: false }] }));
    off.press(2);
    expect(off.left()).toEqual(['Armed', 'Disarm alarm is turned off.']);
    expect(off.padOpen()).toBe(false);
    const gone = widget(ALARM, alarm('armed', { flows: [{ id: 'flow:f1', missing: true }] }));
    expect(gone.buttons()[2]).toBe('Disarm alarm code green');
    gone.press(2);
    expect(gone.left()[1]).toBe('Flow not found');
    expect(gone.onPress).not.toHaveBeenCalled();
  });

  it("refuses a button behind a code that was removed, and runs those that need none", () => {
    const { press, left, padOpen, onPress } = widget(ALARM, alarm('armed', { code: { id: 'c1', missing: true } }));
    press(2);
    expect(padOpen()).toBe(false);
    expect(left()[1]).toBe('This code was removed: pick one in the widget settings.');
    press(1);
    expect(onPress).toHaveBeenCalledWith({ source: 'cap:alarm:homealarm_state', value: 'partially_armed', button: 'Night', title: 'Surveillance' });
  });
});

describe('Keypad: Any code', () => {
  const anyCode = { ...ALARM, code: { id: 'any', name: 'Any code' } };
  const ANY = { id: 'any', name: 'Any code', digits: null }; // the codes' lengths differ

  it("has OK while the codes' lengths differ: the dots are what was typed, and OK or Enter sends it", async () => {
    const { press, key, keys, type, dots, onPress, padOpen } = widget(anyCode, alarm('armed', { code: ANY }));
    press(2);
    expect(padOpen()).toBe(true);
    expect(keys().map(k => k.getAttribute('aria-label'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'OK', '0', 'Delete']);
    expect(dots()).toBe('◌'); // the next one, pulsing
    type('47');
    expect(dots()).toBe('●●◌');
    keys().find(k => k.getAttribute('aria-label') === 'OK')!.click(); // under three digits: nothing yet
    expect(onPress).not.toHaveBeenCalled();
    type('1105');
    expect(dots()).toBe('●●●●●●');
    key('9'); // six at most
    expect(dots()).toBe('●●●●●●');
    key('back');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onPress).toHaveBeenCalledWith({ flow: 'flow:f1', codeId: 'any', code: '47110', button: 'Disarm alarm', title: 'Surveillance' });
    await vi.waitFor(() => expect(padOpen()).toBe(false));
  });

  it('sends on the last digit while every code has the same length', () => {
    const { press, type, onPress, keys, dots } = widget(anyCode, alarm('armed', { code: { ...ANY, digits: 4 } }));
    press(2);
    expect(keys().map(k => k.getAttribute('aria-label'))).not.toContain('OK');
    expect(dots()).toBe('◌○○○');
    type('2580');
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ codeId: 'any', code: '2580' }));
  });

  it('always shown: a button tapped after the digits sends them; OK alone asks for a button', () => {
    const settings = { ...anyCode, keypad: 'always', code1: true };
    const { press, type, keys, label, onPress } = widget(settings, alarm('disarmed', { code: ANY }));
    type('47110');
    expect(onPress).not.toHaveBeenCalled();
    expect(label()).toBe('Enter the code, then tap a button');
    keys().find(k => k.getAttribute('aria-label') === 'OK')!.click();
    expect(label()).toBe('Now tap a button');
    press(0);
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ value: 'armed', codeId: 'any', code: '47110' }));
  });

  it('says where to add a code while there is none', () => {
    const { press, left, padOpen } = widget(anyCode, alarm('armed', { code: { id: 'any', missing: true } }));
    press(2);
    expect(padOpen()).toBe(false);
    expect(left()[1]).toBe('No codes yet: add one in the app settings.');
  });
});

describe('Keypad: a button with only a label', () => {
  it('only fires the trigger: the label and title go, and the state stays', async () => {
    vi.useFakeTimers();
    const { press, onPress, buttons, left } = widget({ ...ALARM, value2: { id: 'none' }, label2: 'Home', title: 'Hall' }, alarm('armed'));
    expect(buttons()[1]).toBe('Home purple');
    press(1);
    expect(onPress).toHaveBeenCalledWith({ button: 'Home', title: 'Hall' });
    await vi.advanceTimersByTimeAsync(500);
    expect(buttons()[1]).toBe('Home tick purple');
    expect(left()[0]).toBe('Armed');
  });
});

describe('Keypad: a button without the code', () => {
  it('sets the state at once, with a spinner then a tick, and shows the value until it is reported', async () => {
    vi.useFakeTimers();
    const { press, onPress, buttons, left, w } = widget(ALARM, alarm('disarmed'));
    press(1);
    expect(onPress).toHaveBeenCalledWith({ source: 'cap:alarm:homealarm_state', value: 'partially_armed', button: 'Night', title: 'Surveillance' });
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

describe('Keypad: the keypad on a tap', () => {
  it('opens for a button that wants the code, and sends the code with the last digit', async () => {
    const { press, padOpen, dots, key, type, onPress, label, buttons } = widget(ALARM, alarm('armed'));
    press(2);
    expect(padOpen()).toBe(true);
    expect(label()).toBe('Disarm alarm');
    expect(dots()).toBe('◌○○○');
    key('4');
    key('7');
    key('back');
    type('71');
    expect(dots()).toBe('●●●◌');
    expect(onPress).not.toHaveBeenCalled();
    key('1');
    expect(onPress).toHaveBeenCalledWith({ flow: 'flow:f1', codeId: 'c1', code: '4711', button: 'Disarm alarm', title: 'Surveillance' });
    await vi.waitFor(() => expect(padOpen()).toBe(false));
    expect(buttons()[2]).toBe('Disarm alarm tick green');
  });

  it("is a phone's keypad: 1–9, then 0 and delete, in both layouts", () => {
    for (const layout of [undefined, 'compact']) {
      const { press, keys, root } = widget({ ...ALARM, layout }, alarm('armed'));
      press(2);
      expect(keys().map(k => k.getAttribute('aria-label'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Delete']);
      expect(root.querySelectorAll('.kp-keys > *')).toHaveLength(12);
    }
  });

  it('compact: the keypad takes the widget, with the title beside the label', () => {
    const { root, press } = widget({ ...ALARM, layout: 'compact' }, alarm('armed'));
    expect(root.classList.contains('kp-compact')).toBe(true);
    press(2);
    expect(root.classList.contains('pad-open')).toBe(true);
    expect(root.querySelector('.kp-pad-sub')!.textContent).toBe('Surveillance');
  });

  it('a wrong code: red dots that empty, and the tries left once they run low', async () => {
    vi.useFakeTimers();
    const { press, type, onPress, dots, left, root, padOpen } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: true, result: 'wrongCode', left: 4 });
    press(2);
    type('1234');
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.kp-dots')!.classList.contains('err')).toBe(true);
    expect(left()[1]).toBe('Wrong code');
    expect(padOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(dots()).toBe('◌○○○');
    type('1');
    expect(left()[1]).toBe('Surveillance'); // a new try: the message goes
    onPress.mockResolvedValueOnce({ ok: true, result: 'wrongCode', left: 2 });
    type('235');
    await vi.advanceTimersByTimeAsync(0);
    expect(left()[1]).toBe('Wrong code. Tries left: 2');
  });

  it('too many tries: the keys stop and count down', async () => {
    vi.useFakeTimers();
    const { press, type, onPress, keys, left, root } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: true, result: 'locked', retryAfter: 3 });
    press(2);
    type('1234');
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

  it('a code removed meanwhile: says so and takes no more digits', async () => {
    const { press, type, onPress, keys, left } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: true, result: 'codeMissing' });
    press(2);
    type('1234');
    await vi.waitFor(() => expect(left()[1]).toBe('This code was removed: pick one in the widget settings.'));
    expect(keys().every(k => k.disabled)).toBe(true);
  });

  it('a missing API key closes the keypad and says so on the button', async () => {
    const { press, type, onPress, left, padOpen } = widget(ALARM, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: false, reason: 'noKey' });
    press(2);
    type('1234');
    await vi.waitFor(() => expect(padOpen()).toBe(false));
    expect(left()[1]).toBe('To use this button, add an API key in the app settings.');
  });

  it('takes the keyboard while open; Escape, ✕ or 30 s alone close it', async () => {
    vi.useFakeTimers();
    const { press, dots, padOpen, root, onPress } = widget(ALARM, alarm('armed'));
    press(2);
    for (const k of ['4', '7', 'x']) document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    expect(dots()).toBe('●●◌○');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(dots()).toBe('●◌○○');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(padOpen()).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })); // closed: the keys are the page's again
    press(2);
    expect(dots()).toBe('◌○○○');
    root.querySelector<HTMLButtonElement>('.kp-close')!.click();
    expect(padOpen()).toBe(false);
    press(2);
    await vi.advanceTimersByTimeAsync(30e3);
    expect(padOpen()).toBe(false);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Keypad: the keypad always shown', () => {
  const always = { ...ALARM, keypad: 'always' };

  it('stays beside the state, with ✕ to clear in place of a close button', () => {
    const { root, keys, label, buttons } = widget(always, alarm('armed'));
    expect(root.classList.contains('kp-always')).toBe(true);
    expect(root.classList.contains('pad-open')).toBe(false);
    expect(label()).toBe('Enter the code for Disarm alarm'); // the only button behind the code
    expect(root.querySelector('.kp-close')).toBeNull();
    expect(keys().map(k => k.getAttribute('aria-label'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Delete']);
    expect(buttons()).toEqual(['Arm on tick red', 'Night purple', 'Disarm alarm code green']);
  });

  it('with one button behind the code, the code alone runs it', async () => {
    const { type, onPress, dots, buttons } = widget(always, alarm('armed'));
    type('4711');
    expect(onPress).toHaveBeenCalledWith({ flow: 'flow:f1', codeId: 'c1', code: '4711', button: 'Disarm alarm', title: 'Surveillance' });
    await vi.waitFor(() => expect(buttons()[2]).toBe('Disarm alarm tick green'));
    expect(dots()).toBe('○○○○'); // left alone beside buttons that need no code: it doesn't ask
  });

  it('with several, the code waits for a button, or a button for the code', async () => {
    const settings = { ...always, code1: true };
    const first = widget(settings, alarm('disarmed'));
    first.type('4711');
    expect(first.onPress).not.toHaveBeenCalled();
    expect(first.label()).toBe('Now tap a button');
    first.press(0);
    expect(first.onPress).toHaveBeenCalledWith({ source: 'cap:alarm:homealarm_state', value: 'armed', codeId: 'c1', code: '4711', button: 'Arm', title: 'Surveillance' });

    const second = widget(settings, alarm('partially_armed'));
    second.press(2);
    expect(second.buttons()[2]).toBe('Disarm alarm target code green');
    expect(second.label()).toBe('Enter the code for Disarm alarm');
    second.press(2); // a second tap lets go
    expect(second.buttons()[2]).toBe('Disarm alarm code green');
    second.press(0);
    second.type('4711');
    expect(second.onPress).toHaveBeenCalledWith({ source: 'cap:alarm:homealarm_state', value: 'armed', codeId: 'c1', code: '4711', button: 'Arm', title: 'Surveillance' });
  });

  it('a button without the code runs at once, and lets go of the button waiting and what was typed', () => {
    const { type, press, onPress, dots, buttons, label } = widget({ ...always, code1: true }, alarm('partially_armed'));
    press(2); // Disarm waits for the code
    type('47');
    expect([label(), dots()]).toEqual(['Enter the code for Disarm alarm', '●●◌○']);
    press(1); // Night needs no code
    expect(onPress).toHaveBeenCalledWith({ source: 'cap:alarm:homealarm_state', value: 'partially_armed', button: 'Night', title: 'Surveillance' });
    expect([label(), dots(), buttons()[2]]).toEqual(['Enter the code, then tap a button', '○○○○', 'Disarm alarm code green']);
  });

  it('pulses the next dot only while it waits for the code', () => {
    const mixed = widget(always, alarm('armed')); // Arm and Night need no code
    expect(mixed.dots()).toBe('○○○○');
    mixed.press(2);
    expect(mixed.dots()).toBe('◌○○○');
    mixed.press(2); // let go
    mixed.type('4');
    expect(mixed.dots()).toBe('●◌○○');
    const all = widget({ ...always, code1: true, code2: true }, alarm('armed')); // nothing to tap without it
    expect(all.dots()).toBe('◌○○○');
  });

  it('✕ and Escape clear what was typed and the button waiting; so does being left alone', async () => {
    vi.useFakeTimers();
    const { type, key, press, dots, buttons } = widget({ ...always, code1: true }, alarm('armed'));
    press(0);
    type('47');
    key('left');
    expect([dots(), buttons()[0]]).toEqual(['○○○○', 'Arm on tick red']);
    type('4');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dots()).toBe('○○○○');
    type('47');
    await vi.advanceTimersByTimeAsync(30e3);
    expect(dots()).toBe('○○○○');
  });

  it('a wrong code keeps the button waiting and empties the dots', async () => {
    vi.useFakeTimers();
    const { press, type, onPress, dots, buttons, left } = widget({ ...always, code1: true }, alarm('armed'));
    onPress.mockResolvedValueOnce({ ok: true, result: 'wrongCode', left: 4 });
    press(2);
    type('1234');
    await vi.advanceTimersByTimeAsync(0);
    expect(left()[1]).toBe('Wrong code');
    await vi.advanceTimersByTimeAsync(700);
    expect([dots(), buttons()[2]]).toEqual(['◌○○○', 'Disarm alarm target code green']);
  });

  it('without a code picked, there is nothing to type: no keypad', () => {
    const { root } = widget({ ...always, code: { id: 'none' } }, alarm('armed', { code: null }));
    expect(root.classList.contains('kp-always')).toBe(false);
  });

  it('a removed code: says so in place of the prompt, the keys off', () => {
    const { label, keys } = widget(always, alarm('armed', { code: { id: 'c1', missing: true } }));
    expect(label()).toBe('This code was removed: pick one in the widget settings.');
    expect(keys().every(k => k.disabled)).toBe(true);
  });
});

describe('Keypad: mount', () => {
  it('asks for the state with the flows and the code, and follows the capability', async () => {
    const handlers = new Map<string, (data: any) => void>();
    const api = vi.fn(async (method: string, _path: string) => (method === 'GET' ? alarm('armed') : { ok: true, result: 'done' }));
    const Homey = {
      getSettings: () => ALARM, __: () => undefined, api, on: (e: string, fn: any) => handlers.set(e, fn),
      ready: vi.fn(), setHeight: vi.fn(), hapticFeedback: vi.fn(),
    };
    const root = document.createElement('div');
    document.body.append(root);
    win.mountKeypadWidget(Homey, { root, frame: document.body });
    await vi.waitFor(() => expect(Homey.ready).toHaveBeenCalled());
    expect(api.mock.calls[0][1]).toMatch(/^\/state\?source=cap%3Aalarm%3Ahomealarm_state&flows=flow%3Af1&code=c1&perf=/);
    handlers.get('values:state')!({ deviceId: 'alarm', capabilityId: 'homealarm_state', value: 'disarmed' });
    handlers.get('values:state')!({ deviceId: 'other', capabilityId: 'homealarm_state', value: 'armed' });
    expect(root.querySelector('.kp-state')!.textContent).toBe('Disarmed');
    root.querySelectorAll<HTMLElement>('.kp-btn')[0].click();
    expect(Homey.hapticFeedback).toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('POST', '/press', { source: 'cap:alarm:homealarm_state', value: 'armed', button: 'Arm', title: 'Surveillance' });
  });

  it("still works where Homey's haptic feedback throws: a mouse click or a key, on a web dashboard", async () => {
    const api = vi.fn(async (method: string, _path: string) => (method === 'GET' ? alarm('armed') : { ok: true, result: 'done' }));
    const Homey = {
      getSettings: () => ALARM, __: () => undefined, api, on: () => {}, ready: vi.fn(), setHeight: vi.fn(),
      // As Homey's SDK does without a touch in the last 0.5 s.
      hapticFeedback: () => { throw new Error('shortPressHapticFeedback can only be called during a user touch or click event.'); },
    };
    const root = document.createElement('div');
    document.body.append(root);
    win.mountKeypadWidget(Homey, { root, frame: document.body });
    await vi.waitFor(() => expect(Homey.ready).toHaveBeenCalled());
    root.querySelectorAll<HTMLElement>('.kp-btn')[1].click(); // Night, without the code
    expect(api).toHaveBeenCalledWith('POST', '/press', expect.objectContaining({ value: 'partially_armed' }));
    root.querySelectorAll<HTMLElement>('.kp-btn')[2].click(); // Disarm: the keypad opens, and takes keys
    expect(root.classList.contains('pad-open')).toBe(true);
    for (const k of '4711') document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    expect(api).toHaveBeenCalledWith('POST', '/press', expect.objectContaining({ flow: 'flow:f1', codeId: 'c1', code: '4711' }));
  });
});
