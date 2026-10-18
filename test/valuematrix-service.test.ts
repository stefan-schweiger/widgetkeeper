import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import ValueMatrixService, { VM_STATE_EVENT, matrixCaps } from '../lib/ValueMatrixService.js';

vi.mock('homey-api', () => homeyApiMock);

const airthings = () => fakeDevice({
  id: 'air', name: 'View Plus', zone: 'bed',
  caps: {
    measure_temperature: { type: 'number', value: 21.4, units: '°C', decimals: 1, title: 'Temperature' },
    measure_humidity: { type: 'number', value: 44, units: '%', decimals: 0, title: 'Humidity' },
    measure_co2: { type: 'number', value: 720, units: 'ppm', title: 'CO2' },
    measure_radon_display: { type: 'string', value: '54 Bq/m³' },
    alarm_co2: { type: 'boolean', value: false },
  },
});
const thermometer = () => fakeDevice({
  id: 'thermo', name: 'Thermometer', zone: 'kitchen',
  caps: { measure_temperature: { type: 'number', value: 22.8, units: '°F', decimals: 2, title: 'Temp' } },
});
const ZONES = { bed: { name: 'Bedroom' }, kitchen: { name: 'Kitchen' } };

function setup(devices = [airthings(), thermometer()]) {
  const api = fakeApi({ devices, zones: ZONES });
  const homey = fakeHomey(api);
  const service = new ValueMatrixService(homey, () => {});
  return { homey, api, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('matrixCaps', () => {
  it('takes readable numbers only', () => {
    const d = fakeDevice({ caps: { a: { type: 'number', value: 1 }, b: { type: 'string' }, c: { type: 'boolean' } } });
    d.capabilitiesObj.d = { id: 'd', type: 'number', getable: false };
    expect(matrixCaps(d)).toEqual(['a']);
  });
});

describe('getState', () => {
  it('gives each device its zone and a value per column it has, in the order asked; a deleted one is missing', async () => {
    const { service } = setup();
    const state = await service.getState(['thermo', 'gone', 'air'], ['measure_temperature', 'measure_co2']);
    expect(state.devices).toEqual([
      { id: 'thermo', name: 'Thermometer', zone: { id: 'kitchen', name: 'Kitchen' }, values: { measure_temperature: 22.8 } },
      { id: 'gone', missing: true },
      { id: 'air', name: 'View Plus', zone: { id: 'bed', name: 'Bedroom' }, values: { measure_temperature: 21.4, measure_co2: 720 } },
    ]);
  });

  it('describes each column from the first device in the order picked that has it, null when none does', async () => {
    const { service } = setup();
    const state = await service.getState(['thermo', 'air'], ['measure_temperature', 'measure_co2', 'measure_pm25']);
    expect(state.columns).toEqual([
      { capabilityId: 'measure_temperature', title: 'Temp', units: '°F', decimals: 2 },
      { capabilityId: 'measure_co2', title: 'CO2', units: 'ppm', decimals: null },
      null,
    ]);
  });

  it("leaves out a capability that isn't a number, and reads a value that isn't one as null", async () => {
    const d = fakeDevice({ id: 'd', caps: { alarm_co2: { type: 'boolean', value: true }, measure_co2: { type: 'number', value: null } } });
    const { service } = setup([d]);
    expect((await service.getState(['d'], ['alarm_co2', 'measure_co2'])).devices).toEqual([
      { id: 'd', name: 'Aircon', zone: null, values: { measure_co2: null } },
    ]);
  });

  it('reads a capability a device gains, and drops one it loses', async () => {
    const { service, devices } = setup();
    const thermo = devices[1];
    expect((await service.getState(['thermo'], ['measure_humidity'])).devices).toMatchObject([{ values: {} }]);
    thermo.capabilitiesObj.measure_humidity = { id: 'measure_humidity', type: 'number', value: 51 };
    expect((await service.getState(['thermo'], ['measure_humidity'])).devices).toMatchObject([{ values: { measure_humidity: 51 } }]);
    expect(thermo.listenerCount('measure_humidity')).toBe(1);
    delete thermo.capabilitiesObj.measure_humidity;
    expect((await service.getState(['thermo'], ['measure_humidity'])).devices).toMatchObject([{ values: {} }]);
    expect(thermo.listenerCount('measure_humidity')).toBe(0);
  });

  it('sends each change as an event, and the next read has it', async () => {
    const { service, homey, devices } = setup();
    await service.getState(['air'], ['measure_co2']);
    devices[0].report('measure_co2', 1400);
    expect(homey.api.realtime).toHaveBeenCalledWith(VM_STATE_EVENT, { deviceId: 'air', capabilityId: 'measure_co2', value: 1400 });
    expect((await service.getState(['air'], ['measure_co2'])).devices).toMatchObject([{ values: { measure_co2: 1400 } }]);
  });

  it('listens to the columns only, and stops when a device goes', async () => {
    const { service, devices } = setup();
    const air = devices[0];
    await service.getState(['air'], ['measure_co2', 'measure_pm25']);
    expect(air.makeCapabilityInstance.mock.calls.map(c => c[0])).toEqual(['measure_co2']);
    devices.splice(0, 1);
    expect((await service.getState(['air'], ['measure_co2'])).devices).toEqual([{ id: 'air', missing: true }]);
    expect(air.listenerCount('measure_co2')).toBe(0);
  });
});

describe('listColumns', () => {
  it('lists every number capability once, by title, with its units and how many devices have it; None first', async () => {
    const { service } = setup();
    const items = await service.listColumns('');
    expect(items[0]).toEqual({ name: 'None', id: 'none' });
    expect(items.slice(1)).toEqual([
      { name: 'CO2', description: 'ppm · 1 devices', id: 'measure_co2' },
      { name: 'Humidity', description: '% · 1 devices', id: 'measure_humidity' },
      { name: 'Temperature', description: '°C · 2 devices', id: 'measure_temperature' },
    ]);
  });

  it('matches the query against the title, id or units', async () => {
    const { service } = setup();
    expect((await service.listColumns('ppm')).map(i => i.id)).toEqual(['measure_co2']);
    expect((await service.listColumns('humid')).map(i => i.id)).toEqual(['measure_humidity']);
  });
});
