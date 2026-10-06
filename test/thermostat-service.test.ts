import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, FakeDeviceOptions, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import ThermostatService, { STATE_EVENT } from '../lib/ThermostatService.js';

vi.mock('homey-api', () => homeyApiMock);

const MODE = { type: 'enum', title: 'Mode', values: [{ id: 'heat', title: 'Heat' }, { id: 'cool', title: 'Cool' }, { id: 'dry', title: 'Dry' }, { id: 'off', title: 'Off' }] };
const FAN = { type: 'enum', title: 'Fan speed', values: [{ id: 'auto', title: 'Auto' }, { id: 'low', title: 'Low' }, { id: 'high', title: 'High' }] };

function aircon(caps: FakeDeviceOptions['caps'] = {}, opts: Partial<FakeDeviceOptions> = {}) {
  return fakeDevice({
    caps: {
      onoff: { value: true },
      thermostat_mode: { ...MODE, value: 'cool' },
      target_temperature: { value: 20, min: 16, max: 30, step: 0.5, units: '°C' },
      measure_temperature: { value: 23, setable: false },
      fan_speed: { ...FAN, value: 'auto' },
      ...caps,
    },
    ...opts,
  });
}

function setup(devices = [aircon()], zones = {}) {
  const homey = fakeHomey(fakeApi({ devices, zones }));
  const service = new ThermostatService(homey, () => {});
  return { homey, service, device: devices[0] };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('apply', () => {
  it('sends onoff=true first, then the rest in the given order', async () => {
    const { service, device } = setup([aircon({ onoff: { value: false } })]);
    const done = service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'heat' },
      { capabilityId: 'target_temperature', value: 22 },
      { capabilityId: 'onoff', value: true },
    ]);
    await vi.runAllTimersAsync();
    await done;
    expect(device.sent).toEqual(['onoff=true', 'thermostat_mode="heat"', 'target_temperature=22']);
  });

  it('sends onoff=false last', async () => {
    const { service, device } = setup();
    const done = service.apply('dev1', [
      { capabilityId: 'onoff', value: false },
      { capabilityId: 'thermostat_mode', value: 'heat' },
    ]);
    await vi.runAllTimersAsync();
    await done;
    expect(device.sent).toEqual(['thermostat_mode="heat"', 'onoff=false']);
  });

  it('skips values the device already has', async () => {
    const { service, device } = setup();
    const done = service.apply('dev1', [
      { capabilityId: 'onoff', value: true },
      { capabilityId: 'thermostat_mode', value: 'cool' },
      { capabilityId: 'fan_speed', value: 'high' },
    ]);
    await vi.runAllTimersAsync();
    await done;
    expect(device.sent).toEqual(['fan_speed="high"']);
  });

  it('checks each value against the device as it is after the previous one', async () => {
    // Per-mode setpoints: switching to cool brings back the cool setpoint, 24°.
    const device = aircon({ thermostat_mode: { ...MODE, value: 'heat' }, target_temperature: { value: 21, min: 16, max: 30, step: 0.5 } });
    const report = device.report;
    device.report = (id: string, value: unknown) => {
      report(id, value);
      if (id === 'thermostat_mode' && value === 'cool') report('target_temperature', 24);
    };
    const { service } = setup([device]);
    const done = service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'cool' },
      { capabilityId: 'target_temperature', value: 21 },
    ]);
    await vi.runAllTimersAsync();
    await done;
    expect(device.sent).toEqual(['thermostat_mode="cool"', 'target_temperature=21']);
  });

  it('rejects capabilities the device lacks or that cannot be set, before sending anything', async () => {
    const { service, device } = setup([aircon({ swing: { type: 'enum', setable: false, values: [{ id: 'on' }] } })]);
    await expect(service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'heat' },
      { capabilityId: 'dim', value: 1 },
    ])).rejects.toThrow('Aircon has no dim capability');
    await expect(service.apply('dev1', [{ capabilityId: 'measure_temperature', value: 1 }])).rejects.toThrow('not settable');
    await expect(service.apply('dev1', [{ capabilityId: 'swing', value: 'on' }])).rejects.toThrow('not settable');
    expect(device.sent).toEqual([]);
  });

  it('refuses devices that are not thermostats', async () => {
    const lamp = fakeDevice({ id: 'lamp', name: 'Lamp', caps: { onoff: { value: false } } });
    const { service } = setup([lamp]);
    await expect(service.apply('lamp', [{ capabilityId: 'onoff', value: true }])).rejects.toThrow('Lamp is not a thermostat');
    expect(lamp.sent).toEqual([]);
  });

  it('waits for each value to be reported before sending the next', async () => {
    const { service, device } = setup([aircon({}, { reportDelay: 1000 })]);
    const done = service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'heat' },
      { capabilityId: 'fan_speed', value: 'high' },
    ]);
    await vi.advanceTimersByTimeAsync(900);
    expect(device.sent).toEqual(['thermostat_mode="heat"']);
    await vi.advanceTimersByTimeAsync(400); // reported at 1000, seen by the next 300 ms poll
    expect(device.sent).toEqual(['thermostat_mode="heat"', 'fan_speed="high"']);
    await done;
  });

  it('gives up waiting after 4 s and continues', async () => {
    const { service, device } = setup([aircon({}, { reportDelay: null })]);
    const done = service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'heat' },
      { capabilityId: 'fan_speed', value: 'high' },
    ]);
    await vi.advanceTimersByTimeAsync(3900);
    expect(device.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(device.sent).toEqual(['thermostat_mode="heat"', 'fan_speed="high"']);
    await done;
  });

  it('does not wait after the last value', async () => {
    const { service, device } = setup([aircon({}, { reportDelay: null })]);
    await service.apply('dev1', [{ capabilityId: 'fan_speed', value: 'high' }]);
    expect(device.sent).toEqual(['fan_speed="high"']);
  });

  it('lets a newer apply supersede a running one without interleaving', async () => {
    const { service, device } = setup([aircon({}, { reportDelay: null })]);
    const first = service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'heat' },
      { capabilityId: 'target_temperature', value: 25 },
      { capabilityId: 'fan_speed', value: 'high' },
    ]);
    await vi.advanceTimersByTimeAsync(500); // the first is waiting for its mode to be confirmed
    const second = service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'dry' },
      { capabilityId: 'target_temperature', value: 18 },
    ]);
    await vi.runAllTimersAsync();
    await expect(first).resolves.toBeUndefined();
    await second;
    expect(device.sent).toEqual(['thermostat_mode="heat"', 'thermostat_mode="dry"', 'target_temperature=18']);
  });

  it('propagates a failed set and stops there', async () => {
    const { service, device } = setup();
    device.setCapabilityValue.mockRejectedValueOnce(new Error('Driver says no'));
    const done = service.apply('dev1', [
      { capabilityId: 'thermostat_mode', value: 'heat' },
      { capabilityId: 'fan_speed', value: 'high' },
    ]);
    await expect(done).rejects.toThrow('Driver says no');
    expect(device.setCapabilityValue).toHaveBeenCalledTimes(1);
  });
});

describe('listTemperatures', () => {
  it('lists the range in steps, after "Don\'t change"', async () => {
    const { service } = setup([aircon({ target_temperature: { value: 20, min: 16, max: 18, step: 0.5, units: '°C' } })]);
    const items = await service.listTemperatures('dev1', '');
    expect(items.map(i => i.name)).toEqual(["Don't change", '16 °C', '16.5 °C', '17 °C', '17.5 °C', '18 °C']);
    expect(items[1]).toEqual({ name: '16 °C', capabilityId: 'target_temperature', value: 16 });
  });

  it('rounds away float drift and includes the max', async () => {
    const { service } = setup([aircon({ target_temperature: { value: 20, min: 16, max: 17, step: 0.1 } })]);
    const values = (await service.listTemperatures('dev1', '')).slice(1).map(i => i.value);
    expect(values).toEqual([16, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 17]);
  });

  it('caps the list at 200 items', async () => {
    const { service } = setup([aircon({ target_temperature: { value: 20, min: 0, max: 100, step: 0.1 } })]);
    expect(await service.listTemperatures('dev1', '')).toHaveLength(201);
  });

  it('falls back to 16–30 °C in 0.5 steps', async () => {
    const { service } = setup([aircon({ target_temperature: { value: 20, step: 0 } })]);
    const items = (await service.listTemperatures('dev1', '')).slice(1);
    expect(items).toHaveLength(29);
    expect(items[0].name).toBe('16 °C');
    expect(items.at(-1)!.name).toBe('30 °C');
  });

  it('filters by the query but keeps "Don\'t change"', async () => {
    const { service } = setup();
    const names = (await service.listTemperatures('dev1', '22')).map(i => i.name);
    expect(names).toEqual(["Don't change", '22 °C', '22.5 °C']);
  });

  it('needs a device', async () => {
    const { service } = setup();
    await expect(service.listTemperatures(undefined, '')).rejects.toThrow('Select a device first');
  });
});

describe('listEnumOptions', () => {
  it('lists every value of every settable enum', async () => {
    const { service } = setup([aircon({ swing: { type: 'enum', setable: false, values: [{ id: 'on' }] } })]);
    const items = await service.listEnumOptions('dev1', '');
    expect(items.map(i => i.name)).toEqual([
      "Don't change", 'Mode: Heat', 'Mode: Cool', 'Mode: Dry', 'Mode: Off', 'Fan speed: Auto', 'Fan speed: Low', 'Fan speed: High',
    ]);
    expect(items[1]).toEqual({ name: 'Mode: Heat', capabilityId: 'thermostat_mode', value: 'heat' });
  });

  it('filters by the query', async () => {
    const { service } = setup();
    expect((await service.listEnumOptions('dev1', 'high')).map(i => i.name)).toEqual(["Don't change", 'Fan speed: High']);
  });
});

describe('listDevices', () => {
  it('lists thermostats by name, with their zone, filtered by the query', async () => {
    const devices = [
      fakeDevice({ id: 'b', name: 'Bedroom AC', zone: 'up', caps: { thermostat_mode: MODE } }),
      fakeDevice({ id: 'a', name: 'Attic radiator', zone: 'up', caps: { target_temperature: { value: 20 } } }),
      fakeDevice({ id: 'l', name: 'Lamp', zone: 'down', caps: { onoff: {} } }),
    ];
    const { service } = setup(devices, { up: { name: 'Upstairs' }, down: { name: 'Downstairs' } });
    expect(await service.listDevices('')).toEqual([
      { name: 'Attic radiator', description: 'Upstairs', id: 'a' },
      { name: 'Bedroom AC', description: 'Upstairs', id: 'b' },
    ]);
    expect((await service.listDevices('bed')).map(d => d.id)).toEqual(['b']);
    expect((await service.listDevices('upstairs')).map(d => d.id)).toEqual(['a', 'b']);
  });
});

describe('state tracking', () => {
  it('returns the relevant capabilities and their info', async () => {
    const { service } = setup([aircon({ dim: { value: 1 } })]);
    const state = await service.getState('dev1');
    expect(state.name).toBe('Aircon');
    expect(state.icon).toBeNull();
    expect(Object.keys(state.values).sort()).toEqual(['fan_speed', 'measure_temperature', 'onoff', 'target_temperature', 'thermostat_mode']);
    expect(state.caps.fan_speed).toEqual({ title: 'Fan speed', units: null, values: [{ id: 'auto', title: 'Auto' }, { id: 'low', title: 'Low' }, { id: 'high', title: 'High' }] });
  });

  it('sends changes over realtime and keeps the state current', async () => {
    const { service, device, homey } = setup();
    await service.getState('dev1');
    device.report('target_temperature', 24);
    expect(homey.api.realtime).toHaveBeenCalledWith(STATE_EVENT, { deviceId: 'dev1', capabilityId: 'target_temperature', value: 24 });
    expect((await service.getState('dev1')).values.target_temperature).toBe(24);
  });

  it('re-reads a tracked device on each request', async () => {
    const { service, device } = setup();
    await service.getState('dev1');
    device.name = 'Bedroom aircon';
    device.capabilitiesObj.fan_speed.value = 'high'; // a change the capability instance missed
    const state = await service.getState('dev1');
    expect(state).toMatchObject({ name: 'Bedroom aircon', values: { fan_speed: 'high' } });
    expect(device.listenerCount('onoff')).toBe(1);
  });

  it('tracks again when the capabilities changed', async () => {
    const { service, device } = setup();
    await service.getState('dev1');
    device.capabilities.push('swing');
    device.capabilitiesObj.swing = { id: 'swing', type: 'enum', values: [{ id: 'on' }, { id: 'off' }], value: 'off' };
    const state = await service.getState('dev1');
    expect('caps' in state && state.caps.swing).toBeTruthy();
    expect(device.listenerCount('onoff')).toBe(1);
    expect(device.listenerCount('swing')).toBe(1);
  });

  it('reports a deleted device as missing and stops tracking it', async () => {
    const devices = [aircon()];
    const { service, device } = setup(devices);
    await service.getState('dev1');
    devices.length = 0;
    expect(await service.getState('dev1')).toEqual({ missing: true });
    expect(device.listenerCount('onoff')).toBe(0);
  });

  it('tracks each device once, even with concurrent requests', async () => {
    const { service, device } = setup();
    await Promise.all([service.getState('dev1'), service.getState('dev1')]);
    expect(device.listenerCount('onoff')).toBe(1);
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, device } = setup();
    service.start();
    await service.getState('dev1');
    await vi.advanceTimersByTimeAsync(9 * 60e3);
    await service.getState('dev1'); // a widget re-fetch keeps it alive
    await vi.advanceTimersByTimeAsync(9 * 60e3);
    expect(device.listenerCount('onoff')).toBe(1);
    await vi.advanceTimersByTimeAsync(2 * 60e3);
    expect(device.listenerCount('onoff')).toBe(0);
    await service.stop();
  });
});
