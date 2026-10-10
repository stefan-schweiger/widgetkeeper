import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import { listCapabilitySlots, listDevicesWhere, matches, withNone } from '../lib/autocomplete.js';
import { describeCapability, presentCaps, readCaps } from '../lib/capabilities.js';
import DeviceTracker, { zoneRef, type TrackedEntry } from '../lib/DeviceTracker.js';
import { deviceImage, fetchImageBase64, homeyUrl } from '../lib/deviceIcon.js';
import { readFirstLog } from '../lib/insightsLog.js';
import { KeyError } from '../lib/PersonalApiKey.js';
import { sharedCache } from '../lib/sharedCache.js';
import Timings from '../lib/Timings.js';
import { idList, keyResult, logged, logPerf } from '../lib/widgetApi.js';

vi.mock('homey-api', () => homeyApiMock);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('DeviceTracker', () => {
  type Entry = TrackedEntry & { name: string, value: unknown };

  function setup(opts: { readError?: (err: unknown) => unknown } = {}) {
    const device = fakeDevice({ id: 'd1', name: 'Plug', caps: { onoff: { type: 'boolean', value: true } } });
    const api = fakeApi({ devices: [device] });
    const homey = fakeHomey(api);
    const debug = vi.fn();
    const refresh = vi.fn((t: Entry, d: any) => {
      if (d.name === 'broken') throw new Error('Broken plug');
      t.name = d.name;
      t.value = d.capabilitiesObj.onoff.value;
    });
    const onDispose = vi.fn();
    const tracker = new DeviceTracker<Entry>({
      homey,
      debug,
      what: 'Plug capabilities',
      signature: d => Object.keys(d.capabilitiesObj).join(),
      create: async d => ({ name: d.name, value: d.capabilitiesObj.onoff?.value ?? null }),
      listen: (t, d) => [d.makeCapabilityInstance('onoff', (v: unknown) => { t.value = v; })],
      refresh,
      label: t => `plug ${t.name}`,
      onDispose,
      ...opts,
    });
    return { device, api, tracker, debug, refresh, onDispose };
  }

  it('tracks a device once, then re-reads it on each request', async () => {
    const { device, api, tracker, refresh } = setup();
    const [a, b] = await Promise.all([tracker.current('d1', new Timings()), tracker.current('d1', new Timings())]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ key: 'd1', name: 'Plug', value: true, signature: 'onoff' });
    expect(device.listenerCount('onoff')).toBe(1);
    device.report('onoff', false);
    expect(a.value).toBe(false);
    device.name = 'Lamp plug';
    const again = await tracker.current('d1', new Timings());
    expect(again).toBe(a);
    expect(again.name).toBe('Lamp plug');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(api.devices.getDevice).toHaveBeenLastCalledWith({ id: 'd1', $cache: false });
  });

  it('tracks again when the signature changed', async () => {
    const { device, tracker, debug } = setup();
    const first = await tracker.current('d1', new Timings());
    device.capabilitiesObj.dim = { id: 'dim', value: 0.5 };
    const second = await tracker.current('d1', new Timings());
    expect(second).not.toBe(first);
    expect(second.signature).toBe('onoff,dim');
    expect(device.listenerCount('onoff')).toBe(1);
    expect(debug).toHaveBeenCalledWith('Plug capabilities of Plug changed: onoff → onoff,dim');
  });

  it('disposes the entry when the re-read or the refresh fails', async () => {
    const { device, api, tracker, onDispose } = setup({ readError: err => new Error(`gone: ${(err as Error).message}`) });
    const t = await tracker.current('d1', new Timings());
    api.devices.getDevice.mockRejectedValueOnce(new Error('No device d1'));
    await expect(tracker.current('d1', new Timings())).rejects.toThrow('gone: No device d1');
    expect(onDispose).toHaveBeenCalledWith(t);
    expect(tracker.get('d1')).toBeUndefined();
    expect(device.listenerCount('onoff')).toBe(0);

    await tracker.current('d1', new Timings());
    device.name = 'broken';
    await expect(tracker.current('d1', new Timings())).rejects.toThrow('Broken plug');
    expect(tracker.get('d1')).toBeUndefined();
    expect(onDispose).toHaveBeenCalledTimes(2);
  });

  it('disposes an entry once when two re-reads see the change at the same time', async () => {
    const { device, tracker, onDispose, debug } = setup();
    const first = await tracker.current('d1', new Timings());
    device.capabilitiesObj.dim = { id: 'dim', value: 0.5 };
    const [a, b] = await Promise.all([tracker.current('d1', new Timings()), tracker.current('d1', new Timings())]);
    expect(a).toBe(b);
    expect(a).not.toBe(first);
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls.filter(c => c[0] === 'Stopped tracking plug Plug')).toHaveLength(1);
    expect(device.listenerCount('onoff')).toBe(1);
    tracker.dispose(first); // again: nothing happens
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing when stopped while a device is being tracked', async () => {
    const { device, tracker } = setup();
    tracker.start();
    const pending = tracker.current('d1', new Timings());
    tracker.stop();
    await expect(pending).rejects.toThrow('Stopped before d1 was tracked');
    expect(device.listenerCount('onoff')).toBe(0);
    expect(tracker.get('d1')).toBeUndefined();
  });

  it('answers one entry per key, a failing one as missing', async () => {
    const { tracker } = setup();
    const log = vi.fn();
    const out = await tracker.each(['d1', 'nope'], new Timings(), log, 'Plug', t => ({ id: t.key, name: t.name }));
    expect(out).toEqual([{ id: 'd1', name: 'Plug' }, { id: 'nope', missing: true }]);
    expect(log).toHaveBeenCalledWith('Plug nope unavailable:', expect.any(Error));
  });

  it('drops an entry after 10 minutes without a request', async () => {
    const { device, tracker, debug } = setup();
    tracker.start();
    await tracker.current('d1', new Timings());
    await vi.advanceTimersByTimeAsync(9 * 60e3);
    expect(device.listenerCount('onoff')).toBe(1);
    await vi.advanceTimersByTimeAsync(2 * 60e3);
    expect(device.listenerCount('onoff')).toBe(0);
    expect(debug).toHaveBeenCalledWith('Stopped tracking plug Plug');
    tracker.stop();
  });

  it('names a zone', () => {
    expect(zoneRef({ z1: { name: 'Stue' } }, 'z1')).toEqual({ id: 'z1', name: 'Stue' });
    expect(zoneRef({ z1: { name: 'Stue' } }, 'z2')).toBeNull();
    expect(zoneRef({}, null)).toBeNull();
  });
});

describe('autocomplete', () => {
  it('matches a query and puts None first', () => {
    expect(matches('', 'x')).toBe(true);
    expect(matches(' KITCH ', undefined, 'Kitchen')).toBe(true);
    expect(matches('bath', 'Kitchen')).toBe(false);
    const items = [{ name: 'Kitchen', id: 'k' }];
    expect(withNone('None', '', items)).toEqual([{ name: 'None', id: 'none' }, ...items]);
    expect(withNone('None', 'kit', items)).toEqual(items);
  });

  it('lists devices and capability slots', async () => {
    const plug = fakeDevice({ id: 'p', name: 'Plug', zone: 'z1', caps: { onoff: { type: 'boolean', title: 'On' }, measure_power: { type: 'number', title: 'Power', units: 'W' } } });
    const lamp = fakeDevice({ id: 'l', name: 'Lamp', zone: 'z9', caps: { dim: { type: 'number', title: '' } } });
    const homey = fakeHomey(fakeApi({ devices: [plug, lamp], zones: { z1: { name: 'Stue' } } }));
    expect(await listDevicesWhere(homey, '', d => !!d.capabilitiesObj.onoff)).toEqual([{ name: 'Plug', description: 'Stue', id: 'p' }]);
    expect(await listDevicesWhere(homey, 'stue', () => true)).toEqual([{ name: 'Plug', description: 'Stue', id: 'p' }]);
    expect(await listCapabilitySlots(homey, '', d => Object.keys(d.capabilitiesObj))).toEqual([
      { name: 'None', id: 'none' },
      { name: 'Lamp · dim', description: undefined, id: 'l:dim' }, // an empty title falls back to the id
      { name: 'Plug · On', description: 'Stue', id: 'p:onoff' },
      { name: 'Plug · Power', description: 'Stue · W', id: 'p:measure_power' },
    ]);
  });
});

describe('capabilities', () => {
  it('describes a capability, falling back to its id', () => {
    expect(describeCapability({ type: 'enum', title: '', units: '', values: [{ id: 'a', title: 'A' }, { id: 2 }] }, 'mode')).toEqual({
      title: 'mode', type: 'enum', units: null, decimals: null, min: null, max: null, values: [{ id: 'a', title: 'A' }, { id: '2', title: '2' }],
    });
    expect(describeCapability({ type: 'number', title: 'Power', units: 'W', decimals: 0, min: 0, max: 10, values: [] }, 'p')).toMatchObject({
      title: 'Power', units: 'W', decimals: 0, min: 0, max: 10, values: null,
    });
  });

  it('reads the capabilities a device has, in the given order', () => {
    const device = { capabilitiesObj: { dim: { value: 0.4 }, onoff: { value: null, setable: false } } };
    expect(presentCaps(device, ['onoff', 'light_hue', 'dim'])).toEqual(['onoff', 'dim']);
    expect(readCaps(device, ['onoff', 'dim'])).toEqual({ onoff: { value: null, setable: false }, dim: { value: 0.4, setable: true } });
  });
});

describe('sharedCache', () => {
  it('shares a read while it is young enough and drops a failed one', async () => {
    let n = 0;
    const fetch = vi.fn(async () => {
      n++;
      if (n === 2) throw new Error('down');
      return n;
    });
    const cache = sharedCache(fetch);
    expect(cache.cached).toBe(false);
    expect(await Promise.all([cache.get(1000), cache.get(1000)])).toEqual([1, 1]);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(await cache.get(1000)).toBe(1);
    expect(await cache.get(100).catch(e => e.message)).toBe('down'); // older than 100 ms: read again
    expect(cache.cached).toBe(false);
    expect(await cache.get(1000)).toBe(3);
  });
});

describe('readFirstLog', () => {
  it('tries the candidates and remembers the one that worked', async () => {
    const known = new Map<string, string>();
    const read = vi.fn(async (id: string) => { if (id !== 'b') throw new Error(`no ${id}`); return id.toUpperCase(); });
    expect(await readFirstLog('k', ['a', 'b'], known, read)).toEqual({ logId: 'b', result: 'B' });
    expect(known.get('k')).toBe('b');
    read.mockClear();
    await readFirstLog('k', ['a', 'b'], known, read);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('forgets a remembered log that fails, unless it is kept', async () => {
    const read = vi.fn(async (id: string) => { throw new Error(`no ${id}`); });
    const known = new Map([['k', 'b']]);
    await expect(readFirstLog('k', ['a', 'b'], known, read, { keep: true })).rejects.toThrow('no b');
    expect(known.get('k')).toBe('b');
    await expect(readFirstLog('k', ['a', 'b'], known, read)).rejects.toThrow('no b');
    expect(known.has('k')).toBe(false);
  });
});

describe('images', () => {
  const images = [
    { type: 'other', imageObj: { id: 'o', url: '/api/image/o', lastUpdated: 'x' } },
    { type: 'media', imageObj: { id: 'm', url: '/api/image/m', lastUpdated: 5 } },
  ];

  it('finds an image by type', () => {
    expect(deviceImage({ images }, 'media')).toEqual({ id: 'm', url: '/api/image/m', lastUpdated: 5 });
    expect(deviceImage({ images }, 'camera')).toBeNull();
    expect(deviceImage({ images }, 'camera', { anyType: true })).toEqual({ id: 'o', url: '/api/image/o', lastUpdated: null });
  });

  it('fetches an image from Homey as base64', async () => {
    const api = { baseUrl: Promise.resolve('http://homey') };
    expect(await homeyUrl(api, '/api/image/m')).toBe('http://homey/api/image/m');
    expect(await homeyUrl(api, 'https://x/y')).toBe('https://x/y');
    const fetch = vi.fn(async (_url: string) => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchImageBase64(api, '/api/image/m', 'Art')).toEqual({ type: 'image/png', data: 'AQID' });
    expect(fetch).toHaveBeenCalledWith('http://homey/api/image/m');
    fetch.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    await expect(fetchImageBase64(api, '/api/image/m', 'Art')).rejects.toThrow('Art is text/html');
    fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(fetchImageBase64(api, '/api/image/m', 'Art')).rejects.toThrow('Art HTTP 404');
  });
});

describe('widget API helpers', () => {
  const app = () => ({ log: vi.fn(), debug: vi.fn() });

  it('splits id lists and logs load marks', () => {
    expect(idList('a,,b')).toEqual(['a', 'b']);
    expect(idList(undefined)).toEqual([]);
    const a = app();
    logPerf(a, 'Lights', { perf: `${Date.now()},140,1900,1950` });
    expect(a.debug).toHaveBeenCalledWith(expect.stringMatching(/^Lights widget: frame started .* request 1950 ms$/));
    logPerf(a, 'Lights', {});
    expect(a.debug).toHaveBeenCalledTimes(1);
  });

  it('logs a failure and throws it on', async () => {
    const a = app();
    expect(await logged(a, 'Fine:', async () => 1)).toBe(1);
    const err = new Error('boom');
    await expect(logged(a, 'Lights state failed:', async () => { throw err; })).rejects.toBe(err);
    expect(a.log).toHaveBeenCalledWith('Lights state failed:', err);
  });

  it('answers key problems as a reason', async () => {
    const a = app();
    expect(await keyResult(a, 'Flow start failed', async () => {})).toEqual({ ok: true });
    expect(await keyResult(a, 'Pages failed', async () => ({ pages: [] }))).toEqual({ ok: true, pages: [] });
    expect(await keyResult(a, 'Flow start failed', async () => { throw new KeyError('noKey'); })).toEqual({ ok: false, reason: 'noKey' });
    expect(a.log).not.toHaveBeenCalled();
    expect(await keyResult(a, 'Flow start failed', async () => { throw new KeyError('keyScope', 'Missing Scopes'); })).toEqual({ ok: false, reason: 'keyScope' });
    expect(a.log).toHaveBeenCalledWith('Flow start failed (keyScope):', 'Missing Scopes');
    const err = new Error('boom');
    await expect(keyResult(a, 'Flow start failed', async () => { throw err; })).rejects.toBe(err);
    expect(a.log).toHaveBeenLastCalledWith('Flow start failed:', err);
  });
});
