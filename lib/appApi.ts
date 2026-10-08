import type Homey from 'homey';
import { HomeyAPI } from 'homey-api';

type AppHomey = Homey.App['homey'];

const cache = new WeakMap<object, Promise<any>>();

/** One shared `HomeyAPI.createAppAPI` instance per app (needs the `homey:manager:api` permission). */
export function getAppApi(homey: AppHomey): Promise<any> {
  let p = cache.get(homey);
  if (!p) {
    p = HomeyAPI.createAppAPI({ homey: homey as any }).catch(err => {
      cache.delete(homey);
      throw err;
    });
    cache.set(homey, p);
  }
  return p;
}

/** A capability's `lastUpdated` (Homey sends an ISO string; checked 2026-10-08) in ms, or null. */
export function lastUpdatedMs(v: unknown): number | null {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
