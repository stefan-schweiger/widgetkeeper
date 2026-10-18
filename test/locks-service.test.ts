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

describe('open', () => {
  const loqed = () => fakeDevice({
    id: 'loqed', name: 'Loqed',
    caps: {
      locked: { type: 'boolean', value: true },
      open: { type: 'boolean', value: null, getable: false, title: 'Open' },
      onoff: { type: 'boolean', value: false, setable: false },
      measure_battery: { type: 'number', value: 90 },
    },
  });
  const matter = () => fakeDevice({
    id: 'matter', name: 'Back door',
    caps: { locked: { type: 'boolean', value: true }, open_lock: { type: 'boolean', value: false, title: 'Open lock' } },
  });
  const doorbell = () => fakeDevice({ id: 'bell', name: 'Doorbell', caps: { open: { type: 'boolean', value: null, getable: false } } });

  it('tells which locks have the Open capability', async () => {
    const { service } = setup([loqed(), matter(), garage()]);
    const state = await service.getState(['loqed', 'matter', 'garage'], 'open');
    expect(state.map(d => ('open' in d ? d.open : null))).toEqual(['open', null, null]);
    expect((await service.getState(['loqed']))[0]).not.toHaveProperty('open');
  });

  it('re-tracks when a lock gets a new on/off capability', async () => {
    const { service, devices } = setup([matter()]);
    expect((await service.getState(['matter'], 'open'))[0]).not.toHaveProperty('open');
    devices[0].capabilitiesObj.open = { id: 'open', type: 'boolean', value: null, getable: false };
    expect((await service.getState(['matter'], 'open'))[0]).toMatchObject({ open: 'open' });
  });

  it('opens a lock with a setable on/off capability, and nothing else', async () => {
    const { service, devices } = setup([loqed(), matter(), doorbell(), lock()]);
    await service.open('loqed', 'open');
    await service.open('matter', 'open_lock');
    expect(devices[0].sent).toEqual(['open=true']);
    expect(devices[1].sent).toEqual(['open_lock=true']);
    await expect(service.open('loqed', 'locked')).rejects.toThrow();
    await expect(service.open('loqed', 'onoff')).rejects.toThrow(); // not setable
    await expect(service.open('loqed', 'measure_battery')).rejects.toThrow(); // not on/off
    await expect(service.open('loqed', 'open_lock')).rejects.toThrow(); // not on this lock
    await expect(service.open('front', 'alarm_contact')).rejects.toThrow();
    await expect(service.open('bell', 'open')).rejects.toThrow(/isn't a lock/);
    await expect(service.open('loqed', 42)).rejects.toThrow();
    expect(devices.flatMap(d => d.sent)).toEqual(['open=true', 'open_lock=true']);
  });

  it('lists every lock’s on/off capabilities by id, buttons first, after None', async () => {
    const second = loqed();
    second.id = 'loqed2';
    second.name = 'Garden gate';
    const { service } = setup([loqed(), matter(), second, doorbell(), lock()]);
    expect(await service.listOpenCapabilities('')).toEqual([
      { name: 'None', id: 'none' },
      { name: 'Open', description: 'open · Garden gate, Loqed', id: 'open' },
      { name: 'Open lock', description: 'open_lock · Back door', id: 'open_lock' },
    ]);
    expect((await service.listOpenCapabilities('back')).map(i => i.id)).toEqual(['open_lock']);
  });
});
