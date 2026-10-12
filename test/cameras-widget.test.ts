// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('cameras'); });
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Images load (or fail, for URLs containing "broken") on the next tick, like a browser's would. */
let loaded: string[] = [];
beforeEach(() => {
  loaded = [];
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(v: string) {
      setTimeout(() => {
        if (v.includes('broken')) this.onerror?.();
        else { loaded.push(v); this.onload?.(); }
      });
    }
  });
});

const cam = (id: string, opts: { image?: string | null, video?: string | null } = {}) => ({
  id, name: `Cam ${id}`, icon: null,
  image: opts.image === null ? null : { id: `img-${id}`, url: opts.image ?? `/api/image/img-${id}`, lastUpdated: 1 },
  video: opts.video === undefined ? `vid-${id}` : opts.video,
});

function widget(devices: any[], api = vi.fn(async (): Promise<any> => ({ type: 'image/jpeg', data: 'AQID' })), now = () => 1000) {
  const root = document.createElement('div');
  document.body.append(root);
  const report = vi.fn();
  const w = win.createCamerasWidget(root, { api, report, now });
  w.setState(devices);
  const tile = (id: string) => root.querySelector<HTMLElement>(`.cw-tile[data-device="${id}"]`)!;
  const tiles = () => [...root.querySelectorAll<HTMLElement>('.cw-tile')];
  return { w, root, tile, tiles, api, report };
}

describe('grid', () => {
  it('shows one tile per camera, in order, with the name', () => {
    const { tiles } = widget([cam('a'), cam('b'), cam('c')]);
    expect(tiles().map(t => t.querySelector('.cw-name')!.textContent)).toEqual(['Cam a', 'Cam b', 'Cam c']);
  });

  it('spans a lone tile and the last of an odd number across the row', () => {
    const wide = (n: number) => widget(Array.from({ length: n }, (_, i) => cam(`c${i}`))).tiles().map(t => t.classList.contains('wide'));
    expect(wide(1)).toEqual([true]);
    expect(wide(2)).toEqual([false, false]);
    expect(wide(3)).toEqual([false, false, true]);
    expect(wide(6)).toEqual([false, false, false, false, false, false]);
  });

  it('marks cameras without a snapshot or video and unavailable ones', () => {
    const { tile } = widget([cam('a', { image: null, video: null }), cam('v', { image: null }), { id: 'gone', missing: true }]);
    expect(tile('a').classList.contains('no-image')).toBe(true);
    expect(tile('a').getAttribute('data-empty')).toBe('No snapshot');
    // A camera with video gets a frame from it instead.
    expect(tile('v').classList.contains('no-image')).toBe(false);
    expect(tile('gone').classList.contains('missing')).toBe(true);
    expect(tile('gone').querySelector('.cw-name')!.textContent).toBe('Unavailable');
  });
});

describe('snapshots', () => {
  it('loads each snapshot from its URL, cache-busted, and swaps it in once loaded', async () => {
    const { w, tile } = widget([cam('a'), cam('b', { image: null })]);
    await w.refresh();
    expect(loaded).toEqual(['/api/image/img-a?t=1000']);
    expect(tile('a').querySelector('img')!.getAttribute('src')).toBe('/api/image/img-a?t=1000');
    expect(tile('a').classList.contains('loaded')).toBe(true);
    expect(w.routeOf('a')).toBe('direct');
  });

  it('moves a camera to the app route when the frame can\'t load its URL', async () => {
    const { w, tile, api, report } = widget([cam('a', { image: '/broken/a' }), cam('b', { image: '/broken/b' })]);
    await w.refresh();
    expect(w.routeOf('a')).toBe('app');
    expect(w.routeOf('b')).toBe('app');
    expect(api).toHaveBeenCalledWith('GET', '/snapshot?deviceId=a', undefined);
    expect(api).toHaveBeenCalledWith('GET', '/snapshot?deviceId=b', undefined);
    expect(tile('b').querySelector('img')!.getAttribute('src')).toBe('data:image/jpeg;base64,AQID');
    expect(report).toHaveBeenCalledTimes(2);
    // Once on the app route, a camera doesn't try its URL again.
    api.mockClear();
    loaded = [];
    await w.refresh();
    expect(loaded).toEqual(['data:image/jpeg;base64,AQID', 'data:image/jpeg;base64,AQID']);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('keeps the other cameras direct when one camera\'s URL fails', async () => {
    const { w, tile, api } = widget([cam('a', { image: '/broken/a' }), cam('b')]);
    await w.refresh();
    expect(w.routeOf('a')).toBe('app');
    expect(w.routeOf('b')).toBe('direct');
    expect(api).not.toHaveBeenCalledWith('GET', '/snapshot?deviceId=b', undefined);
    expect(tile('b').querySelector('img')!.getAttribute('src')).toBe('/api/image/img-b?t=1000');
  });
});

/** A fake RTCPeerConnection; getStats reports `frames` as decoded. */
function stubPeerConnection() {
  const pcs: any[] = [];
  vi.stubGlobal('RTCPeerConnection', class {
    iceGatheringState = 'complete';
    localDescription = { sdp: 'v=0 offer' };
    remote: any = null;
    closed = false;
    frames = 0;
    constructor() { pcs.push(this); }
    addTransceiver() {}
    addEventListener() {}
    removeEventListener() {}
    async createOffer() { return { type: 'offer', sdp: 'v=0 offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription(d: any) { this.remote = d; }
    async getStats() { return new Map([['in', { type: 'inbound-rtp', kind: 'video', framesDecoded: this.frames }]]); }
    close() { this.closed = true; }
  });
  return pcs;
}

/** Canvas drawing: happy-dom has none, so a frame comes out as a fixed data URL. */
function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,FRAME');
}

/** The tile's video starts playing at 1280 × 720. */
function playing(tile: HTMLElement) {
  const video = tile.querySelector('video')!;
  Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true });
  video.dispatchEvent(new Event('playing'));
  return video;
}

const offerApi = () => vi.fn(async (_m: string, path: string): Promise<any> => (path === '/video/offer' ? { answer: 'v=0 answer', streamId: 's1' } : {}));

describe('live view', () => {
  it('ignores taps on a camera without video', () => {
    const { tile, api } = widget([cam('a', { video: null })]);
    tile('a').click();
    expect(tile('a').classList.contains('connecting')).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it('takes a click after a touch tap again with a fixed clock (opts.now)', () => {
    stubPeerConnection();
    const { tile } = widget([cam('a'), cam('b')], offerApi(), () => 1000);
    const touch = (type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as any;
      e.changedTouches = [{ clientX: 10, clientY: 10 }];
      tile('a').dispatchEvent(e);
    };
    touch('touchstart'); touch('touchend');
    expect(tile('a').classList.contains('expanded')).toBe(true);
    // The click right after the touch is the same tap: ignored.
    tile('a').click();
    expect(tile('a').classList.contains('expanded')).toBe(true);
    // A click a second later is a new one, though the widget's own clock stands still.
    vi.setSystemTime(Date.now() + 1000);
    tile('a').click();
    expect(tile('a').classList.contains('expanded')).toBe(false);
  });

  it('sends an offer on a tap and fills the widget, and stops on a second tap', async () => {
    const pcs = stubPeerConnection();
    const api = offerApi();
    const { tile, root } = widget([cam('a'), cam('b')], api);
    const grid = root.querySelector('.cw-grid')!;
    tile('a').click();
    expect(tile('a').classList.contains('connecting')).toBe(true);
    // The live camera covers the whole widget.
    expect(tile('a').classList.contains('expanded')).toBe(true);
    expect(grid.classList.contains('has-expanded')).toBe(true);
    await vi.waitFor(() => expect(pcs[0]?.remote).toEqual({ type: 'answer', sdp: 'v=0 answer' }));
    expect(api).toHaveBeenCalledWith('POST', '/video/offer', { videoId: 'vid-a', offer: 'v=0 offer' });
    tile('a').click();
    expect(pcs[0].closed).toBe(true);
    expect(tile('a').classList.contains('connecting')).toBe(false);
    expect(tile('a').classList.contains('expanded')).toBe(false);
    expect(grid.classList.contains('has-expanded')).toBe(false);
  });

  it('keeps the widget\'s height when a wide last tile goes live', () => {
    stubPeerConnection();
    const { tile, root } = widget([cam('a'), cam('b'), cam('c')], offerApi());
    const grid = root.querySelector<HTMLElement>('.cw-grid')!;
    // At 320 px: the half-width row (90 px), the gap and the wide tile's own row (180 px).
    grid.getBoundingClientRect = () => ({ width: 320, height: 278 } as DOMRect);
    tile('c').click();
    expect(grid.style.minHeight).toBe('278px');
  });

  it('grows a single row to a full-width 16:9 while live', () => {
    stubPeerConnection();
    const { tile, root } = widget([cam('a'), cam('b')], offerApi());
    const grid = root.querySelector<HTMLElement>('.cw-grid')!;
    grid.getBoundingClientRect = () => ({ width: 320, height: 90 } as DOMRect);
    tile('a').click();
    expect(grid.style.minHeight).toBe('180px');
  });

  it('keeps a video-only camera\'s last live frame when live view ends', async () => {
    const pcs = stubPeerConnection();
    stubCanvas();
    const { tile } = widget([cam('a', { image: null })], offerApi());
    tile('a').click();
    await vi.waitFor(() => expect(pcs[0]?.remote).toBeTruthy());
    const video = playing(tile('a'));
    expect(video).toBeTruthy();
    tile('a').click();
    expect(tile('a').querySelector('img')!.getAttribute('src')).toBe('data:image/jpeg;base64,FRAME');
    expect(tile('a').classList.contains('loaded')).toBe(true);
  });

  it('ends live view when the stream stops sending frames', async () => {
    vi.useFakeTimers();
    try {
      const pcs = stubPeerConnection();
      let clock = 1000;
      const { tile, report } = widget([cam('a')], offerApi(), () => clock);
      tile('a').click();
      await vi.waitFor(() => expect(pcs[0]?.remote).toBeTruthy());
      tile('a').querySelector('video')!.dispatchEvent(new Event('playing'));
      expect(tile('a').classList.contains('live')).toBe(true);
      // Frames keep coming for a while...
      for (let i = 0; i < 4; i++) {
        pcs[0].frames += 100;
        clock += 5000;
        await vi.advanceTimersByTimeAsync(5000);
      }
      expect(pcs[0].closed).toBe(false);
      // ...then stop, and 15 s later live view ends.
      for (let i = 0; i < 3; i++) {
        clock += 5000;
        await vi.advanceTimersByTimeAsync(5000);
      }
      expect(pcs[0].closed).toBe(true);
      expect(tile('a').classList.contains('live')).toBe(false);
      expect(report).toHaveBeenCalledWith(expect.stringContaining('no new frame'));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('frame grabs (video, no snapshot)', () => {
  it('grabs a frame from the stream, shows it and closes the stream', async () => {
    const pcs = stubPeerConnection();
    stubCanvas();
    const api = offerApi();
    const { w, tile } = widget([cam('a', { image: null, video: 'vid-a' })], api);
    const done = w.refresh();
    await vi.waitFor(() => expect(pcs[0]?.remote).toEqual({ type: 'answer', sdp: 'v=0 answer' }));
    expect(api).toHaveBeenCalledWith('POST', '/video/offer', { videoId: 'vid-a', offer: 'v=0 offer' });
    playing(tile('a'));
    await done;
    expect(pcs[0].closed).toBe(true);
    expect(tile('a').querySelector('img')!.getAttribute('src')).toBe('data:image/jpeg;base64,FRAME');
    expect(tile('a').classList.contains('loaded')).toBe(true);
    expect(tile('a').classList.contains('live')).toBe(false);
    expect(tile('a').classList.contains('no-image')).toBe(false);
    // Not again within the minute.
    await w.refresh();
    expect(pcs).toHaveLength(1);
  });

  it('grabs again after a minute', async () => {
    const pcs = stubPeerConnection();
    stubCanvas();
    let clock = 1000;
    const { w, tile } = widget([cam('a', { image: null })], offerApi(), () => clock);
    const first = w.refresh();
    await vi.waitFor(() => expect(pcs[0]?.remote).toBeTruthy());
    playing(tile('a'));
    await first;
    clock += 60e3;
    w.refresh();
    await vi.waitFor(() => expect(pcs).toHaveLength(2));
  });

  it('does not grab while a camera is live', async () => {
    const pcs = stubPeerConnection();
    const { w, tile } = widget([cam('a'), cam('b', { image: null })], offerApi());
    tile('a').click();
    await vi.waitFor(() => expect(pcs).toHaveLength(1));
    await w.refresh();
    expect(pcs).toHaveLength(1);
  });

  it('a tap during a grab cancels it and goes live', async () => {
    const pcs = stubPeerConnection();
    const api = offerApi();
    const { w, tile } = widget([cam('a', { image: null })], api);
    const done = w.refresh();
    await vi.waitFor(() => expect(pcs[0]?.remote).toBeTruthy());
    tile('a').click();
    await done;
    expect(pcs[0].closed).toBe(true);
    expect(pcs).toHaveLength(2);
    expect(pcs[1].closed).toBe(false);
    expect(tile('a').classList.contains('connecting')).toBe(true);
  });

  it('reports a failed grab once and says there is no snapshot', async () => {
    stubPeerConnection();
    let clock = 1000;
    const api = vi.fn(async (): Promise<any> => { throw new Error('H.265 not supported'); });
    const { w, tile, report } = widget([cam('a', { image: null })], api, () => clock);
    await w.refresh();
    expect(report).toHaveBeenCalledWith('frame grab of Cam a failed: H.265 not supported');
    expect(tile('a').classList.contains('no-image')).toBe(true);
    expect(tile('a').getAttribute('data-empty')).toBe('No snapshot');
    // Retried after 5 minutes, without a second report.
    clock += 60e3;
    await w.refresh();
    expect(api).toHaveBeenCalledTimes(1);
    clock += 5 * 60e3;
    await w.refresh();
    expect(api).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('sends no offer for a camera with neither snapshot nor video', async () => {
    const pcs = stubPeerConnection();
    const { w, api } = widget([cam('a', { image: null, video: null })], offerApi());
    await w.refresh();
    expect(pcs).toHaveLength(0);
    expect(api).not.toHaveBeenCalled();
  });
});
