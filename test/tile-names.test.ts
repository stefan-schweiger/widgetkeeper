import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey } from './helpers/fakeHomey.js';
import TileNameService, { repeatKeys, TILE_NAMES_EVENT, TILE_NAMES_SETTING, tileNameRoutes, withTileNames } from '../lib/TileNameService.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const homey = fakeHomey(fakeApi());
  const service = new TileNameService(homey as any, () => {});
  (homey as any).app = { tileNames: service, log: () => {}, debug: () => {} };
  return { homey, service };
}

describe('TileNameService', () => {
  it('names a tile per widget instance, sends it over realtime and survives a restart', () => {
    const { service, homey } = setup();
    service.set('w1', 'zone:living', '  Sofa lights ');
    expect(homey.api.realtime).toHaveBeenCalledWith(TILE_NAMES_EVENT, { instance: 'w1', names: { 'zone:living': 'Sofa lights' } });
    expect(service.get('w1')).toEqual({ instance: 'w1', names: { 'zone:living': 'Sofa lights' } });
    expect(service.get('w2').names).toEqual({});
    expect(new TileNameService(homey as any, () => {}).get('w1').names).toEqual({ 'zone:living': 'Sofa lights' });
  });

  it('gives a tile its own name back with an empty name, and forgets an instance with none', () => {
    const { service, homey } = setup();
    service.set('w1', 'a', 'Lamp');
    service.set('w1', 'b', 'Spot');
    service.set('w1', 'a', ' ');
    expect(service.get('w1').names).toEqual({ b: 'Spot' });
    service.set('w1', 'b', '');
    expect(homey.settings.get(TILE_NAMES_SETTING)).toEqual({});
    expect(homey.api.realtime).toHaveBeenLastCalledWith(TILE_NAMES_EVENT, { instance: 'w1', names: {} });
  });

  it('cuts long names and refuses a missing instance or key', () => {
    const { service } = setup();
    service.set('w1', 'a', 'x'.repeat(80));
    expect(service.get('w1').names.a).toHaveLength(60);
    expect(() => service.set('', 'a', 'x')).toThrow();
    expect(() => service.set('w1', '', 'x')).toThrow();
    expect(() => service.get(undefined)).toThrow();
  });

  it('refuses prototype ids as an instance or key, without saving or sending anything', () => {
    const { service, homey } = setup();
    for (const bad of ['__proto__', 'constructor', 'prototype']) {
      expect(() => service.set(bad, 'a', 'x')).toThrow('Invalid instance');
      expect(() => service.set('w1', bad, 'x')).toThrow('Invalid key');
      expect(() => service.get(bad)).toThrow('Invalid instance');
    }
    expect(homey.api.realtime).not.toHaveBeenCalled();
    expect(homey.settings.get(TILE_NAMES_SETTING)).toBeNull();
    expect(service.get('toString').names).toEqual({});
    service.set('hasOwnProperty', 'toString', 'Lamp');
    expect(service.get('hasOwnProperty').names).toEqual({ toString: 'Lamp' });
    expect(Object.getPrototypeOf(homey.settings.get(TILE_NAMES_SETTING))).toBe(Object.prototype);
  });

  it('reads a stored setting with odd keys or entries safely', () => {
    const { service, homey } = setup();
    homey.settings.set(TILE_NAMES_SETTING, JSON.parse(
      '{"__proto__": {"names": {"a": "x"}, "updatedAt": 1}, "w1": {"names": {"__proto__": "x", "a": "Lamp", "b": 3}, "updatedAt": 1}, "w2": null, "w3": "x"}',
    ));
    expect(service.get('w1').names).toEqual({ a: 'Lamp' });
    expect(Object.getPrototypeOf(service.get('w1').names)).toBe(Object.prototype);
    expect(service.describe()).toEqual({ widgets: 1, names: 1 });
    service.set('w1', 'c', 'Spot');
    const all = homey.settings.get(TILE_NAMES_SETTING);
    expect(Object.keys(all)).toEqual(['w1']);
    expect(all.w1.names).toEqual({ a: 'Lamp', c: 'Spot' });
  });

  it('keeps at most 300 instances, dropping the ones renamed longest ago', () => {
    const { service, homey } = setup();
    for (let i = 0; i < 305; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 15, 12, 0, i)));
      service.set(`w${i}`, 'a', 'Lamp');
    }
    const all = homey.settings.get(TILE_NAMES_SETTING);
    expect(Object.keys(all)).toHaveLength(300);
    expect(all.w4).toBeUndefined();
    expect(all.w5).toBeDefined();
    expect(service.describe()).toEqual({ widgets: 300, names: 300 });
  });

  it('serves the widget routes', async () => {
    const { homey } = setup();
    await tileNameRoutes.setName({ homey: homey as any, body: { instance: 'w1', key: 'd1', name: 'Hall' } });
    expect(await tileNameRoutes.getNames({ homey: homey as any, query: { instance: 'w1' } })).toEqual({ instance: 'w1', names: { d1: 'Hall' } });
  });

  it('adds the names to a /state answer that asks with its instance', async () => {
    const { homey, service } = setup();
    service.set('w1', 'd1', 'Hall');
    expect(await withTileNames(homey as any, { instance: 'w1' }, Promise.resolve([{ id: 'd1' }]))).toEqual({ state: [{ id: 'd1' }], tileNames: { d1: 'Hall' } });
    expect(await withTileNames(homey as any, { deviceIds: 'd1' }, Promise.resolve([{ id: 'd1' }]))).toEqual([{ id: 'd1' }]);
  });

  it('is in the api of every widget with device tiles', () => {
    const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
    for (const id of ['lights', 'curtains', 'quickactions', 'sensoralarms', 'values', 'sparklines', 'locks', 'cameras', 'variables']) {
      expect(manifest.widgets[id].api.getNames).toEqual({ method: 'GET', path: '/names' });
      expect(manifest.widgets[id].api.setName).toEqual({ method: 'POST', path: '/names' });
      expect(manifest.widgets[id].settings.find((s: any) => s.id === 'renameTiles')).toMatchObject({ type: 'checkbox', value: false });
    }
  });
});

describe("taking over the names of a widget's old settings", () => {
  it('takes them over once, keeping a name already typed on the tile', () => {
    const { service, homey } = setup();
    service.set('w1', 'b', 'Typed');
    service.adopt('w1', { a: '  Guests ', b: 'Old', c: '' });
    expect(service.get('w1').names).toEqual({ a: 'Guests', b: 'Typed' });
    expect(homey.api.realtime).toHaveBeenLastCalledWith(TILE_NAMES_EVENT, { instance: 'w1', names: { a: 'Guests', b: 'Typed' } });
    // Every later load sends them again: nothing changes, nothing is sent.
    vi.mocked(homey.api.realtime).mockClear();
    service.set('w1', 'a', 'Visitors');
    service.adopt('w1', { a: 'Guests', d: 'New' });
    expect(service.get('w1').names).toEqual({ a: 'Visitors', b: 'Typed' });
    expect(homey.api.realtime).toHaveBeenCalledTimes(1); // the set() only
  });

  it('remembers the takeover when every name is cleared, so a cleared name stays cleared', () => {
    const { service, homey } = setup();
    service.adopt('w1', { a: 'Guests' });
    service.set('w1', 'a', '');
    expect(homey.settings.get(TILE_NAMES_SETTING).w1).toMatchObject({ names: {}, adopted: true });
    expect(service.describe()).toEqual({ widgets: 0, names: 0 });
    service.adopt('w1', { a: 'Guests' });
    expect(service.get('w1').names).toEqual({});
    // It survives a restart.
    expect(new TileNameService(homey as any, () => {}).adopt('w1', { a: 'Guests' }).names).toEqual({});
  });

  it('marks an instance taken over even with nothing to take, without sending anything', () => {
    const { service, homey } = setup();
    service.adopt('w1', { a: ' ' });
    expect(homey.api.realtime).not.toHaveBeenCalled();
    expect(homey.settings.get(TILE_NAMES_SETTING).w1).toMatchObject({ names: {}, adopted: true });
  });

  it('ignores odd names and keys, and refuses a missing or prototype instance', () => {
    const { service } = setup();
    service.adopt('w1', JSON.parse('{"__proto__": "x", "a": 3, "b": "x", "c": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"}'));
    expect(service.get('w1').names).toEqual({ b: 'x', c: 'y'.repeat(60) });
    service.adopt('w2', 'not an object');
    expect(service.get('w2').names).toEqual({});
    expect(() => service.adopt('', { a: 'x' })).toThrow();
    expect(() => service.adopt('__proto__', { a: 'x' })).toThrow('Invalid instance');
  });

  it('takes them over in the /state request that sends them, so its answer has them', async () => {
    const { homey } = setup();
    const query = { ids: 'a', instance: 'w1', oldNames: JSON.stringify({ a: 'Guests', 'a#2': 'Again' }) };
    expect(await withTileNames(homey as any, query, Promise.resolve([{ id: 'a' }, { id: 'a' }])))
      .toEqual({ state: [{ id: 'a' }, { id: 'a' }], tileNames: { a: 'Guests', 'a#2': 'Again' } });
  });

  it('answers /state when the old names are no JSON', async () => {
    const { homey } = setup();
    const log = vi.fn();
    (homey as any).app.log = log;
    expect(await withTileNames(homey as any, { instance: 'w1', oldNames: '{oops' }, Promise.resolve([])))
      .toEqual({ state: [], tileNames: {} });
    expect(log).toHaveBeenCalledWith('Old tile names not taken over:', expect.any(SyntaxError));
  });

  it('keys repeats as the widgets do', () => {
    expect(repeatKeys(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a#2', 'a#3']);
  });
});
