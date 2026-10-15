// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('variables'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const flag = (value = false) => ({ id: 'f', name: 'Guest mode', type: 'boolean', value });
const num = (value: unknown = 18) => ({ id: 'n', name: 'Night setpoint', type: 'number', value });
const text = (value = 'Hello') => ({ id: 's', name: 'Message', type: 'string', value });
const dec = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

function widget(vars: any[], extra: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSet = vi.fn(async (..._args: unknown[]) => {});
  const w = win.createVariablesWidget(root, { onSet, ...extra });
  w.setState(vars);
  const rows = () => [...root.querySelectorAll<HTMLElement>('.vr-row')];
  const row = (i: number) => rows()[i];
  const value = (i: number) => row(i).querySelector('.vr-value')!.textContent;
  const message = () => root.querySelector<HTMLElement>('.vr-message')!;
  return { w, root, rows, row, value, onSet, message };
}

describe('helpers', () => {
  it('steps without floating-point noise', () => {
    expect(win.variableStepValue(0.1, 0.2, 1)).toBe(0.3);
    expect(win.variableStepValue(20.25, 1, -1)).toBe(19.25);
    expect(win.variableStepValue(null, 0.5, 1)).toBe(0.5);
  });

  it('parses typed numbers, a decimal comma too', () => {
    expect(win.parseVariableNumber('21,5')).toBe(21.5);
    expect(win.parseVariableNumber(' -3 ')).toBe(-3);
    expect(win.parseVariableNumber('12abc')).toBeNull();
    expect(win.parseVariableNumber('')).toBeNull();
  });
});

describe('render', () => {
  it('shows one row per slot with the full name and a control per type', () => {
    const { rows, row, value } = widget([flag(true), num(18.5), text(), { id: 'x', missing: true }]);
    expect(rows().map(r => r.dataset.type)).toEqual(['boolean', 'number', 'string', 'missing']);
    expect(rows().map(r => r.querySelector('.vr-name')!.textContent)).toEqual(['Guest mode', 'Night setpoint', 'Message', 'Variable not found']);
    expect(row(0).classList.contains('active')).toBe(true);
    expect(row(0).querySelector('.vr-switch')!.getAttribute('aria-checked')).toBe('true');
    expect(value(1)).toBe(dec(18.5));
    expect(row(1).querySelectorAll('.vr-step')).toHaveLength(2);
    expect(value(2)).toBe('Hello');
    expect(row(3).classList.contains('missing')).toBe(true);
  });

  it('sets the column count', () => {
    expect(widget([flag()], { columns: '2' }).root.dataset.columns).toBe('2');
    expect(widget([flag()]).root.dataset.columns).toBe('1');
  });

  it('follows realtime changes and deletions', () => {
    const { w, row, value } = widget([flag(), num()]);
    w.pushChange({ id: 'f', name: 'Guest mode', type: 'boolean', value: true });
    w.pushChange({ id: 'n', name: 'Night', type: 'number', value: 17 });
    expect(row(0).classList.contains('active')).toBe(true);
    expect(value(1)).toBe('17');
    expect(row(1).querySelector('.vr-name')!.textContent).toBe('Night');
    w.pushChange({ id: 'n', missing: true });
    expect(row(1).dataset.type).toBe('missing');
  });
});

describe('editing', () => {
  it('toggles a yes/no variable on a tap, showing the new value at once', () => {
    const { row, onSet } = widget([flag(false)]);
    row(0).click();
    expect(onSet).toHaveBeenCalledWith('f', true);
    expect(row(0).classList.contains('active')).toBe(true);
  });

  it('sends a burst of +/− taps once, with the summed step', () => {
    const { row, value, onSet } = widget([num(18)], { step: 0.5 });
    const [minus, plus] = row(0).querySelectorAll<HTMLElement>('.vr-step');
    plus.click(); plus.click(); plus.click(); minus.click();
    expect(value(0)).toBe('19');
    expect(onSet).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith('n', 19);
  });

  it('opens an input on a tap: Enter sends, Escape cancels', () => {
    const { row, value, onSet } = widget([num(18), text('Hi')]);
    row(0).click();
    let input = row(0).querySelector<HTMLInputElement>('.vr-input')!;
    expect(input.value).toBe('18');
    input.value = '21,5';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new Event('blur')); // happy-dom may not blur on its own
    expect(onSet).toHaveBeenCalledWith('n', 21.5);
    expect(value(0)).toBe(dec(21.5));

    row(1).click();
    input = row(1).querySelector<HTMLInputElement>('.vr-input')!;
    input.value = 'Bye';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    input.dispatchEvent(new Event('blur'));
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(value(1)).toBe('Hi');
  });

  it('keeps an open input while realtime changes arrive', () => {
    const { w, row } = widget([text('Hi')]);
    row(0).click();
    const input = row(0).querySelector<HTMLInputElement>('.vr-input')!;
    input.value = 'Typing';
    w.pushChange({ id: 's', name: 'Message', type: 'string', value: 'Other' });
    expect(row(0).querySelector('.vr-input')).toBe(input);
    expect(input.value).toBe('Typing');
  });

  it('reverts and shows a transient message when a change fails', async () => {
    const { row, onSet, message, rows } = widget([flag(false)]);
    onSet.mockRejectedValueOnce(new Error('nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    row(0).click();
    await vi.waitFor(() => expect(message().textContent).toBe('Could not change Guest mode.'));
    expect(row(0).classList.contains('active')).toBe(false);
    expect(rows()).toHaveLength(1);
    vi.advanceTimersByTime(8100);
    expect(message().style.display).toBe('none');
  });

  it("tells the user to add an API key when the app has none", async () => {
    const { row, onSet, message } = widget([flag(false)]);
    onSet.mockRejectedValueOnce(Object.assign(new Error('noKey'), { reason: 'noKey' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    row(0).click();
    await vi.waitFor(() => expect(message().textContent).toBe('To change variables, add an API key in the app settings.'));
  });
});

describe('lowest and highest number', () => {
  const steps = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('.vr-step')];
  const limited = (row: HTMLElement) => steps(row).map(b => b.classList.contains('at-limit'));
  function type(row: HTMLElement, text: string) {
    row.click();
    const input = row.querySelector<HTMLInputElement>('.vr-input')!;
    input.value = text;
    input.dispatchEvent(new Event('blur'));
  }

  it('stops a burst of + at the highest number and sends it once', () => {
    const { row, value, onSet } = widget([num(0.95)], { step: 0.05, min: 0, max: 1 });
    const [, plus] = steps(row(0));
    plus.click(); plus.click(); plus.click();
    expect(value(0)).toBe('1');
    expect(limited(row(0))).toEqual([false, true]);
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    vi.advanceTimersByTime(800);
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith('n', 1);
  });

  it('stops − at the lowest number and does nothing there', () => {
    const { row, value, onSet } = widget([num(0)], { step: 0.05, min: 0, max: 1 });
    expect(limited(row(0))).toEqual([true, false]);
    steps(row(0))[0].click();
    vi.advanceTimersByTime(800);
    expect(value(0)).toBe('0');
    expect(onSet).not.toHaveBeenCalled();
  });

  it('clamps typed numbers, a decimal comma too', () => {
    const { row, onSet } = widget([num(0.5)], { min: 0, max: 1 });
    type(row(0), '1,5');
    expect(onSet).toHaveBeenLastCalledWith('n', 1);
    type(row(0), '-2');
    expect(onSet).toHaveBeenLastCalledWith('n', 0);
    type(row(0), '0,25');
    expect(onSet).toHaveBeenLastCalledWith('n', 0.25);
  });

  it('has no limit when a setting is empty (null is not 0)', () => {
    for (const limits of [{}, { min: null, max: null }, { min: '', max: '' }]) {
      const { row, onSet } = widget([num(0)], limits);
      expect(limited(row(0))).toEqual([false, false]);
      steps(row(0))[0].click();
      vi.advanceTimersByTime(800);
      expect(onSet).toHaveBeenCalledWith('n', -1);
    }
  });

  it('shows a value outside the limits as it is, and − moves it to the highest', () => {
    const { row, value, onSet } = widget([num(5)], { min: 0, max: 1 });
    expect(value(0)).toBe('5');
    expect(limited(row(0))).toEqual([false, true]);
    steps(row(0))[1].click();
    steps(row(0))[0].click();
    vi.advanceTimersByTime(800);
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith('n', 1);
  });

  it('swaps a lowest number above the highest', () => {
    const { row, onSet } = widget([num(0.5)], { min: 1, max: 0 });
    type(row(0), '3');
    expect(onSet).toHaveBeenLastCalledWith('n', 1);
  });
});

describe('read only', () => {
  it('shows yes/no as a dot and Yes/No, and numbers without − and +', () => {
    const { row, value } = widget([flag(true), flag(false), { ...flag(), value: null }, num(18), text()], { readOnly: true });
    expect(row(0).querySelector('.vr-switch')).toBeNull();
    expect(row(0).querySelector('.vr-dot')).not.toBeNull();
    expect(value(0)).toBe('Yes');
    expect(row(0).classList.contains('active')).toBe(true);
    expect(value(1)).toBe('No');
    expect(row(1).classList.contains('active')).toBe(false);
    expect(value(2)).toBe('–');
    expect(row(2).classList.contains('unknown')).toBe(true);
    expect(row(3).querySelectorAll('.vr-step')).toHaveLength(0);
    expect(value(3)).toBe('18');
    expect(value(4)).toBe('Hello');
  });

  it('does nothing on a tap: no change sent, no input', () => {
    const { rows, onSet, root } = widget([flag(false), num(18), text()], { readOnly: true });
    expect(root.classList.contains('vr-readonly')).toBe(true);
    for (const r of rows()) {
      r.click();
      r.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [{ clientX: 0, clientY: 0 } as Touch] }));
      r.dispatchEvent(new TouchEvent('touchend', { changedTouches: [{ clientX: 0, clientY: 0 } as Touch] }));
    }
    vi.advanceTimersByTime(800);
    expect(onSet).not.toHaveBeenCalled();
    expect(root.querySelector('.vr-input')).toBeNull();
  });

  it('follows realtime changes', () => {
    const { w, row, value } = widget([flag(false)], { readOnly: true });
    w.pushChange(flag(true));
    expect(value(0)).toBe('Yes');
    expect(row(0).classList.contains('active')).toBe(true);
  });
});

describe('name override', () => {
  it("shows a row's own name and keeps it through realtime updates", () => {
    const { w, rows } = widget([flag(), num()], { names: ['Guests', ''] });
    const names = () => rows().map(r => r.querySelector('.vr-name')!.textContent);
    expect(names()).toEqual(['Guests', 'Night setpoint']);
    w.pushChange({ ...flag(true), name: 'Guest mode (renamed)' });
    expect(names()).toEqual(['Guests', 'Night setpoint']);
  });
});
