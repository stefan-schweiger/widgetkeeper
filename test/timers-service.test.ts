import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey } from './helpers/fakeHomey.js';
import TimerService, { timerDurationText, TIMERS_SETTING, TIMERS_STATE_EVENT } from '../lib/TimerService.js';
import { readFileSync } from 'node:fs';

const en = JSON.parse(readFileSync('locales/en.json', 'utf8'));
const da = JSON.parse(readFileSync('locales/da.json', 'utf8'));

const MIN = 60e3;

function setup(saved?: unknown) {
  const homey = fakeHomey(fakeApi());
  if (saved !== undefined) homey.settings.set(TIMERS_SETTING, saved);
  const finished = vi.fn();
  const service = new TimerService(homey, () => {}, () => {}, finished);
  service.start();
  return { homey, service, finished };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T18:40:00+02:00'));
});
afterEach(() => { vi.useRealTimers(); });

describe('timerDurationText', () => {
  const tr = (strings: Record<string, string>) => (key: string, tokens: Record<string, string>) =>
    strings[key.replace('timers.', '')].replace(/__(\w+)__/g, (_, k) => tokens[k]);
  it('names a duration as the widget does, for the Flow token', () => {
    const t = tr(en.timers);
    expect(timerDurationText(10, t, 'en')).toBe('10 min');
    expect(timerDurationText(90, t, 'en')).toBe('1 h 30 min');
    expect(timerDurationText(120, t, 'en')).toBe('2 h');
    expect(timerDurationText(0.5, t, 'en')).toBe('30 s');
    expect(timerDurationText(2.5, tr(da.timers), 'da')).toBe(`2,5 ${da.timers.minutes.replace('__minutes__ ', '')}`);
  });
});

describe('timers', () => {
  it('starts a timer that rings after its minutes and fires the Flow card', async () => {
    const { service, finished, homey } = setup();
    const state = service.startTimer('w1', 10, ' Pasta ');
    expect(state.timers).toEqual([expect.objectContaining({ label: 'Pasta', duration: 10 * MIN, endsAt: Date.now() + 10 * MIN, remaining: null, doneAt: null })]);
    expect(homey.api.realtime).toHaveBeenCalledWith(TIMERS_STATE_EVENT, expect.objectContaining({ instance: 'w1' }));
    await vi.advanceTimersByTimeAsync(10 * MIN - 1);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ label: 'Pasta', duration: 10 * MIN }));
    expect(service.getState('w1').timers[0].doneAt).toBe(Date.now());
  });

  it('keeps each widget instance its own timer', () => {
    const { service } = setup();
    service.startTimer('w1', 5, '');
    service.startTimer('w2', 7, '');
    expect(service.getState('w1').timers.map(t => t.duration)).toEqual([5 * MIN]);
    expect(service.getState('w2').timers.map(t => t.duration)).toEqual([7 * MIN]);
    expect(service.getState('w3').timers).toEqual([]);
  });

  it('pauses, resumes and adds a minute', async () => {
    const { service, finished } = setup();
    const id = service.startTimer('w1', 5, '').timers[0].id;
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(service.act('w1', id, 'pause').timers[0]).toMatchObject({ endsAt: null, remaining: 3 * MIN });
    await vi.advanceTimersByTimeAsync(10 * MIN); // paused: never rings
    expect(finished).not.toHaveBeenCalled();
    service.act('w1', id, 'add');
    expect(service.getState('w1').timers[0]).toMatchObject({ remaining: 4 * MIN, duration: 6 * MIN });
    expect(service.act('w1', id, 'resume').timers[0]).toMatchObject({ endsAt: Date.now() + 4 * MIN, remaining: null });
    await vi.advanceTimersByTimeAsync(4 * MIN);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('cancels and dismisses, and ignores a timer that is already gone', async () => {
    const { service, finished } = setup();
    const id = service.startTimer('w1', 1, '').timers[0].id;
    expect(service.act('w1', id, 'cancel').timers).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(finished).not.toHaveBeenCalled();
    expect(service.act('w1', id, 'dismiss').timers).toEqual([]);
  });

  it('drops a finished timer 10 minutes after it rang', async () => {
    const { service } = setup();
    service.startTimer('w1', 1, '');
    await vi.advanceTimersByTimeAsync(MIN);
    expect(service.getState('w1').timers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(11 * MIN);
    expect(service.getState('w1').timers).toEqual([]);
  });

  it('refuses bad minutes', () => {
    const { service } = setup();
    for (const bad of [0, -1, NaN, '5', 24 * 60 + 1]) expect(() => service.startTimer('w1', bad, '')).toThrow();
  });

  it('keeps one timer per widget: a new start replaces the one it had', async () => {
    const { service, finished } = setup();
    service.startTimer('w1', 1, 'First');
    const state = service.startTimer('w1', 5, 'Second');
    expect(state.timers).toEqual([expect.objectContaining({ label: 'Second' })]);
    await vi.advanceTimersByTimeAsync(2 * MIN); // the first one's timeout is gone
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ label: 'Second' }));
  });
});

describe('saving', () => {
  it('saves the timers, and picks them up again after a restart', async () => {
    const first = setup();
    first.service.startTimer('w1', 10, 'Bread');
    await vi.advanceTimersByTimeAsync(3000);
    const saved = first.homey.settings.get(TIMERS_SETTING);
    expect(saved.w1).toHaveLength(1);
    await first.service.stop();

    const second = setup(saved);
    expect(second.service.getState('w1').timers).toEqual([expect.objectContaining({ label: 'Bread' })]);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(second.finished).toHaveBeenCalledTimes(1);
  });

  it('finishes a timer that ran out while the app was stopped, firing the card only if it ended lately', () => {
    const now = Date.now();
    const timer = (id: string, endsAt: number) => ({ id, label: '', duration: MIN, endsAt, remaining: null, doneAt: null });
    const { service, finished } = setup({ w1: [timer('late', now - 2 * MIN), timer('old', now - 60 * MIN)], junk: 'x' });
    expect(service.getState('w1').timers.map(t => t.doneAt)).toEqual([now - 2 * MIN, now - 60 * MIN]);
    return Promise.resolve().then(() => {
      expect(finished).toHaveBeenCalledTimes(1);
      expect(finished).toHaveBeenCalledWith(expect.objectContaining({ id: 'late' }));
    });
  });

  it('describes the timers by count only', () => {
    const { service } = setup();
    const id = service.startTimer('w1', 5, 'Secret').timers[0].id;
    service.startTimer('w2', 5, '');
    service.act('w1', id, 'pause');
    expect(service.describe()).toEqual({ widgets: 2, running: 1, paused: 1, done: 0 });
  });
});
