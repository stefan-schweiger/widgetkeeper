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

/** Ids that would reach (or read) `Object.prototype` as keys of a plain object: never an instance or a tile key. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

function instanceId(instance: unknown): string {
  const id = typeof instance === 'string' ? instance.trim() : '';
  if (!id || id.length > MAX_KEY) throw new Error('Missing instance');
  if (RESERVED.has(id)) throw new Error('Invalid instance');
  return id;
}

function tileKey(key: unknown): string {
  const k = typeof key === 'string' ? key : '';
  if (!k || k.length > MAX_KEY) throw new Error('Missing key');
  if (RESERVED.has(k)) throw new Error('Invalid key');
  return k;
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored names object, copied by its own string entries only (the setting comes back from JSON as it was saved). */
function readNames(v: unknown): Record<string, string> {
  const names: Record<string, string> = {};
  if (!isObject(v)) return names;
  for (const k of Object.keys(v)) {
    if (!RESERVED.has(k) && typeof v[k] === 'string') names[k] = v[k] as string;
  }
  return names;
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

  /** A fresh copy of the setting: own keys only, so an odd stored key can't reach `Object.prototype`. */
  private all(): Record<string, TileNames> {
    const v = this.homey.settings.get(TILE_NAMES_SETTING);
    const all: Record<string, TileNames> = {};
    if (!isObject(v)) return all;
    for (const id of Object.keys(v)) {
      const entry = v[id];
      if (RESERVED.has(id) || !isObject(entry)) continue;
      all[id] = { names: readNames(entry.names), updatedAt: Number(entry.updatedAt) || 0 };
    }
    return all;
  }

  get(instance: unknown): { instance: string, names: Record<string, string> } {
    const id = instanceId(instance);
    const all = this.all();
    return { instance: id, names: has(all, id) ? { ...all[id].names } : {} };
  }

  /** Names a tile; an empty name gives the tile its own name back. A name past 60 characters is cut. */
  set(instance: unknown, key: unknown, name: unknown) {
    const id = instanceId(instance);
    const k = tileKey(key);
    const value = String(name ?? '').trim().slice(0, MAX_NAME);
    const all = this.all();
    const names = has(all, id) ? { ...all[id].names } : {};
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
    return { widgets: all.length, names: all.reduce((n, w) => n + Object.keys(w.names).length, 0) };
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
