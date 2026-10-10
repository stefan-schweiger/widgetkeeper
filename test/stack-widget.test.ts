// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => {
  win = loadWidget('stack');
  loadMount('stack');
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const page = (id: string, type: string, extra: object = {}) => ({ id, type, title: null, settings: {}, deviceIds: [], ...extra });

describe('stackAttention', () => {
  const att = (p: any, s: any) => win.stackAttention(p, s);

  it('media: while the speaker plays', () => {
    expect(att(page('m', 'media'), { playing: true })).toBe(true);
    expect(att(page('m', 'media'), { playing: false })).toBe(false);
  });

  it('timers: while the page has a timer (running, paused or done)', () => {
    expect(att(page('t', 'timers'), { timers: [{ id: 'a' }] })).toBe(true);
    expect(att(page('t', 'timers'), { timers: [] })).toBe(false);
  });

  it('cameras: someone or something detected, not other alarms', () => {
    const p = page('c', 'cameras');
    expect(att(p, { alarms: { cam: { alarm_person: { value: true, state: true } } } })).toBe(true);
    expect(att(p, { alarms: { cam: { 'alarm_motion.zone2': { value: true, state: true } } } })).toBe(true);
    expect(att(p, { alarms: { cam: { alarm_tamper: { value: true, state: false } } } })).toBe(false);
  });

  it('sensor alarms: as the widget counts them (motion and contact only with includeStates)', () => {
    const alarms = { d: { alarm_motion: { value: true, state: true }, alarm_smoke: { value: false, state: false } } };
    expect(att(page('s', 'sensoralarms'), { alarms })).toBe(false);
    expect(att(page('s', 'sensoralarms', { settings: { includeStates: true } }), { alarms })).toBe(true);
    expect(att(page('s', 'sensoralarms'), { alarms: { d: { alarm_smoke: { value: true, state: false } } } })).toBe(true);
  });

  it("locks: something open or unlocked, not a value that hasn't reported", () => {
    expect(att(page('l', 'locks'), { locks: { d: { locked: false } } })).toBe(true);
    expect(att(page('l', 'locks'), { locks: { d: { alarm_contact: true } } })).toBe(true);
    expect(att(page('l', 'locks'), { locks: { d: { garagedoor_closed: false } } })).toBe(true);
    expect(att(page('l', 'locks'), { locks: { d: { locked: true, alarm_contact: false, garagedoor_closed: null } } })).toBe(false);
  });

  it('other widgets never ask', () => {
    expect(att(page('v', 'values'), { playing: true })).toBe(false);
  });
});

describe('attention watcher', () => {
  function watch(pages: any[], answers: Record<string, any>) {
    const handlers = new Map<string, (d: any) => void>();
    const call = vi.fn(async (type: string, _m: string, path: string, query: any) => answers[`${type} ${path} ${JSON.stringify(query)}`]);
    const onChange = vi.fn();
    const w = win.createStackAttentionWatcher(pages, { call, on: (e: string, fn: any) => handlers.set(e, fn), onChange });
    return { w, call, onChange, emit: (e: string, d: any) => handlers.get(e)!(d) };
  }

  it('reads each page once at the start, then follows the events', async () => {
    const pages = [
      page('pm', 'media', { settings: { device: { id: 'spk' } } }),
      page('pt', 'timers'),
      page('pc', 'cameras', { deviceIds: ['cam1', 'cam2'] }),
      page('pl', 'locks', { deviceIds: ['door'] }),
      page('pv', 'values'),
    ];
    const { w, call, onChange, emit } = watch(pages, {
      'media /state {"deviceId":"spk"}': { caps: { speaker_playing: { value: false } } },
      'timers /state {"instance":"pt"}': { timers: [] },
      'sensoralarms /state {"deviceIds":"cam1,cam2"}': [{ id: 'cam1', alarms: [{ capabilityId: 'alarm_person', value: false, state: true }] }, { id: 'cam2', missing: true }],
      'locks /state {"deviceIds":"door"}': { devices: [{ id: 'door', caps: { locked: { value: false } } }] },
    });
    await w.refresh();
    expect(call).toHaveBeenCalledTimes(4);
    expect(onChange.mock.calls).toEqual([['pm', false], ['pt', false], ['pc', false], ['pl', true]]);

    emit('media:state', { deviceId: 'spk', capabilityId: 'speaker_playing', value: true });
    emit('media:state', { deviceId: 'other', capabilityId: 'speaker_playing', value: false });
    emit('timers:state', { instance: 'pt', timers: [{ id: 'x' }] });
    emit('sensoralarms:state', { deviceId: 'cam1', capabilityId: 'alarm_person', value: true });
    emit('locks:state', { deviceId: 'door', capabilityId: 'locked', value: true });
    expect(onChange.mock.calls.slice(4)).toEqual([['pm', true], ['pt', true], ['pc', true], ['pl', false]]);
    expect(w.attention('pm')).toBe(true);
  });

  it("an alarm the last read didn't have counts as Sensor Alarms would (motion only with includeStates)", async () => {
    const { w, onChange, emit } = watch([page('ps', 'sensoralarms', { deviceIds: ['hall'] })], {
      'sensoralarms /state {"deviceIds":"hall"}': [{ id: 'hall', alarms: [] }],
    });
    await w.refresh();
    emit('sensoralarms:state', { deviceId: 'hall', capabilityId: 'alarm_motion', value: true });
    expect(w.attention('ps')).toBe(false);
    emit('sensoralarms:state', { deviceId: 'hall', capabilityId: 'alarm_water', value: true });
    expect(onChange.mock.calls).toEqual([['ps', false], ['ps', true]]);
  });

  it("follows the speaker this screen switched to", async () => {
    const handlers = new Map<string, (d: any) => void>();
    const call = vi.fn(async () => ({ caps: { speaker_playing: { value: true } } }));
    const onChange = vi.fn();
    const w = win.createStackAttentionWatcher([page('pm', 'media', { settings: { device: { id: 'spk' } } })], {
      call, on: (e: string, fn: any) => handlers.set(e, fn), onChange, speakerOf: () => 'tv',
    });
    await w.refresh();
    expect(call).toHaveBeenCalledWith('media', 'GET', '/state', { deviceId: 'tv' });
    handlers.get('media:state')!({ deviceId: 'tv', capabilityId: 'speaker_playing', value: false });
    expect(onChange.mock.calls).toEqual([['pm', true], ['pm', false]]);
  });
});

describe('rotation', () => {
  function stack(opts: object = {}, n = 3) {
    const root = document.createElement('div');
    document.body.append(root);
    const onVisible = vi.fn();
    const w = win.createStackWidget(root, { intervalMs: 30e3, resumeAfterMs: 60e3, onVisible, ...opts });
    const pages = Array.from({ length: n }, (_, i) => page(`p${i}`, ['timers', 'media', 'cameras', 'values'][i]));
    const slides = w.setPages(pages);
    const id = () => w.current()?.id;
    return { w, root, slides, id, onVisible };
  }

  it('builds a slide per page with its widget frame classes, and dots', () => {
    const { root, slides } = stack();
    expect(slides).toHaveLength(3);
    expect(slides[0].frame.className).toContain('sk-slide');
    expect(root.querySelectorAll('.sk-dot')).toHaveLength(3);
    expect(root.querySelector('.sk-dot.on')).toBe(root.querySelectorAll('.sk-dot')[0]);
  });

  it('moves to the next page every interval, round', () => {
    const { id } = stack();
    expect(id()).toBe('p0');
    vi.advanceTimersByTime(30e3);
    expect(id()).toBe('p1');
    vi.advanceTimersByTime(60e3);
    expect(id()).toBe('p0');
  });

  it("doesn't rotate with 'never'", () => {
    const { id } = stack({ intervalMs: 0 });
    vi.advanceTimersByTime(10 * 60e3);
    expect(id()).toBe('p0');
  });

  it('tells each page whether it shows', () => {
    const { onVisible } = stack();
    expect(onVisible.mock.calls.map(([p, v]: any) => [p.id, v])).toEqual([['p0', true], ['p1', false], ['p2', false]]);
    vi.advanceTimersByTime(30e3);
    expect(onVisible.mock.calls.slice(3).map(([p, v]: any) => [p.id, v])).toEqual([['p0', false], ['p1', true]]);
  });

  it('a move by hand holds the stack still for a while', () => {
    const { w, id } = stack();
    w.go(2);
    vi.advanceTimersByTime(59e3);
    expect(id()).toBe('p2');
    vi.advanceTimersByTime(2e3); // then on to the next
    expect(id()).toBe('p0');
  });

  it('a dot goes to its page', () => {
    const { root, id } = stack();
    (root.querySelectorAll('.sk-dot')[1] as HTMLElement).click();
    expect(id()).toBe('p1');
  });

  it('a page that wants attention comes forward and stays while it does', () => {
    const { w, id } = stack();
    w.setAttention('p2', true);
    expect(id()).toBe('p2');
    vi.advanceTimersByTime(5 * 60e3);
    expect(id()).toBe('p2');
    w.setAttention('p2', false);
    vi.advanceTimersByTime(30e3);
    expect(id()).toBe('p0');
  });

  it('with several, the newest first, then they take turns', () => {
    const { w, id } = stack();
    w.setAttention('p1', true);
    vi.advanceTimersByTime(1000);
    w.setAttention('p2', true);
    expect(id()).toBe('p2');
    vi.advanceTimersByTime(30e3);
    expect(id()).toBe('p1');
    vi.advanceTimersByTime(30e3);
    expect(id()).toBe('p2');
  });

  it("a page the user left only comes back when it starts again", () => {
    const { w, id } = stack();
    w.setAttention('p1', true);
    expect(id()).toBe('p1');
    w.go(0);
    vi.advanceTimersByTime(2 * 60e3);
    expect(id()).not.toBe('p1');
    w.setAttention('p1', false);
    vi.advanceTimersByTime(1000); // no longer held still by the move
    w.setAttention('p1', true);
    expect(id()).toBe('p1');
  });

  it('waits for a pause by hand to end before attention moves it', () => {
    const { w, id } = stack();
    w.go(0);
    w.setAttention('p2', true);
    expect(id()).toBe('p0');
    vi.advanceTimersByTime(61e3);
    expect(id()).toBe('p2');
  });

  it('a Flow request wins over attention and a pause, until it runs out', () => {
    const { w, id } = stack();
    w.setAttention('p1', true);
    w.go(0);
    w.request('cameras', Date.now() + 2 * 60e3);
    expect(id()).toBe('p2');
    vi.advanceTimersByTime(90e3);
    expect(id()).toBe('p2');
    vi.advanceTimersByTime(31e3);
    expect(id()).not.toBe('p2');
  });

  it("a refresh doesn't move the stack while the user holds it, unless it brings a new Flow request", () => {
    const { w, id } = stack();
    w.go(0); // the user holds the stack still …
    w.setAttention('p2', true); // … so p2 waits (it isn't dismissed: it never showed)
    expect(id()).toBe('p0');
    w.setRequests([]); // the 5-minute refresh
    expect(id()).toBe('p0');
    w.setRequests([{ type: 'media', until: Date.now() + 60e3 }]);
    expect(id()).toBe('p1');
    w.setRequests([{ type: 'media', until: Date.now() + 60e3 }]); // the same one again: nothing new
    w.go(0);
    w.setRequests([{ type: 'media', until: Date.now() + 60e3 }]);
    expect(id()).toBe('p0');
  });

  it("a request that runs out while the user holds the stack stops marking its dot", () => {
    const { w, root } = stack();
    w.request('cameras', Date.now() + 60e3);
    w.go(0);
    expect(root.querySelectorAll('.sk-dot')[2].classList.contains('alert')).toBe(true);
    vi.advanceTimersByTime(61e3);
    expect(root.querySelectorAll('.sk-dot')[2].classList.contains('alert')).toBe(false);
  });

  it('resume ends the requests', () => {
    const { w, id } = stack({ intervalMs: 0 });
    w.request('media', Date.now() + 60e3);
    expect(id()).toBe('p1');
    w.resume();
    w.setAttention('p2', true);
    expect(id()).toBe('p2');
  });

  it('smart rotate off ignores attention but not Flows', () => {
    const { w, id } = stack({ smart: false });
    w.setAttention('p2', true);
    expect(id()).toBe('p0');
    w.request('media', Date.now() + 60e3);
    expect(id()).toBe('p1');
  });

  it('puts the dots above and makes them large when asked', () => {
    const { root } = stack({ dotsPosition: 'above', dotsSize: 'large' });
    expect(root.classList.contains('dots-above')).toBe(true);
    expect(root.classList.contains('dots-large')).toBe(true);
    const plain = stack().root;
    expect(plain.classList.contains('dots-above')).toBe(false);
    expect(plain.classList.contains('dots-large')).toBe(false);
  });

  it('hides the dots for one page or when turned off', () => {
    expect(stack({}, 1).root.classList.contains('no-dots')).toBe(true);
    expect(stack({ showDots: false }).root.classList.contains('no-dots')).toBe(true);
    expect(stack().root.classList.contains('no-dots')).toBe(false);
  });
});

describe('mount', () => {
  beforeAll(() => {
    loadWidget('timers'); loadMount('timers');
    loadWidget('values'); loadMount('values');
  });

  function fakeHomey(settings: object, pagesAnswer: any, calls: Record<string, any> = {}) {
    const handlers = new Map<string, ((d: any) => void)[]>();
    const api = vi.fn(async (method: string, path: string, body?: any) => {
      if (path.startsWith('/pages')) return pagesAnswer;
      if (path === '/call') {
        const key = `${body.type} ${body.method} ${body.path}`;
        if (key in calls) return typeof calls[key] === 'function' ? calls[key](body) : calls[key];
        throw new Error(`unexpected ${key}`);
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    return {
      handlers,
      api,
      on: (e: string, fn: any) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: (e: string, d: any) => (handlers.get(e) || []).forEach(fn => fn(d)),
      ready: vi.fn(),
      setHeight: vi.fn(),
      getSettings: () => settings,
      __: (key: string) => key,
      hapticFeedback: vi.fn(),
    };
  }

  function mount(Homey: any) {
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    document.body.append(frame);
    win.mountStackWidget(Homey, { root, frame });
    return root;
  }

  it('asks for a dashboard first', async () => {
    const Homey = fakeHomey({}, null);
    const root = mount(Homey);
    await vi.advanceTimersByTimeAsync(3000);
    expect(root.querySelector('.sk-message')!.textContent).toBe('selectDashboard'); // the key: this Homey stand-in has no strings
    expect(Homey.ready).toHaveBeenCalledTimes(1);
  });

  it("treats the autocomplete's API key item as no dashboard", async () => {
    const Homey = fakeHomey({ dashboard: { id: 'none' } }, null);
    const root = mount(Homey);
    await vi.advanceTimersByTimeAsync(3000);
    expect(root.querySelector('.sk-message')!.textContent).toBe('selectDashboard');
  });

  it('says what the API key needs', async () => {
    const Homey = fakeHomey({ dashboard: { id: 'd' } }, { ok: false, reason: 'keyScope' });
    const root = mount(Homey);
    await vi.advanceTimersByTimeAsync(3000);
    expect(root.querySelector('.sk-message')!.textContent).toBe('keyScope');
  });

  it("mounts each page's widget with its own settings, devices and instance, through /call", async () => {
    const timersState = { instance: 'w-timers', timers: [], now: Date.now() };
    const Homey = fakeHomey({ dashboard: { id: 'd' }, interval: '15' }, {
      ok: true,
      pages: [
        page('w-timers', 'timers', { settings: { minutes1: 3, minutes2: 0, minutes3: 0, minutes4: 0 } }),
        page('w-values', 'values', { settings: { slot1: { id: 'dev:measure_temperature' } } }),
      ],
      requests: [],
    }, {
      'timers GET /state': timersState,
      'values GET /state': [{ deviceId: 'dev', capabilityId: 'measure_temperature', name: 'Fridge', capability: { title: 'Temperature', type: 'number', units: '°C', decimals: 1 }, value: 4.2 }],
    });
    const root = mount(Homey);
    await vi.advanceTimersByTimeAsync(3000);

    const slides = root.querySelectorAll<HTMLElement>('.sk-slide');
    expect(slides).toHaveLength(2);
    expect(slides[0].className).toContain('homey-widget-full');
    expect(slides[0].className).not.toContain('sk-card'); // transparent: no card behind it
    expect(slides[0].querySelector('.tm-preset')).not.toBeNull();
    expect(slides[1].textContent).toContain('Fridge');

    const bodies = Homey.api.mock.calls.filter(c => c[1] === '/call').map(c => c[2]);
    // The Timers page asks for its own instance (the dashboard widget's id), and the smart-rotate watcher too.
    expect(bodies.filter(b => b.type === 'timers').every(b => b.query.instance === 'w-timers')).toBe(true);
    expect(bodies.find(b => b.type === 'values').query.slots).toBe('dev:measure_temperature');
    // A page's first request has perf= (its load marks), but those are the stack frame's: left out.
    expect(bodies.some(b => 'perf' in b.query)).toBe(false);
    expect(Homey.ready).toHaveBeenCalledTimes(1);

    // A started timer brings its page forward; before that, the stack rotates every 15 s.
    vi.advanceTimersByTime(15e3);
    expect(root.querySelector('.sk-dot.on')).toBe(root.querySelectorAll('.sk-dot')[1]);
    Homey.emit('timers:state', { instance: 'w-timers', timers: [{ id: 't', label: '', duration: 60e3, endsAt: Date.now() + 60e3, remaining: null, doneAt: null }], now: Date.now() });
    expect(root.querySelector('.sk-dot.on')).toBe(root.querySelectorAll('.sk-dot')[0]);
  });

  it("is ready as soon as the page on screen has drawn, even when a request moved it there", async () => {
    const Homey = fakeHomey({ dashboard: { id: 'd' } }, {
      ok: true,
      pages: [page('w-values', 'values', { settings: {} }), page('w-timers', 'timers', { settings: {} })],
      requests: [{ type: 'timers', until: Date.now() + 60e3 }],
      now: Date.now(),
    }, {
      'timers GET /state': { instance: 'w-timers', timers: [], now: Date.now() },
    });
    const root = mount(Homey);
    await vi.advanceTimersByTimeAsync(200);
    expect(root.querySelector('.sk-dot.on')).toBe(root.querySelectorAll('.sk-dot')[1]);
    expect(Homey.ready).toHaveBeenCalledTimes(1);
  });

  it("moves a Flow request's end into this screen's time", async () => {
    const Homey = fakeHomey({ dashboard: { id: 'd' }, interval: 'never' }, {
      ok: true,
      pages: [page('w-values', 'values', { settings: {} }), page('w-timers', 'timers', { settings: {} })],
      requests: [],
    }, {
      'timers GET /state': { instance: 'w-timers', timers: [], now: Date.now() },
    });
    const root = mount(Homey);
    await vi.advanceTimersByTimeAsync(3000);
    // The Homey's clock is 3 minutes ahead of this screen's: 2 minutes from its now is still 2 minutes here.
    const homeyNow = Date.now() + 3 * 60e3;
    Homey.emit('stack:show', { type: 'timers', until: homeyNow + 2 * 60e3, now: homeyNow });
    expect(root.querySelector('.sk-dot.on')).toBe(root.querySelectorAll('.sk-dot')[1]);
    vi.advanceTimersByTime(119e3);
    expect(root.querySelectorAll('.sk-dot')[1].classList.contains('alert')).toBe(true);
    vi.advanceTimersByTime(2e3);
    expect(root.querySelectorAll('.sk-dot')[1].classList.contains('alert')).toBe(false);
  });

  it('a Flow request from realtime brings its page forward', async () => {
    const Homey = fakeHomey({ dashboard: { id: 'd' } }, {
      ok: true,
      pages: [page('w-values', 'values', { settings: {} }), page('w-timers', 'timers', { settings: {} })],
      requests: [],
    }, {
      'timers GET /state': { instance: 'w-timers', timers: [], now: Date.now() },
    });
    const root = mount(Homey);
    await vi.advanceTimersByTimeAsync(3000);
    Homey.emit('stack:show', { type: 'timers', until: Date.now() + 60e3 });
    expect(root.querySelector('.sk-dot.on')).toBe(root.querySelectorAll('.sk-dot')[1]);
  });
});
