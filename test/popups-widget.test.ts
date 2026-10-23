// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

const PAGE = 'http://homey.test/app/com.thomassidor.widgetkeeper/settings/popup.html';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}

const popup = (id: string, target: string, until = Date.now() + 30e3) => ({ id, token: `tok-${id}`, target, kind: 'ask', until });

describe('Popups widget', () => {
  it("opens its screen's and everywhere's popups, each once per device", () => {
    const win = loadWidget('popups');
    const storage = memoryStorage();
    const open = vi.fn();
    const widget = win.createPopupsWidget(document.createElement('div'), { name: ' Hall ', page: PAGE, open, storage });
    widget.setState({ now: Date.now(), popups: [popup('a', 'name:hall'), popup('b', 'name:kitchen'), popup('c', 'all'), popup('d', 'web:x')] });
    expect(open.mock.calls.map(c => c[0])).toEqual([`${PAGE}#id=a&t=tok-a`, `${PAGE}#id=c&t=tok-c`]);
    // Again (a refresh, or a second Popups widget on the same device): nothing new opens.
    widget.setState({ now: Date.now(), popups: [popup('a', 'name:hall'), popup('c', 'all')] });
    const other = win.createPopupsWidget(document.createElement('div'), { name: 'hall', page: PAGE, open, storage });
    other.show({ ...popup('a', 'name:hall'), now: Date.now() });
    expect(open).toHaveBeenCalledTimes(2);
    other.show({ ...popup('e', 'name:hall'), now: Date.now() });
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("skips a popup whose time is up, by Homey's clock", () => {
    const win = loadWidget('popups');
    const open = vi.fn();
    const widget = win.createPopupsWidget(document.createElement('div'), { name: '', page: PAGE, open, storage: memoryStorage() });
    // Homey's clock is a minute ahead: a popup ending 30 s after this device's now has already ended there.
    widget.setState({ now: Date.now() + 60e3, popups: [popup('a', 'name:screen', Date.now() + 30e3), popup('b', 'name:screen', Date.now() + 90e3)] });
    expect(open.mock.calls.map(c => c[0])).toEqual([`${PAGE}#id=b&t=tok-b`]);
  });

  function fakeHomey(instance: string, popups: object[] = []) {
    const handlers: Record<string, (data: any) => void> = {};
    return {
      handlers,
      api: vi.fn(async () => ({ now: Date.now(), popups })),
      on: vi.fn((event: string, fn: (data: any) => void) => { handlers[event] = fn; }),
      ready: vi.fn(),
      setHeight: vi.fn(),
      popup: vi.fn(),
      getSettings: () => ({ name: 'Hall' }),
      getWidgetInstanceId: () => instance,
      __: (key: string) => key,
    };
  }

  it('reads /state with the name as typed, opens with Homey.popup() and listens for new ones', async () => {
    loadWidget('popups');
    const win = loadMount('popups');
    const Homey = fakeHomey('w1', [popup('a', 'name:hall')]);
    const root = document.createElement('div');
    document.body.append(root);
    win.mountPopupsWidget(Homey, { root, frame: document.body });
    await vi.advanceTimersByTimeAsync(0);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    expect(Homey.api).toHaveBeenCalledWith('GET', expect.stringMatching(/^\/state\?name=Hall&perf=/));
    expect(Homey.popup).toHaveBeenCalledWith(expect.stringMatching(/\/app\/com\.thomassidor\.widgetkeeper\/settings\/popup\.html#id=a&t=tok-a$/));
    Homey.handlers['popups:show']({ ...popup('b', 'all'), now: Date.now() });
    expect(Homey.popup).toHaveBeenCalledTimes(2);
  });

  it('is never 0 px tall: the iOS app kept showing its loading placeholder for ready({height: 0})', () => {
    expect(readFileSync('widgets/popups/public/widget.css', 'utf8')).toMatch(/#root \{ height: 1px;/);
  });

  it('does nothing on a web dashboard, where the page draws popups itself', async () => {
    loadWidget('popups');
    const win = loadMount('popups');
    const Homey = fakeHomey('web-home-w1', [popup('a', 'all')]);
    win.mountPopupsWidget(Homey, { root: document.createElement('div'), frame: document.body });
    await vi.advanceTimersByTimeAsync(0);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
    expect(Homey.api).not.toHaveBeenCalled();
    expect(Homey.on).not.toHaveBeenCalled();
  });

  it('keys screen names as the service does', () => {
    const win = loadWidget('popups');
    expect(win.popupsScreenKey(' Kitchen ')).toBe('kitchen');
    expect(win.popupsScreenKey('')).toBe('screen');
    const service = readFileSync('lib/PopupService.ts', 'utf8');
    expect(service).toContain("export const DEFAULT_SCREEN = 'Screen';");
  });
});

describe('popup prompt page (settings/popup.js)', () => {
  function load() {
    new Function(readFileSync('settings/popup.js', 'utf8'))();
    return window as any;
  }

  /** The app's public routes, answering from `routes[path]` (a function of the body). */
  function fakeFetch(routes: Record<string, (body: any) => { status?: number, body: unknown }>) {
    return vi.fn(async (url: string, init: any) => {
      const path = url.replace(/^\/api\/app\/[^/]+\/popup\/[^/]+/, '') || '/';
      const route = routes[path];
      const res = route ? route(JSON.parse(init.body)) : { status: 404, body: { error: 'Not found' } };
      return new Response(JSON.stringify(res.body), { status: res.status ?? 200 });
    });
  }

  it("shows the question, answers with the token, and says it's answered", async () => {
    const win = load();
    const sent: any[] = [];
    const fetch = fakeFetch({
      '/': () => ({ body: { closed: false, kind: 'ask', text: 'Open the garage?', picture: null, until: Date.now() + 30e3, now: Date.now(), language: 'da', strings: { yes: 'Ja', no: 'Nej', answeredYes: 'Besvaret: Ja' } } }),
      '/answer': (body) => { sent.push(body); return { body: { ok: true, answer: true } }; },
    });
    const root = document.createElement('main');
    document.body.append(root);
    win.mountPopupPage(root, { fetch, hash: '#id=p1&t=secret' });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.pp-text')!.textContent).toBe('Open the garage?');
    expect(document.documentElement.lang).toBe('da');
    const yes = [...root.querySelectorAll('button')].find(b => b.textContent === 'Ja')!;
    yes.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ t: 'secret', answer: true }]);
    expect(root.querySelector('.pp-result')!.textContent).toBe('Besvaret: Ja');
    expect(fetch.mock.calls[0][0]).toBe('/api/app/com.thomassidor.widgetkeeper/popup/p1');
  });

  it('says when another screen answered first, from its poll', async () => {
    const win = load();
    let closed = false;
    const fetch = fakeFetch({
      '/': () => ({ body: closed
        ? { closed: true, kind: 'ask', answer: false, reason: 'answered', now: Date.now() }
        : { closed: false, kind: 'ask', text: 'Q?', picture: null, until: Date.now() + 30e3, now: Date.now() } }),
    });
    const root = document.createElement('main');
    win.mountPopupPage(root, { fetch, hash: '#id=p1&t=secret' });
    await vi.advanceTimersByTimeAsync(0);
    closed = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(root.querySelector('.pp-result')!.textContent).toBe('Answered on another screen: No');
    expect([...root.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
  });

  it('says a popup is gone without its token, or when the app no longer knows it', async () => {
    const win = load();
    const fetch = fakeFetch({});
    const a = document.createElement('main');
    win.mountPopupPage(a, { fetch, hash: '#id=p1' });
    const b = document.createElement('main');
    win.mountPopupPage(b, { fetch, hash: '#id=p2&t=x' });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.querySelector('.pp-result')!.textContent).toBe('This popup is gone');
    expect(b.querySelector('.pp-result')!.textContent).toBe('This popup is gone');
    expect(fetch).toHaveBeenCalledTimes(1); // no token: not even asked
  });
});
