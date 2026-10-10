import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { deviceImage, fetchDeviceIcon, fetchImageBase64, type DeviceImage } from './deviceIcon.js';
import Timings from './Timings.js';

/** Several widgets (or a fast refresh) asking for the same snapshot within this share one fetch. */
const IMAGE_REUSE = 2000;

export type CameraImage = DeviceImage;

export type CameraDevice =
  | { id: string, name: string, icon: string | null, image: CameraImage | null, video: string | null }
  | { id: string, missing: true };

export type Snapshot = { type: string, data: string };

/**
 * The snapshot to show: the device's first `camera` image, else its first image (`device.images`
 * entries are `{type, id, title, imageObj: {id, url, lastUpdated}}`).
 */
export function cameraImage(device: any): CameraImage | null {
  return deviceImage(device, 'camera', { anyType: true });
}

/**
 * The video for live view: `device.videos` entries are `{type, id, title, videoObj: {id, type: 'rtsp'}}`.
 * Homey's go2rtc only offers H.264 over WebRTC, and the Reolink app's `main` stream can be H.265, so the
 * `sub` stream comes first, then any stream whose title doesn't say H.265.
 */
export function cameraVideo(device: any): string | null {
  const videos: any[] = (Array.isArray(device?.videos) ? device.videos : []).filter((v: any) => v?.videoObj?.id);
  const v = videos.find(x => x.id === 'sub')
    || videos.find(x => !/h\.?265|hevc/i.test(String(x.title)))
    || videos[0];
  return v ? v.videoObj.id : null;
}

/**
 * Cameras widget: snapshot URLs and live view. Homey serves a device's snapshot at `/api/image/<id>`
 * (the driver makes it on request); the widget loads that directly when it can reach it, or else
 * through `getSnapshot`. Live view goes through Homey's own WebRTC server (go2rtc, `api.videos`):
 * the widget's offer goes in, an answer and a stream id come back, and the stream is kept alive.
 */
export default class CameraService {

  private images = new Map<string, { at: number, promise: Promise<Snapshot> }>();
  /** deviceId → image URL from the last state read, so a snapshot doesn't need a device read. */
  private imageUrls = new Map<string, string>();

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  async stop() {
    this.images.clear();
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<CameraDevice[]> {
    const tm = new Timings();
    const api = await tm.time('api', () => getAppApi(this.homey));
    const out = await Promise.all(deviceIds.map(async (id): Promise<CameraDevice> => {
      try {
        const device: any = await tm.time('getDevice', () => api.devices.getDevice({ id, $cache: false }));
        const image = cameraImage(device);
        if (image) this.imageUrls.set(id, image.url);
        else this.imageUrls.delete(id);
        return {
          id,
          name: device.name,
          icon: await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)),
          image,
          video: cameraVideo(device),
        };
      } catch (err) {
        this.log(`Camera ${id} unavailable:`, err);
        return { id, missing: true };
      }
    }));
    this.debug(`Cameras state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

  /** The device's current snapshot, for a widget that can't load the image URL itself. */
  async getSnapshot(deviceId: string): Promise<Snapshot> {
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

  private async fetchImage(url: string): Promise<Snapshot> {
    const api = await getAppApi(this.homey);
    const t0 = Date.now();
    const snapshot = await fetchImageBase64(api, url, 'Snapshot');
    this.debug(`Camera snapshot ${url}: ${Math.round(snapshot.data.length / 1024)} KB base64 in ${Date.now() - t0} ms`);
    return snapshot;
  }

}
