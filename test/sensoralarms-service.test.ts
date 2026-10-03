import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import SensorAlarmService, { SA_STATE_EVENT, alarmCaps } from '../lib/SensorAlarmService.js';

vi.mock('homey-api', () => homeyApiMock);

const air = () => fakeDevice({
  id: 'air', name: 'Air quality',
  caps: {
    measure_co2: { type: 'number', value: 463 },
    alarm_co2: { type: 'boolean', value: false, title: 'CO₂ Alarm' },
    alarm_radon: { type: 'boolean', value: true, title: 'Radon alarm' },
  },
});
const door = () => fakeDevice({
  id: 'door', name: 'Back door',
  caps: { alarm_contact: { type: 'boolean', value: true, title: 'Contact alarm' }, alarm_battery: { type: 'boolean', value: false } },
});
const thermo = () => fakeDevice({ id: 'thermo', name: 'Bedroom', caps: { measure_temperature: { type: 'number', value: 24.1 } } });

function setup(devices = [air(), door(), thermo()]) {
  const homey = fakeHomey(fakeApi({ devices }));
  const service = new SensorAlarmService(homey, () => {});
  return { homey, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('alarmCaps', () => {
  it('picks the boolean alarm_* capabilities, custom and sub-capabilities included', () => {
    const d = fakeDevice({
      caps: {
        alarm_smoke: { type: 'boolean', value: false, title: 'Smoke alarm' },
        'alarm_generic.leak': { type: 'boolean', value: true },
        alarm_motion: { type: 'boolean', value: null },
        alarm_person: { type: 'boolean', value: false, title: 'Person Detected' },
        alarm_level: { type: 'number', value: 3 },
        measure_temperature: { type: 'number', value: 20 },
      },
    });
    expect(alarmCaps(d)).toEqual([
      { capabilityId: 'alarm_smoke', title: 'Smoke alarm', value: false, state: false },
      { capabilityId: 'alarm_generic.leak', title: 'alarm_generic.leak', value: true, state: false },
      { capabilityId: 'alarm_motion', title: 'alarm_motion', value: null, state: true },
      { capabilityId: 'alarm_person', title: 'Person Detected', value: false, state: true },
    ]);
  });
});

describe('getState', () => {
  it('returns the devices in the order asked, with missing ones marked', async () => {
    const { service } = setup();
    expect(await service.getState(['door', 'nope', 'air', 'thermo'])).toEqual([
      {
        id: 'door', name: 'Back door', icon: null, alarms: [
          { capabilityId: 'alarm_contact', title: 'Contact alarm', value: true, state: true },
          { capabilityId: 'alarm_battery', title: 'alarm_battery', value: false, state: false },
        ],
      },
      { id: 'nope', missing: true },
      {
        id: 'air', name: 'Air quality', icon: null, alarms: [
          { capabilityId: 'alarm_co2', title: 'CO₂ Alarm', value: false, state: false },
          { capabilityId: 'alarm_radon', title: 'Radon alarm', value: true, state: false },
        ],
      },
      { id: 'thermo', name: 'Bedroom', icon: null, alarms: [] },
    ]);
  });
});

describe('tracking', () => {
  it('sends alarm changes as realtime events', async () => {
    const { service, homey, devices } = setup();
    await service.getState(['air']);
    devices[0].report('alarm_co2', true);
    expect(homey.api.realtime).toHaveBeenCalledWith(SA_STATE_EVENT, { deviceId: 'air', capabilityId: 'alarm_co2', value: true });
    const [s] = await service.getState(['air']);
    expect(s).toMatchObject({ alarms: [{ capabilityId: 'alarm_co2', value: true }, { value: true }] });
  });

  it('tracks each device once, and only its alarms', async () => {
    const { service, devices } = setup();
    await Promise.all([service.getState(['air']), service.getState(['air'])]);
    await service.getState(['air']);
    const calls = devices[0].makeCapabilityInstance.mock.calls.map(([id]) => id);
    expect(calls).toEqual(['alarm_co2', 'alarm_radon']);
  });

  it('picks up a renamed device and changed alarm capabilities on the next request', async () => {
    const { service, devices } = setup();
    const [airDev] = devices;
    await service.getState(['air']);
    airDev.name = 'Kids room air';
    expect(await service.getState(['air'])).toMatchObject([{ name: 'Kids room air' }]);
    airDev.capabilitiesObj.alarm_voc = { id: 'alarm_voc', type: 'boolean', value: false, title: 'VOC alarm' };
    const [s] = await service.getState(['air']);
    expect(s).toMatchObject({ alarms: [{ capabilityId: 'alarm_co2' }, { capabilityId: 'alarm_radon' }, { capabilityId: 'alarm_voc' }] });
    expect(airDev.listenerCount('alarm_co2')).toBe(1);
    expect(airDev.listenerCount('alarm_voc')).toBe(1);
  });

  it('marks a device deleted while tracked as missing, and stops tracking it', async () => {
    const { service, devices } = setup();
    const [airDev] = devices;
    await service.getState(['air']);
    devices.splice(0, 1);
    expect(await service.getState(['air'])).toEqual([{ id: 'air', missing: true }]);
    expect(airDev.listenerCount('alarm_co2')).toBe(0);
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, devices } = setup();
    service.start();
    await service.getState(['air']);
    await vi.advanceTimersByTimeAsync(9 * 60e3);
    await service.getState(['air']);
    await vi.advanceTimersByTimeAsync(9 * 60e3);
    expect(devices[0].listenerCount('alarm_radon')).toBe(1);
    await vi.advanceTimersByTimeAsync(3 * 60e3);
    expect(devices[0].listenerCount('alarm_radon')).toBe(0);
    await service.stop();
  });
});
