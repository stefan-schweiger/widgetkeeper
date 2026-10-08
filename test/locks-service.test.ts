import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import LockService, { LOCKS_STATE_EVENT } from '../lib/LockService.js';

vi.mock('homey-api', () => homeyApiMock);

const lock = () => fakeDevice({
  id: 'front', name: 'Front door',
  caps: {
    locked: { type: 'boolean', value: true, lastUpdated: '2026-10-06T16:00:00.000Z' },
    alarm_contact: { type: 'boolean', value: false, setable: false },
    measure_battery: { type: 'number', value: 80 },
  },
});
const garage = () => fakeDevice({ id: 'garage', name: 'Garage', caps: { garagedoor_closed: { type: 'boolean', value: false } } });
const lamp = () => fakeDevice({ id: 'lamp', name: 'Lamp', caps: { onoff: { type: 'boolean', value: true } } });

function setup(devices = [lock(), garage(), lamp()]) {
  const homey = fakeHomey(fakeApi({ devices }));
  const service = new LockService(homey, () => {});
  return { homey, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('getState', () => {
  it('returns the lock, contact and garage door capabilities in the order asked', async () => {
    const { service } = setup();
    expect(await service.getState(['garage', 'nope', 'front', 'lamp'])).toEqual([
      { id: 'garage', name: 'Garage', icon: null, caps: { garagedoor_closed: { value: false, setable: true, lastUpdated: null } } },
      { id: 'nope', missing: true },
      {
        id: 'front', name: 'Front door', icon: null, caps: {
          locked: { value: true, setable: true, lastUpdated: Date.parse('2026-10-06T16:00:00.000Z') },
          alarm_contact: { value: false, setable: false, lastUpdated: null }, // a sensor: never settable
        },
      },
      { id: 'lamp', missing: true }, // nothing to show
    ]);
  });
});

describe('tracking', () => {
  it('sends changes as realtime events with their time', async () => {
    const { service, homey, devices } = setup();
    await service.getState(['front']);
    devices[0].report('locked', false);
    expect(homey.api.realtime).toHaveBeenCalledWith(LOCKS_STATE_EVENT, { deviceId: 'front', capabilityId: 'locked', value: false, t: Date.now() });
    expect(devices[0].listenerCount('measure_battery')).toBe(0);
    expect((await service.getState(['front']))[0]).toMatchObject({ caps: { locked: { value: false } } });
  });

  it('picks up a rename, and stops tracking a deleted device', async () => {
    const { service, devices } = setup();
    const [front] = devices;
    await service.getState(['front']);
    front.name = 'Hoveddør';
    expect(await service.getState(['front'])).toEqual([expect.objectContaining({ name: 'Hoveddør' })]);
    devices.splice(0, 1);
    expect(await service.getState(['front'])).toEqual([{ id: 'front', missing: true }]);
    expect(front.listenerCount('locked')).toBe(0);
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, devices } = setup();
    service.start();
    await service.getState(['front']);
    expect(devices[0].listenerCount('locked')).toBe(1);
    await vi.advanceTimersByTimeAsync(11 * 60e3);
    expect(devices[0].listenerCount('locked')).toBe(0);
    await service.stop();
  });
});

describe('set', () => {
  it('locks a lock and closes a garage door', async () => {
    const { service, devices } = setup();
    await service.set('front', 'locked', true);
    await service.set('garage', 'garagedoor_closed', true);
    expect(devices[0].sent).toEqual(['locked=true']);
    expect(devices[1].sent).toEqual(['garagedoor_closed=true']);
  });

  it('sets nothing else', async () => {
    const { service, devices } = setup();
    await expect(service.set('front', 'alarm_contact', true)).rejects.toThrow();
    await expect(service.set('lamp', 'onoff', false)).rejects.toThrow();
    await expect(service.set('front', 'locked', 'yes')).rejects.toThrow();
    await expect(service.set('lamp', 'locked', true)).rejects.toThrow(/has no/);
    expect(devices.flatMap(d => d.sent)).toEqual([]);
  });
});
