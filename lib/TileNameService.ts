import type Homey from 'homey';
import { logged } from './widgetApi.js';

export const TILE_NAMES_EVENT = 'tilenames:state';
/** The app setting holding the typed tile names: `{ '<widget instance id>': TileNames }`. */
export const TILE_NAMES_SETTING = 'tileNames';

const MAX_NAME = 60;
const MAX_KEY = 200;
const MAX_KEYS = 60;
const MAX_INSTANCES = 300;

type TileNames = { names: Record<string, string>, updatedAt: number };

function instanceId(instance: unknown): string {
  const id = typeof instance === 'string' ? instance.trim() : '';
  if (!id || id.length > MAX_KEY) throw new Error('Missing instance');
  return id;
}

/**
 * The names typed on a widget's tiles (the `renameTiles` setting): per widget instance, so every screen showing the
 * dashboard widget (and a Smart Stack page of it) gets them, by tile key (a device id, `zone:<id>`, a value slot), so
 * renaming or reordering devices doesn't move them. Nothing tells the app a widget was removed, so the instances
 * renamed longest ago go once there are too many.
 */
export default class TileNameService {

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  private all(): Record<string, TileNames> {
    const v = this.homey.settings.get(TILE_NAMES_SETTING);
    return v && typeof v === 'object' ? v : {};
  }

  get(instance: unknown): { instance: string, names: Record<string, string> } {
    const id = instanceId(instance);
    return { instance: id, names: { ...this.all()[id]?.names } };
  }

  /** Names a tile; an empty name gives the tile its own name back. A name past 60 characters is cut. */
  set(instance: unknown, key: unknown, name: unknown) {
    const id = instanceId(instance);
    const k = typeof key === 'string' ? key : '';
    if (!k || k.length > MAX_KEY) throw new Error('Missing key');
    const value = String(name ?? '').trim().slice(0, MAX_NAME);
    const all = { ...this.all() };
    const names = { ...all[id]?.names };
    if (value) names[k] = value;
    else delete names[k];
    if (Object.keys(names).length > MAX_KEYS) throw new Error('Too many names');
    if (Object.keys(names).length) {
      all[id] = { names, updatedAt: Date.now() };
      const ids = Object.keys(all).sort((a, b) => all[a].updatedAt - all[b].updatedAt);
      for (const old of ids.slice(0, Math.max(0, ids.length - MAX_INSTANCES))) delete all[old];
    } else {
      delete all[id];
    }
    this.homey.settings.set(TILE_NAMES_SETTING, all);
    this.homey.api.realtime(TILE_NAMES_EVENT, { instance: id, names });
    this.debug(`Tile names of ${id}: ${Object.keys(names).length}`);
    return { instance: id, names };
  }

  /** For the diagnostics report: counts only, never the names. */
  describe() {
    const all = Object.values(this.all());
    return { widgets: all.length, names: all.reduce((n, w) => n + Object.keys(w.names || {}).length, 0) };
  }

}

type RouteArgs = { homey: Homey.App['homey'], query?: Record<string, string>, body?: any };
const service = (homey: RouteArgs['homey']) => (homey.app as any).tileNames as TileNameService;

/** `GET /names?instance=` and `POST /names {instance, key, name}`: spread into each device-tile widget's api.ts. */
export const tileNameRoutes = {
  async getNames({ homey, query }: RouteArgs) {
    return logged(homey.app as any, 'Tile names failed:', async () => service(homey).get(query?.instance));
  },

  async setName({ homey, body }: RouteArgs) {
    return logged(homey.app as any, 'Tile name change failed:', async () => service(homey).set(body?.instance, body?.key, body?.name));
  },
};
