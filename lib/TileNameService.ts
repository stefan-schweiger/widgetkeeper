import type Homey from 'homey';
import { logged } from './widgetApi.js';

export const TILE_NAMES_EVENT = 'tilenames:state';
/** The app setting holding the typed tile names: `{ '<widget instance id>': TileNames }`. */
export const TILE_NAMES_SETTING = 'tileNames';

const MAX_NAME = 60;
const MAX_KEY = 200;
const MAX_KEYS = 60;
const MAX_INSTANCES = 300;

/** `adopted`: the names the widget had in its own settings were taken over (`adopt()`), so it never happens again. */
type TileNames = { names: Record<string, string>, updatedAt: number, adopted?: true };

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

/** Each id's tile key: the id, then `#2`, `#3` … for repeats (the widgets' `nameKeys()`), so reordering keeps the names. */
export function repeatKeys(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    return n > 1 ? `${id}#${n}` : id;
  });
}

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
      if (entry.adopted === true) all[id].adopted = true;
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
    this.store(all, id, names, has(all, id) && all[id].adopted === true);
    this.debug(`Tile names of ${id}: ${Object.keys(names).length}`);
    return { instance: id, names };
  }

  /**
   * Takes over the names a widget had in its own settings before it had tile names (Variables' `nameN`), by tile key,
   * once per instance: a tile with a typed name keeps it. A removed setting's value stays, so wherever it still turns
   * up (a Smart Stack page's settings on every load, the saved web dashboards at every start) it comes again; once
   * taken over it's never read again, and a name cleared on the tile stays cleared.
   */
  adopt(instance: unknown, given: unknown) {
    const id = instanceId(instance);
    const all = this.all();
    if (has(all, id) && all[id].adopted) return { instance: id, names: { ...all[id].names } };
    const names = has(all, id) ? { ...all[id].names } : {};
    let added = 0;
    for (const [k, v] of Object.entries(readNames(given))) {
      const value = v.trim().slice(0, MAX_NAME);
      if (!value || !k || k.length > MAX_KEY || has(names, k) || Object.keys(names).length >= MAX_KEYS) continue;
      names[k] = value;
      added++;
    }
    this.store(all, id, names, true, added > 0);
    this.debug(`Tile names of ${id}: ${added} taken over from its settings`);
    return { instance: id, names };
  }

  /**
   * Saves an instance's names (an instance without any is forgotten, unless it took over its settings' names: that
   * stays known), keeping the 300 renamed most recently, and sends them over realtime unless `send` is false.
   */
  private store(all: Record<string, TileNames>, id: string, names: Record<string, string>, adopted: boolean, send = true) {
    if (Object.keys(names).length || adopted) {
      all[id] = { names, updatedAt: Date.now() };
      if (adopted) all[id].adopted = true;
      const ids = Object.keys(all).sort((a, b) => all[a].updatedAt - all[b].updatedAt);
      for (const old of ids.slice(0, Math.max(0, ids.length - MAX_INSTANCES))) delete all[old];
    } else {
      delete all[id];
    }
    this.homey.settings.set(TILE_NAMES_SETTING, all);
    if (send) this.homey.api.realtime(TILE_NAMES_EVENT, { instance: id, names });
  }

  /** For the diagnostics report: counts only, never the names. */
  describe() {
    const all = Object.values(this.all()).filter(w => Object.keys(w.names).length);
    return { widgets: all.length, names: all.reduce((n, w) => n + Object.keys(w.names).length, 0) };
  }

}

type RouteArgs = { homey: Homey.App['homey'], query?: Record<string, string>, body?: any };
const service = (homey: RouteArgs['homey']) => (homey.app as any).tileNames as TileNameService;

/**
 * A device-tile widget's `/state` answer, with its tile names when it asks with `instance=`: `{state, tileNames}`, so a
 * widget's load is one request, not two. Without `instance` (the Smart Stack's attention reads), the
 * state as it was. `oldNames` (JSON `{key: name}`, the names in the widget's old settings) are taken over first
 * (`adopt()`), so this answer has them; that going wrong never fails the state.
 */
export async function withTileNames<T>(homey: RouteArgs['homey'], query: RouteArgs['query'], state: Promise<T>): Promise<T | { state: T, tileNames: Record<string, string> }> {
  if (typeof query?.instance === 'string' && typeof query.oldNames === 'string') {
    try {
      service(homey).adopt(query.instance, JSON.parse(query.oldNames));
    } catch (err) {
      (homey.app as any).log('Old tile names not taken over:', err);
    }
  }
  const s = await state;
  if (typeof query?.instance !== 'string') return s;
  return { state: s, tileNames: service(homey).get(query.instance).names };
}

/** `POST /names {instance, key, name}`: spread into each device-tile widget's api.ts (the names come with `/state`, `withTileNames()`). */
export const tileNameRoutes = {
  async setName({ homey, body }: RouteArgs) {
    return logged(homey.app as any, 'Tile name change failed:', async () => service(homey).set(body?.instance, body?.key, body?.name));
  },
};
