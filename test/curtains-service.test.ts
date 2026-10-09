import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import CurtainService, { CURTAINS_STATE_EVENT } from '../lib/CurtainService.js';

vi.mock('homey-api', () => homeyApiMock);

const curtain = (position = 0.4) => fakeDevice({
  id: 'curtain', name: 'Sofa window', class: 'curtain',
  caps: {
    windowcoverings_set: { type: 'number', value: position },
    windowcoverings_state: { type: 'enum', value: 'idle' },
    measure_battery: { type: 'number', value: 80 },
  },
});
const motor = () => fakeDevice({ id: 'motor', name: 'Terrace', class: 'blinds', caps: { windowcoverings_state: { type: 'enum', value: 'idle' } } });
const simple = () => fakeDevice({ id: 'simple', name: 'Skylight', class: 'sunshade', caps: { windowcoverings_closed: { type: 'boolean', value: true } } });
const lamp = () => fakeDevice({ id: 'lamp', name: 'Lamp', class: 'light', caps: { onoff: { type: 'boolean', value: true } } });

function setup(devices = [curtain(), motor(), simple(), lamp()]) {
  const homey = fakeHomey(fakeApi({ devices, zones: { z1: { name: 'Stue' } } }));
  const service = new CurtainService(homey, () => {});
  return { homey, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('getState', () => {
  it('returns the curtain capabilities in the order asked, with missing ones marked', async () => {
    const { service } = setup();
    expect(await service.getState(['motor', 'nope', 'curtain', 'simple', 'lamp'])).toEqual([
      { id: 'motor', name: 'Terrace', kind: 'blinds', zone: { id: 'z1', name: 'Stue' }, caps: { windowcoverings_state: { value: 'idle', setable: true } } },
      { id: 'nope', missing: true },
      {
        id: 'curtain', name: 'Sofa window', kind: 'curtain', zone: { id: 'z1', name: 'Stue' }, caps: {
          windowcoverings_set: { value: 0.4, setable: true },
          windowcoverings_state: { value: 'idle', setable: true },
        },
      },
      { id: 'simple', name: 'Skylight', kind: 'blinds', zone: { id: 'z1', name: 'Stue' }, caps: { windowcoverings_closed: { value: true, setable: true } } },
      { id: 'lamp', missing: true }, // no curtain capability
    ]);
  });
});

describe('tracking', () => {
  it('sends changes of every curtain capability as realtime events', async () => {
    const { service, homey, devices } = setup();
    await service.getState(['curtain']);
    devices[0].report('windowcoverings_state', 'up');
    devices[0].report('windowcoverings_set', 0.7);
    expect(homey.api.realtime).toHaveBeenCalledWith(CURTAINS_STATE_EVENT, { deviceId: 'curtain', capabilityId: 'windowcoverings_state', value: 'up' });
    expect(homey.api.realtime).toHaveBeenCalledWith(CURTAINS_STATE_EVENT, { deviceId: 'curtain', capabilityId: 'windowcoverings_set', value: 0.7 });
    expect(devices[0].listenerCount('measure_battery')).toBe(0);
  });

  it('picks up a rename, and stops tracking a deleted device', async () => {
    const { service, devices } = setup();
    const [c] = devices;
    await service.getState(['curtain']);
    c.name = 'Big window';
    expect(await service.getState(['curtain'])).toEqual([expect.objectContaining({ name: 'Big window' })]);
    devices.splice(0, 1);
    expect(await service.getState(['curtain'])).toEqual([{ id: 'curtain', missing: true }]);
    expect(c.listenerCount('windowcoverings_set')).toBe(0);
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, devices } = setup();
    service.start();
    await service.getState(['curtain']);
    expect(devices[0].listenerCount('windowcoverings_set')).toBe(1);
    await vi.advanceTimersByTimeAsync(11 * 60e3);
    expect(devices[0].listenerCount('windowcoverings_set')).toBe(0);
    await service.stop();
  });
});

describe('set', () => {
  it('opens and closes through the position when there is one', async () => {
    const { service, devices } = setup();
    await service.set('curtain', { action: 'open' });
    await service.set('curtain', { action: 'close' });
    await service.set('curtain', { position: 0.35 });
    expect(devices[0].sent).toEqual(['windowcoverings_set=1', 'windowcoverings_set=0', 'windowcoverings_set=0.35']);
  });

  it('moves a curtain without a position through its motor, and a plain one through open/closed', async () => {
    const { service, devices } = setup();
    await service.set('motor', { action: 'open' });
    await service.set('motor', { action: 'close' });
    await service.set('simple', { action: 'open' });
    expect(devices[1].sent).toEqual(['windowcoverings_state="up"', 'windowcoverings_state="down"']);
    expect(devices[2].sent).toEqual(['windowcoverings_closed=false']);
  });

  it('refuses what the device cannot do, and invalid values', async () => {
    const { service } = setup();
    await expect(service.set('curtain', { action: 'stop' })).rejects.toThrow('Invalid change');
    await expect(service.set('motor', { position: 0.5 })).rejects.toThrow('has no position');
    await expect(service.set('curtain', { position: 1.5 })).rejects.toThrow('Invalid position');
    await expect(service.set('curtain', { action: 'dance' })).rejects.toThrow('Invalid change');
    await expect(service.set('lamp', { action: 'open' })).rejects.toThrow("can't be opened or closed");
  });

  it('skips a capability that is not settable', async () => {
    const c = curtain();
    c.capabilitiesObj.windowcoverings_set.setable = false;
    const { service } = setup([c]);
    await service.set('curtain', { action: 'open' });
    expect(c.sent).toEqual(['windowcoverings_state="up"']);
  });
});
