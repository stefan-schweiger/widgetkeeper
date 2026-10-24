// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  it('is blank, but has a real height (iOS kept its loading placeholder over 0 or 1 px)', () => {
    const win = loadWidget('popups');
    const root = document.createElement('div');
    win.createPopupsWidget(root, { name: ' Hallway ', page: PAGE, open: vi.fn(), storage: memoryStorage() });
    expect(root.querySelector('.pu-blank')).not.toBeNull();
    expect(root.textContent).toBe('');
    expect(root.querySelector('svg')).toBeNull();
    expect(readFileSync('widgets/popups/public/widget.css', 'utf8')).toMatch(/\.pu-blank \{ min-height: 32px; \}/);
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
    // The strings only on the first call.
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ t: 'secret', strings: true });
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

describe("sounds (the kit's `sound`)", () => {
  /** A Web Audio stand-in that records the notes started; `state` as the browser would set it. */
  function fakeAudio(state: string, resumeAfter = 0) {
    const notes: number[] = [];
    class FakeContext {
      state = state;
      currentTime = 0;
      destination = {};
      resume = vi.fn(() => new Promise<void>((done) => { setTimeout(() => { this.state = 'running'; done(); }, resumeAfter); }));
      createOscillator() {
        const osc = { type: '', frequency: { value: 0 }, connect: (g: any) => g, start: () => notes.push(osc.frequency.value), stop: () => {} };
        return osc;
      }
      createGain() {
        return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (d: any) => d };
      }
    }
    (window as any).AudioContext = FakeContext;
    new Function(readFileSync('widgets/spacer/public/kit.js', 'utf8'))();
    return { notes, sound: (window as any).WidgetkeeperKit.sound };
  }
  afterEach(() => { delete (window as any).AudioContext; delete (window as any).WidgetkeeperKit; });

  it("has the popup cards' sounds and Timers' beep, and plays one by name", () => {
    const { notes, sound } = fakeAudio('running');
    const card = JSON.parse(readFileSync('.homeycompose/flow/actions/popup_show.json', 'utf8'));
    const ids = card.args.find((a: any) => a.name === 'sound').values.map((v: any) => v.id);
    expect(['beep', ...ids.slice(1)]).toEqual(sound.names);
    expect(ids[0]).toBe('none');
    expect(readFileSync('lib/PopupService.ts', 'utf8')).toContain(`POPUP_SOUNDS = [${ids.slice(1).map((n: string) => `'${n}'`).join(', ')}]`);
    expect(sound.play('doorbell')).toBe(true);
    expect(notes).toEqual([659.25, 523.25]);
    expect(sound.play('none')).toBe(false);
    expect(sound.play('constructor')).toBe(false);
  });

  it('wakes a suspended audio first, and leaves out a sound the browser starts too late', async () => {
    const { notes, sound } = fakeAudio('suspended');
    expect(sound.play('chime')).toBe(true);
    expect(notes).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(notes).toEqual([880, 1318.5]);

    // The browser only lets the audio start a second later (on the next tap, say): that sound is left out.
    const late = fakeAudio('suspended', 1000);
    expect(late.sound.play('alert')).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(late.notes).toEqual([]);
    late.sound.play('beep');
    expect(late.notes).toEqual([880, 880, 880]);
  });

  it('is the only Web Audio in the widgets and pages', () => {
    const files = [
      ...readdirSync('widgets').flatMap(id => (existsSync(`widgets/${id}/public`) ? readdirSync(`widgets/${id}/public`) : [])
        .filter(f => f.endsWith('.js')).map(f => `widgets/${id}/public/${f}`)),
      ...readdirSync('settings').filter(f => f.endsWith('.js') && f !== 'socket.io.js').map(f => `settings/${f}`),
    ];
    const users = files.filter(f => /AudioContext/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual(['widgets/spacer/public/kit.js']);
    expect(readFileSync('widgets/timers/public/widget.js', 'utf8')).toContain("sound.play('beep')");
  });

  it('plays on the prompt page when the popup opens, not on its polls', async () => {
    const { notes } = fakeAudio('running');
    new Function(readFileSync('settings/popup.js', 'utf8'))();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ closed: false, kind: 'message', text: 'Dinner', picture: null, sound: 'chime', until: Date.now() + 30e3, now: Date.now() })));
    (window as any).mountPopupPage(document.createElement('main'), { fetch, hash: '#id=p1&t=secret' });
    await vi.advanceTimersByTimeAsync(4100);
    expect(fetch.mock.calls.length).toBeGreaterThan(2);
    expect(notes).toEqual([880, 1318.5]);
  });

  it("the prompt page loads the kit, and the web dashboards page plays a popup's sound once", () => {
    expect(readFileSync('settings/popup.html', 'utf8')).toMatch(/<script src="\.\.\/widgets\/spacer\/kit\.js"><\/script>\s*<script src="popup\.js"><\/script>/);
    expect(readFileSync('settings/dashboard.js', 'utf8')).toMatch(/if \(p\.sound && !sounded\.has\(p\.id\)\) \{\s*sounded\.add\(p\.id\);\s*window\.WidgetkeeperKit\.sound\.play\(p\.sound\);/);
  });
});
