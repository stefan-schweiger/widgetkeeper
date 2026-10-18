import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import CameraService, { cameraImage, cameraVideos, h265Videos } from '../lib/CameraService.js';

vi.mock('homey-api', () => homeyApiMock);

// As the Reolink app reports them (verified on the real Homey, 2026-10-04).
const image = (id: string, type = 'camera') => ({
  type, id: 'snapshot', title: 'Snapshot',
  imageObj: { id, ownerUri: 'homey:app:com.reolink', url: `/api/image/${id}`, lastUpdated: 1790672723645 },
});
const video = (id: string, videoId: string, codec = 'h264', title = `Camera (${id} - ${codec})`) => ({
  type: 'camera', id, title,
  videoObj: { id: videoId, ownerUri: 'homey:app:com.reolink', type: 'rtsp', options: {} },
});
const camera = (id: string, name: string, extra: object) => Object.assign(fakeDevice({ id, name, caps: {} }), extra);

const kitchen = () => camera('kitchen', 'E1 Kitchen', { images: [image('img-k')], videos: [video('main', 'vid-km', 'h265'), video('sub', 'vid-ks')] });
const terrace = () => camera('terrace', 'C4 Terrace', { images: [], videos: [] });

function setup(devices = [kitchen(), terrace()]) {
  const api = Object.assign(fakeApi({ devices }), {
    baseUrl: 'http://homey',
    videos: {
      videoOffer: vi.fn(async ({ id }: { id: string }) => ({ answerSdp: `answer for ${id}`, streamId: `video_${id}` })),
      videoKeepAlive: vi.fn(async () => undefined),
    },
  });
  const homey = fakeHomey(api);
  return { api, homey, service: new CameraService(homey, () => {}) };
}

function stubFetch(type = 'image/jpeg') {
  const fetch = vi.fn(async (_url: string) => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': type } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('state', () => {
  it('keeps a camera whose read fails because Homey is busy, and drops a deleted one', async () => {
    const { api, service } = setup();
    const [first] = await service.getState(['kitchen']);
    expect('missing' in first).toBe(false);
    api.devices.getDevice.mockRejectedValueOnce(Object.assign(new Error('Too many requests.'), { statusCode: 429 }));
    expect(await service.getState(['kitchen'])).toEqual([first]);
    api.devices.getDevice.mockRejectedValueOnce(new Error('Not Found'));
    expect(await service.getState(['kitchen'])).toEqual([{ id: 'kitchen', missing: true }]);
  });
});

describe('cameraImage / cameraVideos', () => {
  it('picks the camera image, else any image', () => {
    expect(cameraImage({ images: [image('art', 'media'), image('snap')] })).toEqual({ id: 'snap', url: '/api/image/snap', lastUpdated: 1790672723645 });
    expect(cameraImage({ images: [image('art', 'media')] })?.id).toBe('art');
    expect(cameraImage({ images: [] })).toBeNull();
    expect(cameraImage({})).toBeNull();
  });

  it('prefers the sub stream, then one that isn\'t H.265', () => {
    expect(cameraVideos({ videos: [video('main', 'm'), video('sub', 's')] })[0]).toBe('s');
    expect(cameraVideos({ videos: [video('main', 'm', 'h265'), video('other', 'o')] })[0]).toBe('o');
    expect(cameraVideos({ videos: [video('main', 'm', 'h265')] })[0]).toBe('m');
    expect(cameraVideos({ videos: [] })).toEqual([]);
  });

  it('lists every stream, best first, so live view can fall back', () => {
    expect(cameraVideos({ videos: [video('main', 'm', 'h265'), video('sub', 's')] })).toEqual(['s', 'm']);
    // A stream that says H.264 before one that says nothing, H.265 last; otherwise the app's order.
    expect(cameraVideos({ videos: [
      video('a', 'a', 'h265'), video('b', 'b', '', 'Lens 2'), video('c', 'c', 'h264'), video('d', 'd', '', 'Lens 1'),
    ] })).toEqual(['c', 'b', 'd', 'a']);
    // A single stream (a camera on a Reolink Home Hub or NVR) is still tried.
    expect(cameraVideos({ videos: [video('main', 'm', 'h265')] })).toEqual(['m']);
    expect(cameraVideos({ videos: [{ id: 'x', title: 'No object' }] })).toEqual([]);
    expect(cameraVideos({})).toEqual([]);
  });

  it('names the H.265 streams', () => {
    expect(h265Videos({ videos: [video('main', 'm', 'h265'), video('sub', 's'), video('x', 'x', 'HEVC')] })).toEqual(['m', 'x']);
    expect(h265Videos({})).toEqual([]);
  });
});

describe('getState', () => {
  it('returns the cameras in the order asked, with missing ones marked', async () => {
    const { service } = setup();
    expect(await service.getState(['terrace', 'nope', 'kitchen'])).toEqual([
      { id: 'terrace', name: 'C4 Terrace', icon: null, image: null, video: null, videos: [], h265: [] },
      { id: 'nope', missing: true },
      { id: 'kitchen', name: 'E1 Kitchen', icon: null, image: { id: 'img-k', url: '/api/image/img-k', lastUpdated: 1790672723645 }, video: 'vid-ks', videos: ['vid-ks', 'vid-km'], h265: ['vid-km'] },
    ]);
  });
});

describe('idle cameras', () => {
  it('forgets a camera no request has asked for in 10 minutes', async () => {
    const { service } = setup();
    await service.getState(['kitchen']);
    expect((service as any).last.has('kitchen')).toBe(true);
    expect((service as any).imageUrls.has('kitchen')).toBe(true);
    vi.advanceTimersByTime(11 * 60e3);
    await service.getState(['terrace']);
    expect((service as any).last.has('kitchen')).toBe(false);
    expect((service as any).imageUrls.has('kitchen')).toBe(false);
    expect((service as any).last.has('terrace')).toBe(true);
  });
});

describe('getSnapshot', () => {
  it('fetches the image from Homey as base64', async () => {
    const fetch = stubFetch();
    const { service } = setup();
    expect(await service.getSnapshot('kitchen')).toEqual({ type: 'image/jpeg', data: 'AQID' });
    expect(fetch).toHaveBeenCalledWith('http://homey/api/image/img-k');
  });

  it('shares one fetch within 2 s, then fetches again', async () => {
    const fetch = stubFetch();
    const { service } = setup();
    await Promise.all([service.getSnapshot('kitchen'), service.getSnapshot('kitchen')]);
    await service.getSnapshot('kitchen');
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2100);
    await service.getSnapshot('kitchen');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails for a camera without an image, or a response that isn\'t one', async () => {
    stubFetch('application/json');
    const { service } = setup();
    await expect(service.getSnapshot('terrace')).rejects.toThrow('No camera image');
    await expect(service.getSnapshot('kitchen')).rejects.toThrow('Snapshot is application/json');
  });
});

describe('live view', () => {
  it('passes the offer to Homey and returns its answer and stream id', async () => {
    const { service, api } = setup();
    expect(await service.offer('vid-ks', 'v=0 offer')).toEqual({ answer: 'answer for vid-ks', streamId: 'video_vid-ks' });
    expect(api.videos.videoOffer).toHaveBeenCalledWith({ id: 'vid-ks', offer: 'v=0 offer' });
    await service.keepAlive('vid-ks', 'video_vid-ks');
    expect(api.videos.videoKeepAlive).toHaveBeenCalledWith({ id: 'vid-ks', streamId: 'video_vid-ks' });
  });

  it('fails without an answer', async () => {
    const { service, api } = setup();
    api.videos.videoOffer.mockResolvedValueOnce({} as any);
    await expect(service.offer('vid-ks', 'v=0')).rejects.toThrow('No answer from Homey');
  });
});
