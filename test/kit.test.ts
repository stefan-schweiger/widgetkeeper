// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The kit's taps, message line and device loop (widgets/spacer/public/kit.js), which the widgets used to copy.
new Function(readFileSync('widgets/spacer/public/kit.js', 'utf8'))();
const kit = (window as any).WidgetkeeperKit;

function touch(node: Element, type: string, x = 0, y = 0) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { changedTouches: [{ clientX: x, clientY: y }] });
  node.dispatchEvent(e);
  return e;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('onTap()', () => {
  it('a touch that ends where it started is a tap, and the click after it is ignored', () => {
    const node = document.createElement('div');
    const fn = vi.fn();
    kit.onTap(node, fn);
    touch(node, 'touchstart', 5, 5);
    expect(node.classList.contains('pressing')).toBe(true);
    const end = touch(node, 'touchend', 5, 5);
    expect(end.defaultPrevented).toBe(true);
    expect(node.classList.contains('pressing')).toBe(false);
    node.click();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    node.click(); // a mouse
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a drag is no tap, and the click a browser sends after it is ignored', () => {
    const node = document.createElement('div');
    const fn = vi.fn();
    kit.onTap(node, fn);
    touch(node, 'touchstart', 0, 0);
    touch(node, 'touchmove', 0, 11);
    expect(node.classList.contains('pressing')).toBe(false);
    touch(node, 'touchend', 0, 11);
    node.click();
    expect(fn).not.toHaveBeenCalled();
  });

  it('a shared guard ignores a click on another node right after a touch', () => {
    const guard = kit.touchGuard();
    const [a, b] = [document.createElement('div'), document.createElement('div')];
    const fn = vi.fn();
    kit.onTap(a, fn, { guard });
    kit.onTap(b, fn, { guard });
    touch(a, 'touchstart');
    touch(a, 'touchmove', 0, 20);
    touch(a, 'touchend', 0, 20);
    b.click();
    expect(fn).not.toHaveBeenCalled();
    guard.touched(); // a bar's touch
    vi.advanceTimersByTime(799);
    b.click();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    b.click();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Enter and Space tap it unless `keys` is off', () => {
    const [a, b] = [document.createElement('div'), document.createElement('div')];
    const fa = vi.fn();
    const fb = vi.fn();
    kit.onTap(a, fa);
    kit.onTap(b, fb, { keys: false });
    for (const key of ['Enter', ' ', 'a']) {
      a.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      b.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(fa).toHaveBeenCalledTimes(2);
    expect(fb).not.toHaveBeenCalled();
  });

  it('`stop` keeps a button\'s tap from reaching the row around it', () => {
    const row = document.createElement('div');
    const button = document.createElement('span');
    row.append(button);
    const onRow = vi.fn();
    const onButton = vi.fn();
    kit.onTap(row, onRow);
    kit.onTap(button, onButton, { stop: true });
    touch(button, 'touchstart');
    touch(button, 'touchend');
    vi.advanceTimersByTime(1000);
    button.click();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onButton).toHaveBeenCalledTimes(3);
    expect(onRow).not.toHaveBeenCalled();
    expect(row.classList.contains('pressing')).toBe(false);
  });
});

describe('messageLine()', () => {
  it('a transient message goes by itself; a lasting one clears the content', () => {
    const render = vi.fn();
    const clear = vi.fn();
    const message = kit.messageLine(render, { clear, ms: 6000 });
    message.set('Could not save.', true);
    expect(message.text).toBe('Could not save.');
    expect(clear).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6000);
    expect(message.text).toBe(null);
    expect(render).toHaveBeenCalledTimes(2);
    message.set('Could not load.');
    expect(clear).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60e3);
    expect(message.text).toBe('Could not load.');
  });

  it('a new message replaces a transient one and its timer', () => {
    const message = kit.messageLine(() => {});
    message.set('one', true);
    vi.advanceTimersByTime(7000);
    message.set('two', true);
    vi.advanceTimersByTime(7000);
    expect(message.text).toBe('two');
  });

  it('reset() drops it; with `lastingOnly` a transient one runs out by itself', () => {
    const message = kit.messageLine(() => {});
    message.set('passing', true);
    message.reset({ lastingOnly: true });
    expect(message.text).toBe('passing');
    message.reset();
    expect(message.text).toBe(null);
    message.set('lasting');
    message.reset({ lastingOnly: true });
    expect(message.text).toBe(null);
  });
});

describe('wireDeviceState()', () => {
  function setup(opts: object = {}, ids: string[] = ['a', 'b c']) {
    const handlers: Record<string, (data: any) => void> = {};
    const Homey = {
      api: vi.fn(async () => [{ id: 'a' }]),
      on: vi.fn((event: string, fn: (data: any) => void) => { handlers[event] = fn; }),
      getDeviceIds: () => ids,
    };
    const link = { ready: vi.fn(async () => {}), perfParam: vi.fn(() => '&perf=1') };
    const widget = { t: (key: string) => key, setState: vi.fn(), setMessage: vi.fn(), pushChange: vi.fn() };
    const devices = kit.wireDeviceState(Homey, link, widget, opts);
    return { Homey, link, widget, handlers, devices };
  }

  it('reads /state with the devices now and every 5 min, and passes on their realtime changes', async () => {
    const onState = vi.fn();
    const { Homey, link, widget, handlers, devices } = setup({ event: 'x:state', query: () => '&open=lock', onState });
    await vi.advanceTimersByTimeAsync(0);
    expect(Homey.api).toHaveBeenCalledWith('GET', '/state?deviceIds=a,b%20c&open=lock&perf=1');
    expect(widget.setState).toHaveBeenCalledWith([{ id: 'a' }]);
    expect(onState).toHaveBeenCalledWith([{ id: 'a' }]);
    expect(link.ready).toHaveBeenCalledWith({ fonts: true });
    expect(devices.ids()).toEqual(['a', 'b c']);
    expect(devices.loaded()).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60e3);
    expect(Homey.api).toHaveBeenCalledTimes(2);
    handlers['x:state']({ deviceId: 'a', capabilityId: 'onoff', value: true });
    handlers['x:state']({ deviceId: 'z', capabilityId: 'onoff', value: true });
    expect(widget.pushChange).toHaveBeenCalledTimes(1);
  });

  it('reads through the tile names when given, and `watches` adds devices to the realtime filter', async () => {
    const tileNames = { state: vi.fn(async () => []) };
    const { Homey, widget, handlers } = setup({ event: 'x:state', tileNames, watches: (id: string) => id === 'member' });
    await vi.advanceTimersByTimeAsync(0);
    expect(tileNames.state).toHaveBeenCalledWith('/state?deviceIds=a,b%20c&perf=1');
    expect(Homey.api).not.toHaveBeenCalled();
    handlers['x:state']({ deviceId: 'member' });
    expect(widget.pushChange).toHaveBeenCalledTimes(1);
  });

  it('`setState` takes an answer the widget wants in another shape', async () => {
    const setState = vi.fn();
    const onState = vi.fn();
    const { widget } = setup({ setState, onState });
    await vi.advanceTimersByTimeAsync(0);
    expect(setState).toHaveBeenCalledWith([{ id: 'a' }]);
    expect(widget.setState).not.toHaveBeenCalled();
    expect(onState).toHaveBeenCalledWith([{ id: 'a' }]);
  });

  it('says what to pick without devices, or what `need()` says is missing', async () => {
    const none = setup({}, []);
    const columns = setup({ need: () => 'selectColumns' });
    await vi.advanceTimersByTimeAsync(0);
    expect(none.widget.setMessage).toHaveBeenCalledWith('selectDevices');
    expect(columns.widget.setMessage).toHaveBeenCalledWith('selectColumns');
    expect(none.Homey.api).not.toHaveBeenCalled();
    expect(columns.Homey.api).not.toHaveBeenCalled();
    expect(none.link.ready).toHaveBeenCalled();
  });

  it('a failed first load replaces the tiles; a failed refresh keeps them with a passing message', async () => {
    const { Homey, widget } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Homey.api.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    expect(widget.setMessage).toHaveBeenLastCalledWith('error', false);
    await vi.advanceTimersByTimeAsync(5 * 60e3);
    expect(widget.setState).toHaveBeenCalledTimes(1);
    Homey.api.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(5 * 60e3);
    expect(widget.setMessage).toHaveBeenLastCalledWith('error', true);
  });
});
