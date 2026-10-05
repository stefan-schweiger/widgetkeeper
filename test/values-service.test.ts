import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import ValueService, { parseSlot, VALUES_STATE_EVENT, valueCaps } from '../lib/ValueService.js';

vi.mock('homey-api', () => homeyApiMock);

const sensor = () => fakeDevice({
  id: 'sensor', name: 'Stue', zone: 'z1',
  caps: {
    measure_temperature: { type: 'number', value: 21.5, title: 'Temperature', units: '°C', decimals: 1 },
    measure_humidity: { type: 'number', value: 48, title: 'Humidity', units: '%' },
  },
});
const aircon = () => fakeDevice({
  id: 'ac', name: 'Aircon', zone: 'z2',
  caps: {
    onoff: { type: 'boolean', value: true, title: 'Turned on' },
    mode: { type: 'enum', value: 'heat', title: 'Mode', values: [{ id: 'heat', title: 'Heat' }, { id: 'cool', title: 'Cool' }] },
    secret: { type: 'object' as any, value: {} },
  },
});

function setup(devices = [sensor(), aircon()]) {
  const homey = fakeHomey(fakeApi({ devices, zones: { z1: { name: 'Living room' }, z2: { name: 'Bedroom' } } }));
  const service = new ValueService(homey, () => {});
  return { homey, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('parseSlot', () => {
  it('splits on the first colon, so sub-capability ids survive', () => {
    expect(parseSlot('dev:measure_temperature.inside')).toEqual({ deviceId: 'dev', capabilityId: 'measure_temperature.inside' });
    expect(parseSlot('nocolon')).toBeNull();
    expect(parseSlot(':cap')).toBeNull();
    expect(parseSlot('dev:')).toBeNull();
  });
});

describe('valueCaps', () => {
  it('keeps numbers, booleans, enums and strings', () => {
    expect(valueCaps(aircon())).toEqual(['onoff', 'mode']);
  });
});

describe('listSlots', () => {
  it('lists every device × capability pair, sorted, with zone and units', async () => {
    const { service } = setup();
    expect(await service.listSlots('')).toEqual([
      { name: 'Aircon · Mode', description: 'Bedroom', id: 'ac:mode' },
      { name: 'Aircon · Turned on', description: 'Bedroom', id: 'ac:onoff' },
      { name: 'Stue · Humidity', description: 'Living room · %', id: 'sensor:measure_humidity' },
      { name: 'Stue · Temperature', description: 'Living room · °C', id: 'sensor:measure_temperature' },
    ]);
  });

  it('filters on the name, the zone and the capability id', async () => {
    const { service } = setup();
    expect((await service.listSlots('temp')).map(i => i.id)).toEqual(['sensor:measure_temperature']);
    expect((await service.listSlots('bedroom')).map(i => i.id)).toEqual(['ac:mode', 'ac:onoff']);
  });
});

describe('getState', () => {
  it('returns the slots in order, with missing ones marked', async () => {
    const { service } = setup();
    const state = await service.getState(['ac:mode', 'nope:onoff', 'sensor:measure_temperature', 'sensor:gone', 'bad']);
    expect(state).toEqual([
      {
        deviceId: 'ac', capabilityId: 'mode', name: 'Aircon', value: 'heat',
        capability: { title: 'Mode', type: 'enum', units: null, decimals: null, min: null, max: null, values: [{ id: 'heat', title: 'Heat' }, { id: 'cool', title: 'Cool' }], icon: null },
      },
      { deviceId: 'nope', capabilityId: 'onoff', missing: true },
      {
        deviceId: 'sensor', capabilityId: 'measure_temperature', name: 'Stue', value: 21.5,
        capability: { title: 'Temperature', type: 'number', units: '°C', decimals: 1, min: null, max: null, values: null, icon: null },
      },
      { deviceId: 'sensor', capabilityId: 'gone', missing: true },
    ]);
  });

  it('pushes changes over realtime and serves the latest value', async () => {
    const { service, homey, devices } = setup();
    await service.getState(['sensor:measure_temperature']);
    devices[0].report('measure_temperature', 22);
    expect(homey.api.realtime).toHaveBeenCalledWith(VALUES_STATE_EVENT, { deviceId: 'sensor', capabilityId: 'measure_temperature', value: 22 });
    const [s] = await service.getState(['sensor:measure_temperature']);
    expect(s).toMatchObject({ value: 22 });
  });

  it('tracks a slot once, however many tiles show it', async () => {
    const { service, devices } = setup();
    await service.getState(['sensor:measure_temperature', 'sensor:measure_temperature']);
    await service.getState(['sensor:measure_temperature']);
    expect(devices[0].listenerCount('measure_temperature')).toBe(1);
  });

  it('picks up a rename on the next request', async () => {
    const { service, devices } = setup();
    await service.getState(['sensor:measure_humidity']);
    devices[0].name = 'Living room';
    const [s] = await service.getState(['sensor:measure_humidity']);
    expect(s).toMatchObject({ name: 'Living room' });
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, devices } = setup();
    service.start();
    await service.getState(['sensor:measure_humidity']);
    vi.advanceTimersByTime(12 * 60e3);
    expect(devices[0].listenerCount('measure_humidity')).toBe(0);
    await service.stop();
  });
});
