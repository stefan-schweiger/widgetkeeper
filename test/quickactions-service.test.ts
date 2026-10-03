import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import QuickActionService, { QA_STATE_EVENT, quickActionId } from '../lib/QuickActionService.js';

vi.mock('homey-api', () => homeyApiMock);

const lamp = (value = false) => fakeDevice({
  id: 'lamp', name: 'Lamp', caps: { onoff: { type: 'boolean', value }, dim: { type: 'number', value: 1 } }, ui: { quickAction: 'onoff' },
});
const lock = () => fakeDevice({
  id: 'lock', name: 'Front door',
  caps: { locked: { type: 'boolean', value: true }, alarm_contact: { type: 'boolean', value: false, setable: false } },
  ui: { quickAction: null, quickActionOverride: 'locked' },
});
const alarm = () => fakeDevice({ id: 'alarm', name: 'Alarm', caps: { button: { type: 'boolean', value: false } }, ui: { quickAction: 'button' } });
const sensor = () => fakeDevice({ id: 'sensor', name: 'Sensor', caps: { measure_temperature: { type: 'number', value: 20 } } });

function setup(devices = [lamp(), lock(), alarm(), sensor()]) {
  const homey = fakeHomey(fakeApi({ devices }));
  const service = new QuickActionService(homey, () => {});
  return { homey, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('quickActionId', () => {
  it('prefers the override, and .none turns it off', () => {
    const caps = { onoff: { type: 'boolean' }, locked: { type: 'boolean' } };
    const d = (ui: object) => fakeDevice({ caps, ui });
    expect(quickActionId(d({ quickAction: 'onoff' }))).toBe('onoff');
    expect(quickActionId(d({ quickAction: 'onoff', quickActionOverride: 'locked' }))).toBe('locked');
    expect(quickActionId(d({ quickAction: 'onoff', quickActionOverride: '.none' }))).toBeNull();
    expect(quickActionId(d({ quickAction: 'gone' }))).toBeNull();
    expect(quickActionId(d({}))).toBeNull();
  });
});

describe('getState', () => {
  it('returns the devices in the order asked, with missing ones marked', async () => {
    const { service } = setup();
    const state = await service.getState(['lock', 'nope', 'lamp', 'sensor']);
    expect(state).toEqual([
      { id: 'lock', name: 'Front door', icon: null, quickAction: { capabilityId: 'locked', value: true, actionable: true, momentary: false, icon: null } },
      { id: 'nope', missing: true },
      { id: 'lamp', name: 'Lamp', icon: null, quickAction: { capabilityId: 'onoff', value: false, actionable: true, momentary: false, icon: null } },
      { id: 'sensor', name: 'Sensor', icon: null, quickAction: null },
    ]);
  });

  it('marks button capabilities as momentary', async () => {
    const { service } = setup();
    const [a] = await service.getState(['alarm']);
    expect(a).toMatchObject({ quickAction: { capabilityId: 'button', momentary: true } });
  });

  it('marks a quick action that is not a settable boolean as not actionable', async () => {
    const d = fakeDevice({ id: 'x', caps: { onoff: { type: 'boolean', setable: false } }, ui: { quickAction: 'onoff' } });
    const { service } = setup([d]);
    const [s] = await service.getState(['x']);
    expect(s).toMatchObject({ quickAction: { actionable: false } });
  });
});

describe('icons', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the user-picked library icon, else the driver's", async () => {
    const svg = (name: string) => ({ ok: true, text: async () => `<svg>${name}</svg>` });
    const fetch = vi.fn(async (url: string) => (url.includes('/img/devices/broken') ? { ok: false, status: 404 } : svg(url)));
    vi.stubGlobal('fetch', fetch);
    const picked = Object.assign(lamp(), { iconOverride: 'christmas-lights', iconObj: { url: '/api/icon/a' } });
    const broken = Object.assign(lock(), { iconOverride: 'broken', iconObj: { url: '/api/icon/b' } });
    const homey = fakeHomey(Object.assign(fakeApi({ devices: [picked, broken] }), { baseUrl: 'http://homey' }));
    const [a, b] = await new QuickActionService(homey, () => {}).getState(['lamp', 'lock']);
    const decode = (d: any) => Buffer.from(d.icon.split(',')[1], 'base64').toString();
    expect(decode(a)).toBe('<svg>https://my.homey.app/img/devices/christmas-lights.svg</svg>');
    expect(decode(b)).toBe('<svg>http://homey/api/icon/b</svg>');
  });

  it('fetches each icon once, even for a new service', async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, text: async () => `<svg>${url}</svg>` }));
    vi.stubGlobal('fetch', fetch);
    const devices = () => [
      Object.assign(lamp(), { iconObj: { url: '/api/icon/shared' } }),
      Object.assign(lock(), { iconObj: { url: '/api/icon/shared' } }),
    ];
    const homey = () => fakeHomey(Object.assign(fakeApi({ devices: devices() }), { baseUrl: 'http://homey' }));
    await new QuickActionService(homey(), () => {}).getState(['lamp', 'lock']);
    await new QuickActionService(homey(), () => {}).getState(['lamp']);
    expect(fetch.mock.calls.filter(([url]) => url === 'http://homey/api/icon/shared')).toHaveLength(1);
  });
});

describe('tracking', () => {
  it('sends quick-action changes as realtime events', async () => {
    const { service, homey, devices } = setup();
    await service.getState(['lamp']);
    devices[0].report('onoff', true);
    expect(homey.api.realtime).toHaveBeenCalledWith(QA_STATE_EVENT, { deviceId: 'lamp', capabilityId: 'onoff', value: true });
    const [s] = await service.getState(['lamp']);
    expect(s).toMatchObject({ quickAction: { value: true } });
  });

  it('tracks each device once, and only its quick action', async () => {
    const { service, devices } = setup();
    await Promise.all([service.getState(['lamp']), service.getState(['lamp'])]);
    await service.getState(['lamp']);
    expect(devices[0].makeCapabilityInstance).toHaveBeenCalledTimes(1);
    expect(devices[0].makeCapabilityInstance).toHaveBeenCalledWith('onoff', expect.any(Function));
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, devices } = setup();
    service.start();
    await service.getState(['lamp']);
    await vi.advanceTimersByTimeAsync(9 * 60e3);
    await service.getState(['lamp']);
    await vi.advanceTimersByTimeAsync(9 * 60e3);
    expect(devices[0].listenerCount('onoff')).toBe(1);
    await vi.advanceTimersByTimeAsync(3 * 60e3);
    expect(devices[0].listenerCount('onoff')).toBe(0);
    await service.stop();
  });
});

describe('trigger', () => {
  it('sets the quick-action capability to the given value', async () => {
    const { service, devices } = setup();
    await service.trigger('lamp', true);
    await service.trigger('lock', false);
    expect(devices[0].sent).toEqual(['onoff=true']);
    expect(devices[1].sent).toEqual(['locked=false']);
  });

  it('always sends true to a button', async () => {
    const { service, devices } = setup();
    await service.trigger('alarm', false);
    expect(devices[2].sent).toEqual(['button=true']);
  });

  it('refuses devices without a settable boolean quick action, and non-boolean values', async () => {
    const ro = fakeDevice({ id: 'ro', caps: { onoff: { type: 'boolean', setable: false } }, ui: { quickAction: 'onoff' } });
    const { service } = setup([lamp(), sensor(), ro]);
    await expect(service.trigger('sensor', true)).rejects.toThrow(/no quick action/);
    await expect(service.trigger('ro', true)).rejects.toThrow(/can't be set/);
    await expect(service.trigger('lamp', 'on')).rejects.toThrow(/Invalid value/);
  });
});
