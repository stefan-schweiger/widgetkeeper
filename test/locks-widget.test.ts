// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('locks'); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:40:00+02:00')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00+02:00`).getTime();
const cap = (value: unknown, setable = true, time = '18:12') => ({ value, setable, lastUpdated: at(time) });
const front = (locked: unknown = true) => ({ id: 'front', name: 'Front door', icon: null, caps: { locked: cap(locked, true, '17:30'), alarm_contact: cap(false, false, '17:29') } });
const back = (locked: unknown = true) => ({ id: 'back', name: 'Back door', icon: null, caps: { locked: cap(locked, true, '18:12') } });
const garage = (closed: unknown = true) => ({ id: 'garage', name: 'Garage', icon: null, caps: { garagedoor_closed: cap(closed, true, '16:05') } });
const window_ = (open = false) => ({ id: 'window', name: 'Window', icon: null, caps: { alarm_contact: cap(open, false, '12:00') } });

function widget(devices: any[], opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSet = vi.fn(async (_d: string, _c: string, _v: boolean) => {});
  const w = win.createLocksWidget(root, { locale: 'en-GB', onSet, ...opts });
  w.setState({ devices, language: 'en' });
  const title = () => root.querySelector('.lk-title')!.textContent;
  const sub = () => root.querySelector('.lk-sub')!.textContent;
  const tile = () => root.querySelector<HTMLElement>('.lk-tile')!;
  const list = () => root.querySelector<HTMLElement>('.lk-list')!;
  const row = (id: string) => root.querySelector<HTMLElement>(`.lk-row[data-device="${id}"]`)!;
  const button = (id: string) => {
    const b = row(id).querySelector<HTMLElement>('.lk-action')!;
    return b.style.display === 'none' ? null : b;
  };
  const message = () => root.querySelector<HTMLElement>('.lk-message')!;
  return { w, root, title, sub, tile, list, row, button, message, onSet };
}

describe('summary', () => {
  it('says all is locked and closed, since the last change', () => {
    const { title, sub, tile } = widget([front(), back(), garage()]);
    expect(title()).toBe('All locked and closed');
    expect(sub()).toBe('Since 18:12');
    expect(tile().dataset.level).toBe('secure');
  });

  it('names what kind of devices are secure', () => {
    expect(widget([back()]).title()).toBe('All locked');
    expect(widget([garage(), window_()]).title()).toBe('All closed');
  });

  it('names the one device that is not secure, and since when', () => {
    const { title, sub, tile } = widget([front(), back(false), garage()]);
    expect(title()).toBe('Back door');
    expect(sub()).toBe('Unlocked since 18:12');
    expect(tile().dataset.level).toBe('insecure');
  });

  it('counts several, by what they are', () => {
    expect(widget([front(false), back(false)]).title()).toBe('2 unlocked');
    expect(widget([garage(false), window_(true)]).title()).toBe('2 open');
    const { title, sub } = widget([back(false), garage(false), front()]);
    expect(title()).toBe('2 open or unlocked');
    expect(sub()).toBe('Back door, Garage');
  });

  it('counts a device with a lock and a door sensor as one', () => {
    const d = front(false);
    d.caps.alarm_contact.value = true;
    const { title, sub } = widget([d, back()]);
    expect(title()).toBe('Front door');
    expect(sub()).toBe('Unlocked · Open since 17:30');
  });

  it('mentions devices that are gone, and waits for a first value', () => {
    expect(widget([back(), { id: 'x', missing: true }]).sub()).toBe('Since 18:12 · 1 unavailable');
    expect(widget([back(null)]).title()).toBe('No status yet');
  });

  it('never says all is locked while a device has no status yet', () => {
    const one = widget([front(), back(null)]);
    expect(one.title()).toBe('Back door');
    expect(one.sub()).toBe('No status yet');
    expect(one.tile().dataset.level).toBe('unknown');
    const two = widget([front(null), back(null), garage(), { id: 'x', missing: true }]);
    expect(two.title()).toBe('2 without status');
    expect(two.sub()).toBe('Front door, Back door · 1 unavailable');
    // Something open still comes first.
    expect(widget([back(null), garage(false)]).title()).toBe('Garage');
  });
});

describe('list', () => {
  it('opens and closes with a tap on the summary', () => {
    const { root, list } = widget([front(), back(false)]);
    expect(list().style.display).toBe('none');
    root.querySelector<HTMLElement>('.lk-summary')!.click();
    expect(list().style.display).toBe('');
    root.querySelector<HTMLElement>('.lk-summary')!.click();
    expect(list().style.display).toBe('none');
  });

  it('is always open with view "list", without a chevron', () => {
    const { root, list } = widget([front()], { view: 'list' });
    expect(list().style.display).toBe('');
    expect(root.querySelector('.lk-chevron')).toBe(null);
  });

  it('shows each device’s state, only what is not secure for one that isn’t', () => {
    const { row } = widget([front(), back(false), window_()], { view: 'list' });
    expect(row('front').querySelector('.lk-state')!.textContent).toBe('Locked · Closed');
    expect(row('back').querySelector('.lk-state')!.textContent).toBe('Unlocked');
    expect(row('back').dataset.level).toBe('insecure');
    expect(row('window').querySelector('.lk-state')!.textContent).toBe('Closed');
  });

  it('locks and closes, but only unlocks with the setting', () => {
    const { button, onSet } = widget([front(), back(false), garage(false), window_()], { view: 'list' });
    expect(button('front')).toBe(null);
    expect(button('window')).toBe(null);
    expect(button('back')!.textContent).toBe('Lock');
    expect(button('garage')!.textContent).toBe('Close');
    button('back')!.click();
    expect(onSet).toHaveBeenCalledWith('back', 'locked', true);
    expect(button('back')!.classList.contains('busy')).toBe(true);

    const unlocking = widget([front(), garage()], { view: 'list', allowUnlock: true });
    expect(unlocking.button('front')!.textContent).toBe('Unlock');
    unlocking.button('garage')!.click();
    expect(unlocking.onSet).toHaveBeenCalledWith('garage', 'garagedoor_closed', false);
  });

  it('is busy until the lock reports its new state', () => {
    const { w, button, title } = widget([back(false)], { view: 'list' });
    button('back')!.click();
    w.pushChange({ deviceId: 'back', capabilityId: 'locked', value: true, t: Date.now() });
    expect(title()).toBe('All locked');
    expect(button('back')).toBe(null);
  });

  it('locks everything at once with Lock all', () => {
    const { root, onSet } = widget([front(false), back(false), garage()], { view: 'list' });
    const all = root.querySelector<HTMLElement>('.lk-all')!;
    expect(all.style.display).toBe('');
    all.click();
    expect(onSet.mock.calls.map(c => c[0])).toEqual(['front', 'back']);
  });

  it('shakes the row and says so when a change fails', async () => {
    const { button, onSet, message, row } = widget([back(false)], { view: 'list' });
    onSet.mockRejectedValueOnce(new Error('offline'));
    button('back')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(message().textContent).toBe('Could not change Back door.');
    expect(row('back').classList.contains('shake')).toBe(true);
    expect(button('back')!.classList.contains('busy')).toBe(false);
  });
});

describe('level', () => {
  it('tells secure, insecure, unknown and missing apart', () => {
    expect(win.lockLevel(front())).toBe('secure');
    expect(win.lockLevel(back(false))).toBe('insecure');
    expect(win.lockLevel(back(null))).toBe('unknown');
    expect(win.lockLevel(front(null))).toBe('unknown'); // the door is closed, but is it locked?
    expect(win.lockLevel({ id: 'x', missing: true })).toBe('missing');
  });
});
