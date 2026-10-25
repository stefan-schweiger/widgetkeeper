// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFile } from './helpers/loadWidget.js';

// The kit's taps, message line and device loop (widgets/spacer/public/kit.js), which the widgets used to copy.
runFile('widgets/spacer/public/kit.js');
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

  describe('hold', () => {
    const mouse = (node: Element, type: string) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    const key = (node: Element, type: string, k = 'Enter', repeat = false) => {
      const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: k, repeat });
      node.dispatchEvent(e);
      return e;
    };
    function held(when = () => true) {
      const node = document.createElement('button');
      const fn = vi.fn();
      const hold = { ms: 600, when, act: vi.fn(), start: vi.fn(), done: vi.fn() };
      kit.onTap(node, fn, { keys: false, hold });
      return { node, fn, hold };
    }

    it('a touch held still acts once; the touch and click after it are no tap', () => {
      const { node, fn, hold } = held();
      touch(node, 'touchstart', 5, 5);
      expect(node.classList.contains('holding')).toBe(true);
      expect(hold.start).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(599);
      expect(hold.act).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hold.act).toHaveBeenCalledOnce();
      expect(node.classList.contains('holding')).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(hold.done).not.toHaveBeenCalled(); // the finger is still down: Homey's haptic would throw
      touch(node, 'touchend', 5, 5);
      expect(hold.done).not.toHaveBeenCalled(); // a tick later, once Homey has seen the touch end
      vi.advanceTimersByTime(0);
      expect(hold.done).toHaveBeenCalledOnce();
      node.click();
      expect(fn).not.toHaveBeenCalled();
    });

    it('let go sooner, a touch is a tap; a drag or a cancel is neither', () => {
      const { node, fn, hold } = held();
      touch(node, 'touchstart', 5, 5);
      vi.advanceTimersByTime(300);
      touch(node, 'touchend', 5, 5);
      expect(fn).toHaveBeenCalledOnce();
      touch(node, 'touchstart', 0, 0);
      touch(node, 'touchmove', 0, 11);
      expect(node.classList.contains('holding')).toBe(false);
      touch(node, 'touchstart', 0, 0);
      touch(node, 'touchcancel', 0, 0);
      vi.advanceTimersByTime(1000);
      expect(hold.act).not.toHaveBeenCalled();
      expect(hold.done).not.toHaveBeenCalled();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('the mouse: a click is a tap, a held button acts and its click is skipped', () => {
      const { node, fn, hold } = held();
      node.click();
      expect(fn).toHaveBeenCalledOnce();
      mouse(node, 'mousedown');
      vi.advanceTimersByTime(300);
      mouse(node, 'mouseup');
      node.click();
      expect(fn).toHaveBeenCalledTimes(2);
      mouse(node, 'mousedown');
      vi.advanceTimersByTime(600);
      mouse(node, 'mouseup');
      node.click();
      expect(hold.act).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledTimes(2);
      mouse(node, 'mousedown');
      mouse(node, 'mouseleave');
      vi.advanceTimersByTime(1000);
      expect(hold.act).toHaveBeenCalledOnce();
      expect(hold.done).not.toHaveBeenCalled(); // no touch, no haptic
    });

    it('the mouse right after a touch is the browser’s, not a hold', () => {
      const { node, hold } = held();
      touch(node, 'touchstart', 0, 0);
      touch(node, 'touchmove', 0, 20);
      touch(node, 'touchend', 0, 20);
      mouse(node, 'mousedown');
      vi.advanceTimersByTime(1000);
      expect(hold.act).not.toHaveBeenCalled();
    });

    it('Enter and Space hold too, keeping back their click; a short press is a tap', () => {
      const { node, fn, hold } = held();
      expect(key(node, 'keydown').defaultPrevented).toBe(true);
      key(node, 'keydown', 'Enter', true);
      vi.advanceTimersByTime(600);
      expect(hold.act).toHaveBeenCalledOnce();
      expect(key(node, 'keyup').defaultPrevented).toBe(true);
      expect(fn).not.toHaveBeenCalled();
      key(node, 'keydown', ' ');
      expect(key(node, 'keyup', ' ').defaultPrevented).toBe(true);
      expect(fn).toHaveBeenCalledOnce();
    });

    it('while when() says no, it is a plain tap: the button clicks on its keys itself', () => {
      const { node, fn, hold } = held(() => false);
      touch(node, 'touchstart', 5, 5);
      expect(node.classList.contains('holding')).toBe(false);
      vi.advanceTimersByTime(1000);
      touch(node, 'touchend', 5, 5);
      expect(fn).toHaveBeenCalledOnce();
      expect(key(node, 'keydown').defaultPrevented).toBe(false);
      const menu = new Event('contextmenu', { cancelable: true });
      node.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(false);
      expect(hold.act).not.toHaveBeenCalled();
      expect(hold.start).not.toHaveBeenCalled();
    });

    it('prevents the long-press menu', () => {
      const { node } = held();
      const menu = new Event('contextmenu', { cancelable: true });
      node.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(true);
    });
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

describe('undoTextZoom()', () => {
  /** A WebView that zooms all text by `zoom` (Android's font scale), with Homey's tokens on the body. */
  function zoomed(zoom: number) {
    document.body.style.setProperty('--homey-font-size-default', 'calc(1.1 * 17px)');
    document.body.style.setProperty('--homey-line-height-default', '24px');
    const real = window.getComputedStyle.bind(window);
    return vi.spyOn(window, 'getComputedStyle').mockImplementation((node: Element) => {
      const style = real(node);
      if ((node as HTMLElement).style?.fontSize === '100px') return { ...style, fontSize: `${100 * zoom}px` } as CSSStyleDeclaration;
      return style;
    });
  }
  afterEach(() => { vi.restoreAllMocks(); document.body.removeAttribute('style'); });

  it("divides Homey's text tokens by the WebView's zoom, so token text is zoomed once like native text", () => {
    zoomed(1.1);
    kit.undoTextZoom();
    expect(document.body.style.getPropertyValue('--homey-font-size-default')).toBe('calc((calc(1.1 * 17px)) / 1.1)');
    expect(document.body.style.getPropertyValue('--homey-line-height-default')).toBe('calc((24px) / 1.1)');
    expect(document.body.style.getPropertyValue('--homey-font-size-small')).toBe(''); // a token Homey didn't set stays unset
    expect(document.body.querySelector('span')).toBeNull(); // the probe is gone
  });

  it('leaves the tokens alone without a zoom (iOS, a browser)', () => {
    zoomed(1.005);
    kit.undoTextZoom();
    expect(document.body.style.getPropertyValue('--homey-font-size-default')).toBe('calc(1.1 * 17px)');
  });
});

describe('wireFrame()', () => {
  function setup() {
    const Homey = { ready: vi.fn(), setHeight: vi.fn() };
    const frame = document.createElement('div');
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ height: 99.2 } as DOMRect);
    return { Homey, link: kit.wireFrame(Homey, frame) };
  }

  it('is ready once, after what it waits for, at most maxMs; the height goes on only once ready', async () => {
    const { Homey, link } = setup();
    link.setHeight();
    expect(Homey.setHeight).not.toHaveBeenCalled();
    const before = vi.fn();
    void link.ready({ waitFor: () => [new Promise(() => {})], maxMs: 500, before });
    void link.ready();
    await vi.advanceTimersByTimeAsync(499);
    expect(Homey.ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(before).toHaveBeenCalledTimes(1);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    expect(Homey.ready).toHaveBeenCalledWith({ height: 100 });
    link.setHeight();
    expect(Homey.setHeight).toHaveBeenCalledWith(100);
  });

  it('is ready as soon as what it waits for is', async () => {
    const { Homey, link } = setup();
    let done!: () => void;
    void link.ready({ waitFor: () => [new Promise<void>((r) => { done = r; })], maxMs: 5000 });
    await vi.advanceTimersByTimeAsync(10);
    done();
    await vi.advanceTimersByTimeAsync(0);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
  });

  it('sends the load marks on the first request only', () => {
    const { link } = setup();
    expect(link.perfParam('?')).toMatch(/^\?perf=\d+,-?\d+,\d+,\d+$/);
    expect(link.perfParam()).toBe('');
  });
});

describe('getDeviceIds() and wireTileNames()', () => {
  it('always gives a list of devices', async () => {
    await expect(kit.getDeviceIds({ getDeviceIds: () => ['a'] })).resolves.toEqual(['a']);
    await expect(kit.getDeviceIds({ getDeviceIds: async () => ['b'] })).resolves.toEqual(['b']);
    await expect(kit.getDeviceIds({ getDeviceIds: async () => { throw new Error('no'); } })).resolves.toEqual([]);
    await expect(kit.getDeviceIds({ getDeviceIds: () => 'a' })).resolves.toEqual([]);
    await expect(kit.getDeviceIds({})).resolves.toEqual([]);
  });

  it("keeps a widget's names under `default` when its instance can't be read", async () => {
    for (const getWidgetInstanceId of [() => { throw new Error('no'); }, async () => { throw new Error('no'); }, () => '', undefined]) {
      const Homey = { api: vi.fn(async () => ({ state: 1, tileNames: { a: 'A' } })), on: vi.fn(), getWidgetInstanceId };
      const setNames = vi.fn();
      const tileNames = kit.wireTileNames(Homey, setNames);
      await expect(tileNames.state('/state?ids=a')).resolves.toBe(1);
      expect(Homey.api).toHaveBeenCalledWith('GET', '/state?ids=a&instance=default');
      expect(setNames).toHaveBeenCalledWith({ a: 'A' });
      await tileNames.rename('a', 'B');
      expect(Homey.api).toHaveBeenLastCalledWith('POST', '/names', { instance: 'default', key: 'a', name: 'B' });
    }
  });

  it("takes only its own instance's realtime names, and a /state without them as it is", async () => {
    const handlers: Record<string, (data: any) => void> = {};
    const Homey = { api: vi.fn(async () => [1, 2]), on: (event: string, fn: any) => { handlers[event] = fn; }, getWidgetInstanceId: () => 'w1' };
    const setNames = vi.fn();
    const tileNames = kit.wireTileNames(Homey, setNames);
    await expect(tileNames.state('/state?ids=a')).resolves.toEqual([1, 2]); // an app without tile names
    handlers['tilenames:state']({ instance: 'w2', names: { a: 'X' } });
    handlers['tilenames:state']({ instance: 'w1', names: { a: 'Y' } });
    expect(setNames.mock.calls).toEqual([[{ a: 'Y' }]]);
  });
});

describe('formatSince()', () => {
  it('says the time today, the weekday and time this week, else the date', () => {
    const now = new Date(2026, 9, 24, 15, 0).getTime();
    const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
    expect(kit.formatSince(at(24, 9, 5), now, 'en', 'en-GB', '24')).toBe('9:05');
    expect(kit.formatSince(at(23, 21, 30), now, 'en', 'en-GB', '24')).toBe('Fri 21:30');
    expect(kit.formatSince(at(18, 8), now, 'en', 'en-GB', '24')).toBe('Sun 8:00');
    expect(kit.formatSince(at(17, 23, 59), now, 'en', 'en-GB', '24')).toBe('Oct 17');
    expect(kit.formatSince(at(17, 23, 59), now, 'da', 'da-DK', '24')).toBe('17. okt.');
    // A language Intl doesn't know falls back to the screen's, without throwing.
    expect(() => kit.formatSince(at(17, 23), now, 'not a tag!', 'en-GB', '24')).not.toThrow();
  });
});
