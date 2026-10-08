// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('timers'); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:40:00+02:00')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const MIN = 60e3;
const running = (id: string, minutesLeft: number, extra: object = {}) =>
  ({ id, label: '', duration: 10 * MIN, endsAt: Date.now() + minutesLeft * MIN, remaining: null, doneAt: null, ...extra });

function widget(timers: any[] = [], opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onStart = vi.fn(async (_m: number, _l: string) => null as any);
  const onAction = vi.fn(async (_id: string, _a: string) => null as any);
  const onHaptic = vi.fn();
  const w = win.createTimersWidget(root, {
    presets: [{ minutes: 5, label: '' }, { minutes: 7, label: 'Eggs' }, { minutes: 90, label: '' }],
    sound: false, onStart, onAction, onHaptic, ...opts,
  });
  w.setState({ timers, now: Date.now() });
  const rows = () => [...root.querySelectorAll<HTMLElement>('.tm-row')];
  const presets = () => [...root.querySelectorAll<HTMLElement>('.tm-preset')];
  const text = (r: HTMLElement, cls: string) => r.querySelector(`.${cls}`)!.textContent;
  const message = () => root.querySelector<HTMLElement>('.tm-message')!;
  return { w, root, rows, presets, text, message, onStart, onAction, onHaptic };
}

describe('helpers', () => {
  it('formats the time left, rounded up', () => {
    expect(win.formatTimerRemaining(0)).toBe('0:00');
    expect(win.formatTimerRemaining(1)).toBe('0:01');
    expect(win.formatTimerRemaining(9 * MIN + 12e3)).toBe('9:12');
    expect(win.formatTimerRemaining(62 * MIN + 3e3)).toBe('1:02:03');
  });

  it('reads the presets from the settings, skipping empty ones', () => {
    expect(win.timerPresetsFromSettings({ minutes1: 5, label1: ' Eggs ', minutes2: 0, minutes3: '', minutes4: 2000 }))
      .toEqual([{ minutes: 5, label: 'Eggs' }]);
  });
});

describe('render', () => {
  it('shows the presets by name or duration', () => {
    const { presets } = widget();
    expect(presets().map(p => p.textContent)).toEqual(['5 min', 'Eggs7 min', '1 h 30 min']);
  });

  it('shows the timer in the place of the presets, with what is left, when it ends and the fill', () => {
    const { root, rows, text } = widget([running('a', 6.5, { label: 'Pasta' })]);
    expect(root.querySelector<HTMLElement>('.tm-presets')!.style.display).toBe('none');
    expect(rows().map(r => r.dataset.state)).toEqual(['running']);
    expect(text(rows()[0], 'tm-name')).toBe('Pasta');
    expect(text(rows()[0], 'tm-time')).toBe('6:30');
    expect(text(rows()[0], 'tm-sub')).toBe('Ends 18:46');
    expect(rows()[0].style.getPropertyValue('--tm-left')).toBe('65%');
  });

  it('shows a paused timer, and only one when the app sends more', () => {
    const { rows, text } = widget([running('a', 3), { ...running('b', 0), endsAt: null, remaining: 2 * MIN }]);
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0], 'tm-name')).toBe('10 min');
    expect(text(rows()[0], 'tm-sub')).toBe('Paused');
  });

  it('counts down, and rings once it runs out', () => {
    const { rows, text, onHaptic } = widget([running('a', 0.05)]);
    vi.advanceTimersByTime(1000);
    expect(text(rows()[0], 'tm-time')).toBe('0:02');
    vi.advanceTimersByTime(2500);
    expect(rows()[0].dataset.state).toBe('done');
    expect(text(rows()[0], 'tm-sub')).toBe('Done');
    expect(onHaptic).toHaveBeenCalledTimes(1);
  });

  it('corrects for a Homey clock that differs from the screen', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const w = win.createTimersWidget(root, { presets: [], sound: false });
    const homeyNow = Date.now() + 30e3; // the Homey is 30 s ahead
    w.setState({ timers: [{ id: 'a', label: '', duration: MIN, endsAt: homeyNow + MIN, remaining: null, doneAt: null }], now: homeyNow });
    expect(root.querySelector('.tm-time')!.textContent).toBe('1:00');
  });

  it('asks to set up presets when there are none and nothing runs', () => {
    expect(widget([], { presets: [] }).message().textContent).toBe('Set up timers in the widget settings.');
  });
});

describe('taps', () => {
  it('starts a timer from a preset at once, in the place of the presets', async () => {
    const { root, presets, rows, onStart } = widget();
    presets()[1].click();
    expect(onStart).toHaveBeenCalledWith(7, 'Eggs');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.tm-name')!.textContent).toBe('Eggs');
    expect(root.querySelector<HTMLElement>('.tm-presets')!.style.display).toBe('none');
  });

  it('takes back a start that failed', async () => {
    const { presets, rows, onStart, message } = widget();
    onStart.mockRejectedValueOnce(new Error('nope'));
    presets()[0].click();
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
    expect(presets()[0].parentElement!.style.display).toBe('');
    expect(message().textContent).toBe('Could not change the timer.');
  });

  it('pauses and resumes from the row, adds a minute and cancels from its buttons', () => {
    const { root, rows, onAction } = widget([running('a', 5)]);
    rows()[0].click();
    expect(onAction).toHaveBeenLastCalledWith('a', 'pause');
    expect(rows()[0].dataset.state).toBe('paused');
    rows()[0].click();
    expect(onAction).toHaveBeenLastCalledWith('a', 'resume');
    rows()[0].querySelector<HTMLElement>('.tm-add')!.click();
    expect(onAction).toHaveBeenLastCalledWith('a', 'add');
    expect(rows()[0].querySelector('.tm-time')!.textContent).toBe('6:00');
    rows()[0].querySelector<HTMLElement>('.tm-cancel')!.click();
    expect(onAction).toHaveBeenLastCalledWith('a', 'cancel');
    expect(onAction).toHaveBeenCalledTimes(4); // the buttons' taps aren't also the row's
    expect(rows()).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('.tm-presets')!.style.display).toBe(''); // the presets are back
  });

  it('puts the timer back when an action fails', async () => {
    const { rows, onAction, message } = widget([running('a', 5)]);
    onAction.mockRejectedValueOnce(new Error('nope'));
    rows()[0].querySelector<HTMLElement>('.tm-cancel')!.click();
    expect(rows()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].dataset.state).toBe('running');
    expect(rows()[0].classList.contains('shake')).toBe(true);
    expect(message().textContent).toBe('Could not change the timer.');
    onAction.mockRejectedValueOnce(new Error('nope'));
    rows()[0].click();
    expect(rows()[0].dataset.state).toBe('paused');
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()[0].dataset.state).toBe('running');
  });

  it('sends what was done to a timer before its start was answered', async () => {
    let answer: (v: any) => void = () => {};
    const { presets, rows, onStart, onAction } = widget();
    onStart.mockImplementationOnce(() => new Promise(res => { answer = res; }));
    presets()[0].click();
    rows()[0].click(); // pause
    rows()[0].querySelector<HTMLElement>('.tm-cancel')!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
    answer({ timers: [running('real', 5, { duration: 5 * MIN })], now: Date.now() });
    await vi.advanceTimersByTimeAsync(0);
    expect(onAction.mock.calls).toEqual([['real', 'pause'], ['real', 'cancel']]);
    expect(rows()).toHaveLength(0);
  });

  it('dismisses a finished timer with a tap', () => {
    const { rows, onAction } = widget([running('a', 0, { doneAt: Date.now() })]);
    rows()[0].click();
    expect(onAction).toHaveBeenCalledWith('a', 'dismiss');
    expect(rows()).toHaveLength(0);
  });
});
