import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import LightService, { LIGHTS_STATE_EVENT } from '../lib/LightService.js';

vi.mock('homey-api', () => homeyApiMock);

const bulb = (on = true, dim = 0.5) => fakeDevice({
  id: 'bulb', name: 'Kitchen',
  caps: {
    onoff: { type: 'boolean', value: on },
    dim: { type: 'number', value: dim },
    light_temperature: { type: 'number', value: 0.3 },
    light_mode: { type: 'enum', value: 'color' },
    light_hue: { type: 'number', value: 0.1 },
    measure_power: { type: 'number', value: 7 },
  },
});
const dimmer = (dim = 0.4) => fakeDevice({ id: 'dimmer', name: 'Spots', caps: { dim: { type: 'number', value: dim } } });
const plug = () => fakeDevice({ id: 'plug', name: 'Plug', caps: { onoff: { type: 'boolean', value: false } } });

function setup(devices = [bulb(), dimmer(), plug()]) {
  const homey = fakeHomey(fakeApi({ devices }));
  const service = new LightService(homey, () => {});
  return { homey, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('getState', () => {
  it('returns the light capabilities in the order asked, with missing ones marked', async () => {
    const { service } = setup();
    expect(await service.getState(['dimmer', 'nope', 'bulb', 'plug'])).toEqual([
      { id: 'dimmer', name: 'Spots', icon: null, caps: { dim: { value: 0.4, setable: true } } },
      { id: 'nope', missing: true },
      {
        id: 'bulb', name: 'Kitchen', icon: null, caps: {
          onoff: { value: true, setable: true },
          dim: { value: 0.5, setable: true },
          light_temperature: { value: 0.3, setable: true },
          light_hue: { value: 0.1, setable: true },
          light_mode: { value: 'color', setable: true },
        },
      },
      { id: 'plug', missing: true }, // no dim
    ]);
  });
});

describe('tracking', () => {
  it('sends changes of every light capability as realtime events', async () => {
    const { service, homey, devices } = setup();
    await service.getState(['bulb']);
    devices[0].report('dim', 0.8);
    devices[0].report('light_temperature', 0.9);
    expect(homey.api.realtime).toHaveBeenCalledWith(LIGHTS_STATE_EVENT, { deviceId: 'bulb', capabilityId: 'dim', value: 0.8 });
    expect(homey.api.realtime).toHaveBeenCalledWith(LIGHTS_STATE_EVENT, { deviceId: 'bulb', capabilityId: 'light_temperature', value: 0.9 });
    expect(devices[0].listenerCount('measure_power')).toBe(0);
  });

  it('picks up a rename, and stops tracking a deleted device', async () => {
    const { service, devices } = setup();
    const [b] = devices;
    await service.getState(['bulb']);
    b.name = 'Kitchen table';
    expect(await service.getState(['bulb'])).toEqual([expect.objectContaining({ name: 'Kitchen table' })]);
    devices.splice(0, 1);
    expect(await service.getState(['bulb'])).toEqual([{ id: 'bulb', missing: true }]);
    expect(b.listenerCount('dim')).toBe(0);
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, devices } = setup();
    service.start();
    await service.getState(['bulb']);
    await vi.advanceTimersByTimeAsync(11 * 60e3);
    expect(devices[0].listenerCount('dim')).toBe(0);
    await service.stop();
  });
});

describe('set', () => {
  it('turns off with brightness 0, keeping the brightness', async () => {
    const { service, devices } = setup();
    await service.set('bulb', { dim: 0 });
    expect(devices[0].sent).toEqual(['onoff=false']);
  });

  it('sets the brightness, and turns the light on when it was off', async () => {
    const { service, devices } = setup([bulb(false)]);
    await service.set('bulb', { dim: 0.7 });
    expect(devices[0].sent).toEqual(['dim=0.7', 'onoff=true']);
  });

  it("doesn't resend onoff to a light that is on", async () => {
    const { service, devices } = setup();
    await service.set('bulb', { dim: 0.2 });
    expect(devices[0].sent).toEqual(['dim=0.2']);
  });

  it('switches to temperature mode before setting the temperature', async () => {
    const { service, devices } = setup([bulb(false)]);
    await service.set('bulb', { temperature: 0.8 });
    expect(devices[0].sent).toEqual(['light_mode="temperature"', 'light_temperature=0.8', 'onoff=true']);
  });

  it('turns lights without onoff off and on through dim, back to the last brightness', async () => {
    const { service, devices } = setup();
    await service.getState(['dimmer']);
    await service.set('dimmer', { onoff: false });
    devices[1].report('dim', 0);
    await service.set('dimmer', { onoff: true });
    await service.set('dimmer', { dim: 0 });
    expect(devices[1].sent).toEqual(['dim=0', 'dim=0.4', 'dim=0']);
  });

  it('refuses bad values and devices without dim', async () => {
    const { service } = setup();
    await expect(service.set('bulb', { dim: 2 })).rejects.toThrow(/Invalid brightness/);
    await expect(service.set('bulb', { onoff: 'on' })).rejects.toThrow(/Invalid on\/off/);
    await expect(service.set('dimmer', { temperature: 0.5 })).rejects.toThrow(/colour temperature/);
    await expect(service.set('plug', { dim: 0.5 })).rejects.toThrow(/no dim/);
    await expect(service.set('bulb', {})).rejects.toThrow(/Nothing to set/);
  });
});
