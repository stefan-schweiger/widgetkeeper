import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

/** Homey's location for an address's `{lat}` and `{lon}`, to 2 decimals (about 1 km: enough for a map). */
export function pageLocation(lat: unknown, lon: unknown): { lat: number, lon: number } | { noLocation: true } {
  const la = Number(lat);
  const lo = Number(lon);
  // Homey reports 0, 0 until a location is set.
  if (!Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) return { noLocation: true };
  return { lat: Math.round(la * 100) / 100, lon: Math.round(lo * 100) / 100 };
}

export default {
  async getLocation({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    logPerf(homey.app as WidgetkeeperApp, 'Web Page', query);
    return pageLocation(homey.geolocation.getLatitude(), homey.geolocation.getLongitude());
  },
};
