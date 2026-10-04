import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import CameraService, { cameraImage, cameraVideo } from '../lib/CameraService.js';

vi.mock('homey-api', () => homeyApiMock);

// As the Reolink app reports them (verified on the real Homey, 2026-10-04).
const image = (id: string, type = 'camera') => ({
  type, id: 'snapshot', title: 'Snapshot',
  imageObj: { id, ownerUri: 'homey:app:com.reolink', url: `/api/image/${id}`, lastUpdated: 1790672723645 },
});
const video = (id: string, videoId: string, codec = 'h264') => ({
  type: 'camera', id, title: `Camera (${id} - ${codec})`,
  videoObj: { id: videoId, ownerUri: 'homey:app:com.reolink', type: 'rtsp', options: {} },
});
const camera = (id: string, name: string, extra: object) => Object.assign(fakeDevice({ id, name, caps: {} }), extra);

const kitchen = () => camera('kitchen', 'E1 Kitchen', { images: [image('img-k')], videos: [video('main', 'vid-km'), video('sub', 'vid-ks')] });
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

describe('cameraImage / cameraVideo', () => {
  it('picks the camera image, else any image', () => {
    expect(cameraImage({ images: [image('art', 'media'), image('snap')] })).toEqual({ id: 'snap', url: '/api/image/snap', lastUpdated: 1790672723645 });
    expect(cameraImage({ images: [image('art', 'media')] })?.id).toBe('art');
    expect(cameraImage({ images: [] })).toBeNull();
    expect(cameraImage({})).toBeNull();
  });

  it('prefers the sub stream, then one that isn\'t H.265', () => {
    expect(cameraVideo({ videos: [video('main', 'm'), video('sub', 's')] })).toBe('s');
    expect(cameraVideo({ videos: [video('main', 'm', 'h265'), video('other', 'o')] })).toBe('o');
    expect(cameraVideo({ videos: [video('main', 'm', 'h265')] })).toBe('m');
    expect(cameraVideo({ videos: [] })).toBeNull();
  });
});

describe('getState', () => {
  it('returns the cameras in the order asked, with missing ones marked', async () => {
    const { service } = setup();
    expect(await service.getState(['terrace', 'nope', 'kitchen'])).toEqual([
      { id: 'terrace', name: 'C4 Terrace', icon: null, image: null, video: null },
      { id: 'nope', missing: true },
      { id: 'kitchen', name: 'E1 Kitchen', icon: null, image: { id: 'img-k', url: '/api/image/img-k', lastUpdated: 1790672723645 }, video: 'vid-ks' },
    ]);
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
