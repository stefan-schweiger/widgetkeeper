import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { isTransientError, readFresh } from './DeviceTracker.js';
import { deviceImage, fetchDeviceIcon, fetchImageBase64, type DeviceImage } from './deviceIcon.js';
import Timings from './Timings.js';

/** Several widgets (or a fast refresh) asking for the same snapshot within this share one fetch. */
const IMAGE_REUSE = 2000;
/** A camera no request has asked for in this long is forgotten (open widgets re-fetch every 5 min). */
const IDLE_TIMEOUT = 10 * 60e3;

export type CameraImage = DeviceImage;

export type CameraDevice =
  | {
    id: string, name: string, icon: string | null, image: CameraImage | null,
    /** The best stream (`videos[0]`), kept for callers that only want one. */
    video: string | null,
    /** Every stream, best first: live view tries the next when one won't play. */
    videos: string[],
    /** The streams whose title says H.265, which Homey's WebRTC can't play. */
    h265: string[],
  }
  | { id: string, missing: true };

export type Snapshot = { type: string, data: string };

/**
 * The snapshot to show: the device's first `camera` image, else its first image (`device.images`
 * entries are `{type, id, title, imageObj: {id, url, lastUpdated}}`).
 */
export function cameraImage(device: any): CameraImage | null {
  return deviceImage(device, 'camera', { anyType: true });
}

const H265 = /h\.?265|hevc/i;

/**
 * The videos for live view, best first: `device.videos` entries are `{type, id, title, videoObj: {id, type:
 * 'rtsp'}}`. Homey's go2rtc only offers H.264 over WebRTC, and the Reolink app's `main` stream can be H.265
 * (`Camera (main - h265)`), so the `sub` stream comes first, then streams that say H.264, then any that don't
 * say H.265, and H.265 last (a title can be wrong). The widget tries them in this order until one plays.
 */
export function cameraVideos(device: any): string[] {
  const videos: any[] = (Array.isArray(device?.videos) ? device.videos : []).filter((v: any) => v?.videoObj?.id);
  const rank = (v: any) => {
    const title = String(v.title ?? '');
    if (v.id === 'sub' || /sub/i.test(title)) return H265.test(title) ? 3 : 0;
    if (/h\.?264|avc/i.test(title)) return 1;
    return H265.test(title) ? 4 : 2;
  };
  return videos
    .map((v, i) => ({ v, i, r: rank(v) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => String(x.v.videoObj.id));
}

/** The videos whose title says H.265. */
export function h265Videos(device: any): string[] {
  return (Array.isArray(device?.videos) ? device.videos : [])
    .filter((v: any) => v?.videoObj?.id && H265.test(String(v.title ?? '')))
    .map((v: any) => String(v.videoObj.id));
}

/**
 * Cameras widget: snapshot URLs and live view. Homey serves a device's snapshot at `/api/image/<id>`
 * (the driver makes it on request); the widget loads that directly when it can reach it, or else
 * through `getSnapshot`. Live view goes through Homey's own WebRTC server (go2rtc, `api.videos`):
 * the widget's offer goes in, an answer and a stream id come back, and the stream is kept alive.
 */
export default class CameraService {

  private images = new Map<string, { at: number, promise: Promise<Snapshot> }>();
  /** Each camera's last entry, for a read that fails only because Homey is busy. */
  private last = new Map<string, CameraDevice>();
  /** deviceId → image URL from the last state read, so a snapshot doesn't need a device read. */
  private imageUrls = new Map<string, string>();
  /** When each camera was last asked for, so `last` and `imageUrls` don't keep cameras no widget shows any more. */
  private requested = new Map<string, number>();

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  async stop() {
    this.images.clear();
    this.last.clear();
    this.imageUrls.clear();
    this.requested.clear();
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<CameraDevice[]> {
    const tm = new Timings();
    const api = await tm.time('api', () => getAppApi(this.homey));
    const out = await Promise.all(deviceIds.map(async (id): Promise<CameraDevice> => {
      this.requestedNow(id);
      try {
        const device: any = await tm.time('getDevice', () => readFresh(api.devices, id));
        const image = cameraImage(device);
        const videos = cameraVideos(device);
        if (image) this.imageUrls.set(id, image.url);
        else this.imageUrls.delete(id);
        const entry: CameraDevice = {
          id,
          name: device.name,
          icon: await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)),
          image,
          video: videos[0] ?? null,
          videos,
          h265: h265Videos(device),
        };
        this.last.set(id, entry);
        return entry;
      } catch (err) {
        this.log(`Camera ${id} unavailable:`, err);
        // Homey busy isn't a deleted camera: its last entry, so a live view goes on (as DeviceTracker keeps its entries).
        const last = this.last.get(id);
        if (last && isTransientError(err)) return last;
        this.last.delete(id);
        return { id, missing: true };
      }
    }));
    this.debug(`Cameras state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  /** The device's current snapshot, for a widget that can't load the image URL itself. */
  async getSnapshot(deviceId: string): Promise<Snapshot> {
    this.requestedNow(deviceId);
    let url = this.imageUrls.get(deviceId);
    if (!url) {
      const api = await getAppApi(this.homey);
      const image = cameraImage(await api.devices.getDevice({ id: deviceId, $cache: false }));
      if (!image) throw new Error('No camera image');
      url = image.url;
      this.imageUrls.set(deviceId, url);
    }
    const hit = this.images.get(url);
    if (hit && Date.now() - hit.at < IMAGE_REUSE) return hit.promise;
    const promise = this.fetchImage(url);
    const key = url;
    this.images.set(key, { at: Date.now(), promise });
    // Snapshots can be 2 MB, so none is kept past its reuse window.
    const drop = () => { if (this.images.get(key)?.promise === promise) this.images.delete(key); };
    promise.then(() => this.homey.setTimeout(drop, IMAGE_REUSE), drop);
    return promise;
  }

  /** Starts live view: Homey answers the widget's WebRTC offer (all candidates included, no trickle). */
  async offer(videoId: string, offer: string): Promise<{ answer: string, streamId: string | null }> {
    const api = await getAppApi(this.homey);
    const t0 = Date.now();
    const res: any = await api.videos.videoOffer({ id: videoId, offer });
    if (!res || typeof res.answerSdp !== 'string') throw new Error('No answer from Homey');
    this.debug(`Camera video ${videoId}: answered in ${Date.now() - t0} ms, stream ${res.streamId}`);
    return { answer: res.answerSdp, streamId: typeof res.streamId === 'string' ? res.streamId : null };
  }

  async keepAlive(videoId: string, streamId: string) {
    const api = await getAppApi(this.homey);
    await api.videos.videoKeepAlive({ id: videoId, streamId });
  }

  /** Marks `id` as asked for, and forgets the cameras nothing has asked for in IDLE_TIMEOUT. */
  private requestedNow(id: string) {
    const now = Date.now();
    this.requested.set(id, now);
    for (const [k, at] of this.requested) {
      if (now - at <= IDLE_TIMEOUT) continue;
      this.requested.delete(k);
      this.last.delete(k);
      this.imageUrls.delete(k);
    }
  }

  private async fetchImage(url: string): Promise<Snapshot> {
    const api = await getAppApi(this.homey);
    const t0 = Date.now();
    const snapshot = await fetchImageBase64(api, url, 'Snapshot');
    this.debug(`Camera snapshot ${url}: ${Math.round(snapshot.data.length / 1024)} KB base64 in ${Date.now() - t0} ms`);
    return snapshot;
  }

}
