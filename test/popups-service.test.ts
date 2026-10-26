import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import PopupService, {
  MAX_ASK_SECONDS, POPUP_CLOSE_EVENT, POPUP_NAMES_SETTING, POPUP_SHOW_EVENT, screenKey,
} from '../lib/PopupService.js';

vi.mock('homey-api', () => homeyApiMock);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  const homey = fakeHomey(fakeApi({}));
  const cameras = { getSnapshot: vi.fn(async (id: string) => ({ type: 'image/jpeg', data: `snap-${id}` })) };
  const web = {
    list: () => [{ id: 'kitchen', name: 'Kitchen', columns: [[]] }],
    dashboardList: (q: string) => [{ id: 'kitchen', name: 'Kitchen', description: '0' }].filter(d => !q || d.name.toLowerCase().includes(q.toLowerCase())),
  };
  const log = vi.fn();
  const service = new PopupService(homey, { cameras: cameras as any, web: web as any }, log);
  const events = (name: string) => homey.api.realtime.mock.calls.filter((c: any[]) => c[0] === name).map((c: any[]) => c[1]);
  return { homey, service, cameras, log, events };
}

/** An image tag as a Flow hands it over: `getStream()` gives a readable of the bytes with their type. */
function imageTag(bytes: Buffer, contentType = 'image/jpeg') {
  return {
    getStream: async () => Object.assign((async function* () { yield bytes.subarray(0, 2); yield bytes.subarray(2); })(), { contentType }),
  };
}

describe('screenKey', () => {
  it('trims and lower-cases, with Screen for no name', () => {
    expect(screenKey(' Kitchen ')).toBe('kitchen');
    expect(screenKey('')).toBe('screen');
    expect(screenKey(undefined)).toBe('screen');
    expect(screenKey('__proto__')).toBe('');
  });
});

describe('show (a message)', () => {
  it('sends it to the screens with its end, lists it, and closes it when the time is up', async () => {
    const { service, events } = setup();
    await service.show({ target: { id: 'all' }, text: '  Dinner is ready ', seconds: 10 });
    const [shown] = events(POPUP_SHOW_EVENT);
    expect(shown).toMatchObject({ target: 'all', kind: 'message', text: 'Dinner is ready', picture: null, until: Date.now() + 10e3, now: Date.now() });
    expect(service.all().popups.map(p => p.id)).toEqual([shown.id]);
    // The token answers it through the public routes, so only a Popups widget's /state (its own screen's) has it.
    expect(shown).not.toHaveProperty('token');
    expect(service.all().popups[0]).not.toHaveProperty('token');
    expect(service.forScreen('Hall').popups[0].token).toMatch(/^[0-9a-f]{32}$/);
    await vi.advanceTimersByTimeAsync(10e3);
    expect(events(POPUP_CLOSE_EVENT)).toEqual([{ id: shown.id, answer: null, button: null, reason: 'expired' }]);
    expect(service.all().popups).toEqual([]);
  });

  it('needs a text or a picture, and keeps at most 20 open (the oldest closes)', async () => {
    const { service, events } = setup();
    await expect(service.show({ target: 'all', text: ' ', seconds: 5 })).rejects.toThrow(/Nothing to show/);
    for (let i = 0; i < 21; i++) await service.show({ target: 'all', text: `n${i}`, seconds: 60 });
    expect(service.all().popups).toHaveLength(20);
    expect(service.all().popups[0].text).toBe('n1');
    expect(events(POPUP_CLOSE_EVENT)[0]).toMatchObject({ reason: 'replaced' });
  });

  it('cuts the text at 500 characters and the time at a day', async () => {
    const { service, events } = setup();
    await service.show({ target: 'all', text: 'x'.repeat(600), seconds: 999999 });
    const [shown] = events(POPUP_SHOW_EVENT);
    expect(shown.text).toHaveLength(500);
    expect(shown.until - Date.now()).toBe(24 * 3600e3);
  });

  it("isn't answered: a message has no answer", async () => {
    const { service, events } = setup();
    await service.show({ target: 'all', text: 'Hi', seconds: 5 });
    const [shown] = events(POPUP_SHOW_EVENT);
    expect(shown.buttons).toBeNull();
    expect(service.answerFromSession(shown.id, true)).toEqual({ ok: false, reason: 'notAsk', answer: null, button: null });
  });
});

describe('ask (a question with one or two buttons)', () => {
  it('waits for the first answer, which closes it everywhere; later answers hear what it was', async () => {
    const { service, events } = setup();
    const asked = service.ask({ target: 'all', text: 'Open the garage?', seconds: 30 });
    await vi.advanceTimersByTimeAsync(0);
    const [shown] = events(POPUP_SHOW_EVENT);
    expect(shown.kind).toBe('ask');
    // No buttons given (a card saved before it had them): Yes and No.
    expect(shown.buttons).toEqual(['Yes', 'No']);
    expect(service.answerFromSession(shown.id, true)).toEqual({ ok: true, answer: true, button: 'Yes' });
    await expect(asked).resolves.toEqual({ answer: true, answered: true, button: 'Yes' });
    expect(service.answerFromSession(shown.id, false)).toEqual({ ok: false, reason: 'closed', answer: true, button: 'Yes' });
    expect(events(POPUP_CLOSE_EVENT)).toEqual([{ id: shown.id, answer: true, button: 'Yes', reason: 'answered' }]);
  });

  it("shows the Flow's buttons in its order, trimmed and cut at 30 characters; empty ones are left out", async () => {
    const { service, events } = setup();
    const ask = (buttons: unknown[]) => service.ask({ target: 'all', text: 'Q?', seconds: 30, buttons });
    ask([' Open ', 'Ignore']);
    ask(['', undefined]);
    ask(['Got it', '']);
    ask([undefined, ' Later ']);
    ask(['x'.repeat(40), 7]);
    await vi.advanceTimersByTimeAsync(0);
    expect(events(POPUP_SHOW_EVENT).map((e: any) => e.buttons)).toEqual([
      ['Open', 'Ignore'], ['Yes', 'No'], ['Got it'], ['Later'], ['x'.repeat(30)],
    ]);
  });

  it('answers with the second button, and takes no second answer when it has one button', async () => {
    const { service, events } = setup();
    const two = service.ask({ target: 'all', text: 'Visitor', seconds: 30, buttons: ['Open', 'Ignore'] });
    const one = service.ask({ target: 'all', text: 'Done', seconds: 30, buttons: ['Got it'] });
    await vi.advanceTimersByTimeAsync(0);
    const [a, b] = events(POPUP_SHOW_EVENT);
    expect(service.answerFromSession(a.id, false)).toEqual({ ok: true, answer: false, button: 'Ignore' });
    await expect(two).resolves.toEqual({ answer: false, answered: true, button: 'Ignore' });
    expect(() => service.answerFromSession(b.id, false)).toThrow('No such button');
    expect(service.all().popups.map(p => p.id)).toEqual([b.id]);
    expect(service.answerFromSession(b.id, true)).toEqual({ ok: true, answer: true, button: 'Got it' });
    await expect(one).resolves.toEqual({ answer: true, answered: true, button: 'Got it' });
  });

  it('ends unanswered at its time, which is at most MAX_ASK_SECONDS', async () => {
    const { service, events } = setup();
    const asked = service.ask({ target: 'all', text: 'Still there?', seconds: 9999 });
    await vi.advanceTimersByTimeAsync(0);
    expect(events(POPUP_SHOW_EVENT)[0].until - Date.now()).toBe(MAX_ASK_SECONDS * 1000);
    await vi.advanceTimersByTimeAsync(MAX_ASK_SECONDS * 1000);
    await expect(asked).resolves.toEqual({ answer: false, answered: false, button: '' });
  });

  it('ends unanswered when closed by a Flow or when the app stops', async () => {
    const { service } = setup();
    const a = service.ask({ target: 'name:Hall', text: 'A?', seconds: 30 });
    const b = service.ask({ target: 'all', text: 'B?', seconds: 30 });
    await vi.advanceTimersByTimeAsync(0);
    service.close({ id: 'name:hall' });
    await expect(a).resolves.toEqual({ answer: false, answered: false, button: '' });
    expect(service.all().popups.map(p => p.text)).toEqual(['B?']);
    service.stop();
    await expect(b).resolves.toEqual({ answer: false, answered: false, button: '' });
  });
});

describe('screens', () => {
  it('sends to everywhere, a web dashboard (which must exist) or a screen name', async () => {
    const { service, events } = setup();
    await service.show({ target: { id: 'web:kitchen' }, text: 'a', seconds: 5 });
    await service.show({ target: { id: 'name: Hall ' }, text: 'b', seconds: 5 });
    await service.show({ target: undefined, text: 'c', seconds: 5 });
    expect(events(POPUP_SHOW_EVENT).map((e: any) => e.target)).toEqual(['web:kitchen', 'name:hall', 'all']);
    await expect(service.show({ target: { id: 'web:gone' }, text: 'd', seconds: 5 })).rejects.toThrow('Dashboard not found');
  });

  it("gives a Popups widget its own and everywhere's popups, and remembers its name for the cards", async () => {
    const { service, homey } = setup();
    await service.show({ target: 'name:hall', text: 'hall', seconds: 60 });
    await service.show({ target: 'name:kitchen', text: 'kitchen', seconds: 60 });
    await service.show({ target: 'all', text: 'all', seconds: 60 });
    await service.show({ target: 'web:kitchen', text: 'web', seconds: 60 });
    const state = service.forScreen(' Hall ');
    expect(state.popups.map(p => p.text)).toEqual(['hall', 'all']);
    expect(state.now).toBe(Date.now());
    await vi.advanceTimersByTimeAsync(5000);
    expect(homey.settings.get(POPUP_NAMES_SETTING)).toEqual({ hall: { name: 'Hall', seenAt: Date.now() - 5000 } });
    const items = service.targetItems('');
    // No web dashboards: one is reached through its Popups widget's name (a `web:` chosen earlier still works).
    expect(items.map(i => i.id)).toEqual(['all', 'name:Hall', 'name:Screen']);
    expect(service.targetItems('Garage').map(i => [i.id, i.description])).toEqual([['name:Garage', 'New screen name']]);
  });

  it("lists the screen names of the web dashboards' Popups widgets too", () => {
    const homey = fakeHomey(fakeApi({}));
    const w = (type: string, settings: object) => ({ id: type, type, title: '', settings, deviceIds: [] });
    const web = {
      list: () => [{ id: 'hall', name: 'Hall tablet', columns: [[w('clock', {})], [w('popups', { name: ' Wall tablet ' }), w('popups', {})]] }],
      dashboardList: () => [],
    };
    const service = new PopupService(homey, { cameras: {} as any, web: web as any }, vi.fn());
    expect(service.targetItems('').map(i => i.id)).toEqual(['all', 'name:Screen', 'name:Wall tablet']);
  });

  it("doesn't rewrite a name it saw within the day", async () => {
    const { service, homey } = setup();
    service.forScreen('Hall');
    await vi.advanceTimersByTimeAsync(5000);
    homey.settings.set.mockClear();
    service.forScreen('Hall');
    await vi.advanceTimersByTimeAsync(5000);
    expect(homey.settings.set).not.toHaveBeenCalled();
  });
});

describe('the prompt page (public, by token)', () => {
  it('reads and answers a popup only with its token, and says how it ended', async () => {
    const { service } = setup();
    const asked = service.ask({ target: 'all', text: 'Q?', seconds: 30, buttons: ['Open', 'Ignore'] });
    await vi.advanceTimersByTimeAsync(0);
    const { id, token } = service.forScreen('').popups[0];
    expect(() => service.page(id, 'wrong')).toThrow('Not found');
    expect(() => service.page(id, undefined)).toThrow('Not found');
    expect(() => service.answerWithToken(id, true, 'wrong')).toThrow('Not found');
    // Leaving the token out is no way past it.
    expect(() => service.answerWithToken(id, true, undefined)).toThrow('Not found');
    expect(() => service.answerWithToken('gone', true, undefined)).toThrow('Not found');
    expect(service.page(id, token)).toMatchObject({ closed: false, kind: 'ask', text: 'Q?', buttons: ['Open', 'Ignore'], picture: null });
    expect(service.answerWithToken(id, false, token)).toEqual({ ok: true, answer: false, button: 'Ignore' });
    await expect(asked).resolves.toEqual({ answer: false, answered: true, button: 'Ignore' });
    expect(service.page(id, token)).toMatchObject({ closed: true, kind: 'ask', answer: false, button: 'Ignore', reason: 'answered' });
    expect(() => service.page(id, 'wrong')).toThrow('Not found');
    expect(service.answerWithToken(id, true, token)).toEqual({ ok: false, reason: 'closed', answer: false, button: 'Ignore' });
  });
});

describe('pictures', () => {
  it('keeps an image tag as it was when the Flow ran', async () => {
    const { service, events } = setup();
    await service.show({ target: 'all', text: '', seconds: 5, picture: PopupService.droptokenArg(imageTag(Buffer.from('jpeg!'), 'image/png')) });
    const { id, picture } = events(POPUP_SHOW_EVENT)[0];
    const { token } = service.forScreen('').popups[0];
    expect(picture).toEqual({ source: 'stored' });
    await expect(service.imageFromSession(id)).resolves.toEqual({ type: 'image/png', data: Buffer.from('jpeg!').toString('base64') });
    await expect(service.imageWithToken(id, token)).resolves.toMatchObject({ type: 'image/png' });
    await expect(service.imageWithToken(id, 'wrong')).rejects.toThrow('Not found');
    await expect(service.imageWithToken(id, undefined)).rejects.toThrow('Not found');
  });

  it('keeps at most 16 MB of stored pictures open: the oldest with one close', async () => {
    const { service, events } = setup();
    const tag = () => PopupService.droptokenArg(imageTag(Buffer.alloc(3 * 1024 * 1024))); // 4 MB in base64
    await service.show({ target: 'all', text: 'camera', seconds: 600, picture: { camera: 'cam' } });
    for (let i = 0; i < 4; i++) await service.show({ target: 'all', text: `p${i}`, seconds: 600, picture: tag() });
    expect(service.describe().pictureSize).toBe(16 * 1024 * 1024);
    expect(events(POPUP_CLOSE_EVENT)).toEqual([]);
    await service.show({ target: 'all', text: 'p4', seconds: 600, picture: tag() });
    expect(events(POPUP_CLOSE_EVENT)).toEqual([expect.objectContaining({ reason: 'replaced' })]);
    expect(service.all().popups.map(p => p.text)).toEqual(['camera', 'p1', 'p2', 'p3', 'p4']); // a camera's is read when asked
    expect(service.describe().pictureSize).toBe(16 * 1024 * 1024);
  });

  it('refuses an image tag over 3 MB', async () => {
    const { service } = setup();
    const big = imageTag(Buffer.alloc(3 * 1024 * 1024 + 1));
    await expect(service.show({ target: 'all', text: 'x', seconds: 5, picture: { image: big } })).rejects.toThrow('larger than 3 MB');
  });

  it('reads a camera again on every request', async () => {
    const { service, events, cameras } = setup();
    await service.show({ target: 'all', text: 'Door', seconds: 5, picture: PopupService.pictureArg({ id: 'camera:cam1' }) });
    const { id, picture } = events(POPUP_SHOW_EVENT)[0];
    expect(picture).toEqual({ source: 'camera' });
    await service.imageFromSession(id);
    await expect(service.imageFromSession(id)).resolves.toEqual({ type: 'image/jpeg', data: 'snap-cam1' });
    expect(cameras.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('fetches a picture address once, and only an image', async () => {
    const { service, events } = setup();
    const fetch = vi.fn(async (url: URL) => (String(url).endsWith('.png')
      ? new Response(Buffer.from('png'), { headers: { 'content-type': 'image/png' } })
      : new Response('<html>', { headers: { 'content-type': 'text/html' } })));
    vi.stubGlobal('fetch', fetch);
    await service.show({ target: 'all', text: 'Radar', seconds: 5, picture: PopupService.pictureArg({ id: 'url:http://example.test/radar.png' }) });
    const { id } = events(POPUP_SHOW_EVENT)[0];
    await expect(service.imageFromSession(id)).resolves.toEqual({ type: 'image/png', data: Buffer.from('png').toString('base64') });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(service.show({ target: 'all', text: 'x', seconds: 5, picture: { url: 'http://example.test/page' } })).rejects.toThrow('(text/html)');
    await expect(service.show({ target: 'all', text: 'x', seconds: 5, picture: { url: 'file:///etc/passwd' } })).rejects.toThrow('Not a picture address');
    await expect(service.show({ target: 'all', text: 'x', seconds: 5, picture: PopupService.droptokenArg(' nonsense ') })).rejects.toThrow('Not a picture address');
  });

  it('stops reading an address past 3 MB, whatever its Content-Length says', async () => {
    const { service } = setup();
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(chunk); }, // never ends
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'image/jpeg', 'content-length': '10' } })));
    await expect(service.show({ target: 'all', text: 'x', seconds: 5, picture: { url: 'http://example.test/big.jpg' } })).rejects.toThrow('larger than 3 MB');
    expect(pulled).toBeLessThan(8);
  });

  it('reads the picture argument and the droptoken', () => {
    expect(PopupService.pictureArg({ id: 'none' })).toBeNull();
    expect(PopupService.pictureArg(undefined)).toBeNull();
    expect(PopupService.pictureArg({ id: 'camera:c1' })).toEqual({ camera: 'c1' });
    expect(PopupService.pictureArg({ id: 'url:https://a.test/x.jpg' })).toEqual({ url: 'https://a.test/x.jpg' });
    expect(PopupService.droptokenArg(null)).toBeNull();
    expect(PopupService.droptokenArg(' https://a.test/x.jpg ')).toEqual({ url: 'https://a.test/x.jpg' });
  });

  it('keeps the sound chosen, none for no sound or a card saved before it had one', async () => {
    expect(PopupService.soundArg('doorbell')).toBe('doorbell');
    expect(PopupService.soundArg('none')).toBeNull();
    expect(PopupService.soundArg(undefined)).toBeNull();
    expect(PopupService.soundArg('constructor')).toBeNull();
    const { service, homey } = setup();
    await service.show({ target: 'all', text: 'Dinner', seconds: 5, sound: 'chime' });
    await service.show({ target: 'all', text: 'Quiet', seconds: 5 });
    expect(service.all().popups.map(p => p.sound)).toEqual(['chime', null]);
    const [loud] = service.forScreen('').popups;
    expect(service.page(loud.id, loud.token)).toMatchObject({ closed: false, sound: 'chime' });
    expect(homey.api.realtime).toHaveBeenCalledWith(POPUP_SHOW_EVENT, expect.objectContaining({ text: 'Dinner', sound: 'chime' }));
  });

  it('lists no picture, the address typed, or the cameras', async () => {
    const { service } = setup();
    expect((await service.pictureItems('https://a.test/x.jpg')).map(i => i.id)).toEqual(['none', 'url:https://a.test/x.jpg']);
    expect((await service.pictureItems('')).map(i => i.id)).toEqual(['none']);
  });
});

describe('describe', () => {
  it('never holds the texts, addresses or tokens', async () => {
    const { service } = setup();
    await service.show({ target: 'name:hall', text: 'Secret text', seconds: 30 });
    service.forScreen('Hall');
    const report = JSON.stringify(service.describe());
    expect(report).not.toContain('Secret');
    expect(service.describe()).toEqual({ open: [{ kind: 'message', target: 'name', picture: null, sound: null, secondsLeft: 30 }], recentlyClosed: [], screens: ['Hall'], pictureSize: 0 });
  });
});
