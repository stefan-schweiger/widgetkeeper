import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import RoomHealthService, { RH_STATE_EVENT, healthCaps } from '../lib/RoomHealthService.js';

vi.mock('homey-api', () => homeyApiMock);

// The test Homey's sensors (2026-10-16): an Airthings View with radon twice (Bq/m³ and pCi/L) and VOC in ppb, an
// Aqara air monitor whose VOC is `measure_VOC`, and a heat pump with only sub-capabilities.
const airthings = () => fakeDevice({
  id: 'air', name: 'View Plus', zone: 'bed',
  caps: {
    measure_radon_display: { type: 'string', value: '54 Bq/m³' },
    measure_radon: { type: 'number', value: 54, units: 'Bq/m³' },
    measure_radon_us: { type: 'number', value: 1.46, units: 'pCi/L' },
    measure_co2: { type: 'number', value: 590, units: 'ppm' },
    alarm_co2: { type: 'boolean', value: false },
    measure_voc: { type: 'number', value: 514, units: 'ppb' },
    measure_pm25: { type: 'number', value: 4, units: 'μg/m³' },
    measure_pm1: { type: 'number', value: 1, units: 'μg/m³' },
    measure_humidity: { type: 'number', value: 49, units: '%' },
    measure_temperature: { type: 'number', value: 23.2, units: '°C' },
    measure_battery: { type: 'number', value: 80, units: '%' },
  },
});
const aqara = () => fakeDevice({
  id: 'aqara', name: 'Air monitor', zone: 'kitchen',
  caps: {
    measure_temperature: { type: 'number', value: 22.4, units: '°C' },
    measure_humidity: { type: 'number', value: 61.5, units: '%' },
    measure_VOC: { type: 'number', value: 169, units: 'ppb' },
    measure_AirQualityLevel: { type: 'string', value: '2' },
  },
});
const heatPump = () => fakeDevice({
  id: 'pump', name: 'Heat pump', zone: 'living',
  caps: {
    'measure_temperature.outdoor': { type: 'number', value: 8, units: '°C' },
    'measure_temperature.room': { type: 'number', value: 21.5, units: '°C' },
    'measure_temperature.supply_line': { type: 'number', value: 35, units: '°C' },
  },
});
const ZONES = { bed: { name: 'Bedroom' }, kitchen: { name: 'Kitchen' }, living: { name: 'Living room' } };

function setup(devices = [airthings(), aqara(), heatPump()]) {
  const api = fakeApi({ devices, zones: ZONES });
  const homey = fakeHomey(api);
  const service = new RoomHealthService(homey, () => {});
  return { homey, api, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('healthCaps', () => {
  it("picks one number capability per measure: the Airthings' radon in Bq/m³ and VOC in ppb, not its string or pCi/L ones", () => {
    expect(healthCaps(airthings())).toEqual([
      { measure: 'temperature', capabilityId: 'measure_temperature', scale: 1 },
      { measure: 'humidity', capabilityId: 'measure_humidity', scale: 1 },
      { measure: 'co2', capabilityId: 'measure_co2', scale: 1 },
      { measure: 'radon', capabilityId: 'measure_radon', scale: 1 },
      { measure: 'pm25', capabilityId: 'measure_pm25', scale: 1 },
      { measure: 'voc', capabilityId: 'measure_voc', scale: 1 },
    ]);
  });

  it("matches VOC without case (the Aqara's `measure_VOC`)", () => {
    expect(healthCaps(aqara()).map(c => c.capabilityId)).toEqual(['measure_temperature', 'measure_humidity', 'measure_VOC']);
  });

  it('takes an indoor sub-capability when there is no plain one, never .outdoor or a freezer', () => {
    expect(healthCaps(heatPump())).toEqual([{ measure: 'temperature', capabilityId: 'measure_temperature.room', scale: 1 }]);
    const fridge = fakeDevice({ caps: { 'measure_temperature.freezer': { type: 'number', value: -18 } } });
    expect(healthCaps(fridge)).toEqual([]);
    const both = fakeDevice({ caps: { 'measure_temperature.inside': { type: 'number', value: 20 }, measure_temperature: { type: 'number', value: 21 } } });
    expect(healthCaps(both).map(c => c.capabilityId)).toEqual(['measure_temperature']);
  });

  it('leaves out VOC in μg/m³ or as an index, and turns radon in pCi/L into Bq/m³', () => {
    const d = fakeDevice({
      caps: {
        measure_tvoc: { type: 'number', value: 300, units: 'μg/m³' },
        measure_radon: { type: 'number', value: 2, units: 'pCi/L' },
        measure_pm10: { type: 'number', value: 20 },
      },
    });
    expect(healthCaps(d)).toEqual([
      { measure: 'radon', capabilityId: 'measure_radon', scale: 37 },
      { measure: 'pm10', capabilityId: 'measure_pm10', scale: 1 },
    ]);
  });
});

describe('getState', () => {
  it('returns the devices in the order asked, each with its zone and readings; a deleted one is missing', async () => {
    const { service } = setup();
    expect(await service.getState(['pump', 'nope', 'aqara'])).toEqual([
      { id: 'pump', name: 'Heat pump', zone: { id: 'living', name: 'Living room' }, measures: { temperature: { capabilityId: 'measure_temperature.room', value: 21.5 } } },
      { id: 'nope', missing: true },
      {
        id: 'aqara', name: 'Air monitor', zone: { id: 'kitchen', name: 'Kitchen' },
        measures: {
          temperature: { capabilityId: 'measure_temperature', value: 22.4 },
          humidity: { capabilityId: 'measure_humidity', value: 61.5 },
          voc: { capabilityId: 'measure_VOC', value: 169 },
        },
      },
    ]);
  });

  it('gives a device with nothing usable no readings instead of calling it missing, and reads it again once it has some', async () => {
    const plug = fakeDevice({ id: 'plug', name: 'Plug', caps: { measure_tvoc: { type: 'number', value: 300, units: 'μg/m³' } } });
    const { service } = setup([plug]);
    expect(await service.getState(['plug'])).toEqual([{ id: 'plug', name: 'Plug', zone: null, measures: {} }]);
    plug.capabilitiesObj.measure_co2 = { id: 'measure_co2', type: 'number', value: 800 };
    expect(await service.getState(['plug'])).toMatchObject([{ measures: { co2: { value: 800 } } }]);
    expect(plug.listenerCount('measure_co2')).toBe(1);
  });

  it('a value that is not a number reads as null', async () => {
    const d = fakeDevice({ id: 'd', caps: { measure_co2: { type: 'number', value: null } } });
    const { service } = setup([d]);
    expect(await service.getState(['d'])).toMatchObject([{ measures: { co2: { value: null } } }]);
  });

  it('shows a move to another room on the next read', async () => {
    const { service, devices } = setup();
    await service.getState(['aqara']);
    devices[1].zone = 'bed';
    expect(await service.getState(['aqara'])).toMatchObject([{ zone: { id: 'bed', name: 'Bedroom' } }]);
  });

  it('keeps the last known room when the zones read fails, so the rooms don\'t split', async () => {
    const { service, api } = setup();
    await service.getState(['aqara']);
    api.zones.getZones.mockRejectedValue(new Error('busy'));
    vi.advanceTimersByTime(61_000); // past the shared zones read
    expect(await service.getState(['aqara'])).toMatchObject([{ zone: { id: 'kitchen', name: 'Kitchen' } }]);
  });

  it('sends each change as an event in the measure\'s unit, and the next read has it', async () => {
    const radon = fakeDevice({ id: 'r', name: 'Radon', caps: { measure_radon: { type: 'number', value: 2, units: 'pCi/L' } } });
    const { service, homey, devices } = setup([airthings(), radon]);
    expect(await service.getState(['r'])).toMatchObject([{ measures: { radon: { value: 74 } } }]);
    devices[1].report('measure_radon', 3);
    expect(homey.api.realtime).toHaveBeenCalledWith(RH_STATE_EVENT, { deviceId: 'r', capabilityId: 'measure_radon', measure: 'radon', value: 111 });
    await service.getState(['air']);
    devices[0].report('measure_co2', 1400);
    expect(homey.api.realtime).toHaveBeenLastCalledWith(RH_STATE_EVENT, { deviceId: 'air', capabilityId: 'measure_co2', measure: 'co2', value: 1400 });
    expect(await service.getState(['air'])).toMatchObject([{ measures: { co2: { value: 1400 } } }]);
  });

  it('listens to the chosen capabilities only, and stops when a device goes', async () => {
    const { service, devices } = setup();
    const air = devices[0];
    await service.getState(['air']);
    expect(air.makeCapabilityInstance.mock.calls.map(c => c[0]))
      .toEqual(['measure_temperature', 'measure_humidity', 'measure_co2', 'measure_radon', 'measure_pm25', 'measure_voc']);
    expect(air.listenerCount('measure_co2')).toBe(1);
    devices.splice(0, 1);
    expect(await service.getState(['air'])).toEqual([{ id: 'air', missing: true }]);
    expect(air.listenerCount('measure_co2')).toBe(0);
  });
});
