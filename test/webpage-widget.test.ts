// @vitest-environment happy-dom
// The frames' pages are never fetched.
// @vitest-environment-options {"settings": {"disableIframePageLoading": true}}
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageLocation } from '../widgets/webpage/api.js';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('webpage'); loadMount('webpage'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const HOME = { lat: 52.21, lon: 5.97 };

describe('webPageAddress', () => {
  it('takes http and https addresses, adding https:// when there is no scheme', () => {
    expect(win.webPageAddress('https://example.com/a?b=1')).toEqual({ url: 'https://example.com/a?b=1' });
    expect(win.webPageAddress('  http://192.168.1.5:8080/x ')).toEqual({ url: 'http://192.168.1.5:8080/x' });
    expect(win.webPageAddress('example.com/map')).toEqual({ url: 'https://example.com/map' });
  });

  it('refuses an empty address and any other scheme', () => {
    for (const v of [undefined, null, '', '   ', 42]) expect(win.webPageAddress(v)).toEqual({ error: 'noAddress' });
    for (const v of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://x.org', 'https://']) {
      expect(win.webPageAddress(v)).toEqual({ error: 'badAddress' });
    }
  });

  it("fills {lat} and {lon} in from Homey's location, and needs one for them", () => {
    const raw = 'https://maps.example/gadget/?lat={lat}&lng={lon}&zoom=8&size=3';
    expect(win.webPageAddress(raw, HOME).url).toBe('https://maps.example/gadget/?lat=52.21&lng=5.97&zoom=8&size=3');
    expect(win.webPageAddress(raw, null)).toEqual({ error: 'noLocation' });
    expect(win.webPageAddress(raw, { lat: NaN, lon: 1 })).toEqual({ error: 'noLocation' });
  });
});

describe('webPageBox', () => {
  it('scales a page drawn at its own width to the widget, rounding the height down so it always covers', () => {
    expect(win.webPageBox(300, 550, 512)).toEqual({ width: 550, height: 512, scale: 300 / 550, boxHeight: 279 });
    expect(win.webPageBox(900, 550, 512)).toEqual({ width: 550, height: 512, scale: 900 / 550, boxHeight: 837 });
  });

  it('draws the page at the widget width, unscaled, with page width 0', () => {
    expect(win.webPageBox(300, 0, 320)).toEqual({ width: 300, height: 320, scale: 1, boxHeight: 320 });
    expect(win.webPageBox(900, 0, 320)).toEqual({ width: 900, height: 320, scale: 1, boxHeight: 320 });
  });
});

describe('pageLocation', () => {
  it("is Homey's location to 2 decimals, or none while it isn't set", () => {
    expect(pageLocation(52.2101234, 5.969444)).toEqual({ lat: 52.21, lon: 5.97 });
    expect(pageLocation(0, 0)).toEqual({ noLocation: true });
    expect(pageLocation(undefined, 5)).toEqual({ noLocation: true });
  });
});

describe('Web Page widget', () => {
  function create(opts: object, width = 300) {
    const root = document.createElement('div');
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => width });
    document.body.append(root);
    const onHeight = vi.fn();
    const widget = win.createWebPageWidget(root, { onHeight, ...opts });
    const frames = () => [...root.querySelectorAll<HTMLIFrameElement>('iframe')];
    return { root, widget, onHeight, frames, setWidth: (w: number) => { width = w; } };
  }

  it('draws the page at its width, scaled to the widget, in a box of the scaled height', () => {
    const { root, frames } = create({ url: 'https://example.com', pageWidth: 550, pageHeight: 512 });
    const [f] = frames();
    expect(f.getAttribute('src')).toBe('https://example.com/');
    expect(f.style.width).toBe('550px');
    expect(f.style.height).toBe('512px');
    expect(f.style.transform).toBe(`scale(${300 / 550})`);
    expect(root.querySelector<HTMLElement>('.wp-page')!.style.height).toBe('279px');
  });

  it('never lets the page open links or navigate the dashboard', () => {
    const { frames } = create({ url: 'https://example.com' });
    const sandbox = frames()[0].getAttribute('sandbox')!.split(' ');
    expect(sandbox).toEqual(expect.arrayContaining(['allow-scripts', 'allow-same-origin']));
    expect(sandbox).not.toContain('allow-popups');
    expect(sandbox.some(s => s.startsWith('allow-top-navigation'))).toBe(false);
    expect(frames()[0].getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('puts a layer over the page unless it may be tapped', () => {
    expect(create({ url: 'https://example.com' }).root.querySelector('.wp-shield')).not.toBeNull();
    expect(create({ url: 'https://example.com', interactive: true }).root.querySelector('.wp-shield')).toBeNull();
  });

  it('says what is missing instead of loading', () => {
    const none = create({});
    expect(none.frames()).toHaveLength(0);
    expect(none.root.querySelector('.wp-message')!.textContent).toBe("Type the page's address in the widget settings.");
    const bad = create({ url: 'javascript:alert(1)' });
    expect(bad.frames()).toHaveLength(0);
    expect(bad.root.classList.contains('wp-has-message')).toBe(true);
  });

  it("waits for Homey's location when an address uses it", () => {
    const { widget, frames, root } = create({ url: 'https://x.org/?lat={lat}&lon={lon}' });
    expect(widget.needsLocation).toBe(true);
    expect(frames()).toHaveLength(0);
    widget.setLocation(HOME);
    expect(frames()[0].getAttribute('src')).toBe('https://x.org/?lat=52.21&lon=5.97');
    const missing = create({ url: 'https://x.org/?lat={lat}' });
    missing.widget.setLocation({ noLocation: true });
    expect(missing.root.querySelector('.wp-message')!.textContent).toBe("Set the Homey's location to use {lat} and {lon}.");
    const failed = create({ url: 'https://x.org/?lat={lat}' });
    failed.widget.setLocation(null);
    expect(failed.root.querySelector('.wp-message')!.textContent).toBe("Could not read the Homey's location.");
    expect(root.querySelector('.wp-message')!.textContent).toBe('');
  });

  it('shows buttons only with two or more addresses, lights the one shown and switches on a tap', () => {
    const zoom = (z: number) => `https://x.org/?zoom=${z}`;
    const one = create({ url: zoom(8), buttons: [{ name: 'Land', url: zoom(6) }, { name: 'Empty', url: '  ' }] });
    expect(one.root.querySelectorAll('.wp-btn')).toHaveLength(0);

    const { root, frames, widget } = create({
      url: zoom(8),
      buttons: [{ name: 'Land', url: zoom(6) }, { name: ' Provincie ', url: zoom(8) }, { url: zoom(11) }, { name: 'Bad', url: 'javascript:x' }],
    });
    const btns = [...root.querySelectorAll<HTMLButtonElement>('.wp-btn')];
    expect(btns.map(b => b.textContent)).toEqual(['Land', 'Provincie', 'Button 3']);
    expect(btns.map(b => b.classList.contains('active'))).toEqual([false, true, false]);

    btns[0].click();
    expect(widget.current()).toBe(zoom(6));
    expect(btns.map(b => b.classList.contains('active'))).toEqual([true, false, false]);
    // The new page loads behind the shown one, which goes once it has loaded.
    expect(frames().map(f => f.getAttribute('src'))).toEqual([zoom(6), zoom(8)]);
    frames()[0].dispatchEvent(new Event('load'));
    expect(frames().map(f => f.getAttribute('src'))).toEqual([zoom(6)]);
  });

  it('reloads every few minutes, only while the page is visible', () => {
    const { frames } = create({ url: 'https://example.com', refresh: 15 });
    vi.advanceTimersByTime(15 * 60e3);
    expect(frames()).toHaveLength(2);
    frames()[0].dispatchEvent(new Event('load'));
    expect(frames()).toHaveLength(1);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    vi.advanceTimersByTime(15 * 60e3);
    expect(frames()).toHaveLength(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames()).toHaveLength(2);
    // A page that never says it loaded is replaced anyway.
    vi.advanceTimersByTime(20e3);
    expect(frames()).toHaveLength(1);
  });

  it('never reloads with refresh 0, and keeps settings within range', () => {
    const { frames } = create({ url: 'https://example.com', refresh: 0, pageWidth: -10, pageHeight: '99999' });
    vi.advanceTimersByTime(24 * 60 * 60e3);
    expect(frames()).toHaveLength(1);
    expect(frames()[0].style.width).toBe('300px');
    expect(frames()[0].style.height).toBe('4000px');
  });

  it('mounts with the settings and asks for the location only when an address uses it', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const Homey = {
      getSettings: () => ({ url: 'https://x.org/?lat={lat}&lng={lon}', pageWidth: 550, pageHeight: 512 }),
      api: vi.fn(async () => HOME), ready: vi.fn(), setHeight: vi.fn(), on: vi.fn(), __: (k: string) => k,
    };
    win.mountWebPageWidget(Homey, { root, frame: document.body });
    await vi.advanceTimersByTimeAsync(0);
    expect(Homey.api).toHaveBeenCalledWith('GET', expect.stringMatching(/^\/location\?perf=/));
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('https://x.org/?lat=52.21&lng=5.97');
    expect(Homey.ready).toHaveBeenCalledTimes(1);

    const plain = { ...Homey, api: vi.fn(), ready: vi.fn(), getSettings: () => ({ url: 'https://example.com' }) };
    const root2 = document.createElement('div');
    document.body.append(root2);
    win.mountWebPageWidget(plain, { root: root2, frame: document.body });
    await vi.advanceTimersByTimeAsync(0);
    expect(plain.api).not.toHaveBeenCalled();
    expect(plain.ready).toHaveBeenCalledTimes(1);
  });
});
