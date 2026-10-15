import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import LightService, { GROUP_DRIVER, LIGHTS_STATE_EVENT } from '../lib/LightService.js';
import { API_KEY_SETTING } from '../lib/PersonalApiKey.js';
import { routeKeyUse } from '../lib/widgetRoutes.js';

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
  const homey = fakeHomey(fakeApi({ devices, zones: { z1: { name: 'Køkken' } } }));
  const service = new LightService(homey, () => {});
  return { homey, service, devices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('getState', () => {
  it('returns the light capabilities in the order asked, with missing ones marked', async () => {
    const { service } = setup();
    expect(await service.getState(['dimmer', 'nope', 'bulb', 'plug'])).toEqual([
      { id: 'dimmer', name: 'Spots', icon: null, zone: { id: 'z1', name: 'Køkken' }, caps: { dim: { value: 0.4, setable: true } } },
      { id: 'nope', missing: true },
      {
        id: 'bulb', name: 'Kitchen', icon: null, zone: { id: 'z1', name: 'Køkken' }, caps: {
          onoff: { value: true, setable: true },
          dim: { value: 0.5, setable: true },
          light_temperature: { value: 0.3, setable: true },
          light_hue: { value: 0.1, setable: true },
          light_mode: { value: 'color', setable: true },
        },
      },
      { id: 'plug', name: 'Plug', icon: null, zone: { id: 'z1', name: 'Køkken' }, caps: { onoff: { value: false, setable: true } } }, // on/off only
    ]);
  });
});

describe('zones', () => {
  it('sends no zone when the zone is unknown or the zones fail', async () => {
    const homey = fakeHomey(fakeApi({ devices: [fakeDevice({ id: 'd', zone: 'nowhere', caps: { dim: { type: 'number', value: 1 } } })] }));
    const service = new LightService(homey, () => {});
    expect((await service.getState(['d']))[0]).toMatchObject({ zone: null });
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

  it('turns an off light on, then switches to temperature mode and sets the temperature', async () => {
    const { service, devices } = setup([bulb(false)]);
    await service.set('bulb', { temperature: 0.8 });
    expect(devices[0].sent).toEqual(['onoff=true', 'light_mode="temperature"', 'light_temperature=0.8']);
  });

  it("doesn't resend onoff with a colour temperature for a light that is on", async () => {
    const { service, devices } = setup();
    await service.set('bulb', { temperature: 0.8 });
    expect(devices[0].sent).toEqual(['light_mode="temperature"', 'light_temperature=0.8']);
  });

  it('turns an off light on before switching to colour mode and setting the hue and saturation', async () => {
    const hueBulb = fakeDevice({
      id: 'hue', name: 'Hue Go',
      caps: {
        onoff: { type: 'boolean', value: false },
        dim: { type: 'number', value: 0.5 },
        light_mode: { type: 'enum', value: 'temperature' },
        light_hue: { type: 'number', value: 0.1 },
        light_saturation: { type: 'number', value: 0.2 },
      },
    });
    const { service, devices } = setup([hueBulb]);
    await service.set('hue', { hue: 0.6, saturation: 1 });
    expect(devices[0].sent).toEqual(['onoff=true', 'light_mode="color"', 'light_hue=0.6', 'light_saturation=1']);
  });

  it('sets only the hue on a light without saturation, already in colour mode', async () => {
    const { service, devices } = setup();
    await service.set('bulb', { hue: 0.3, saturation: 1 });
    expect(devices[0].sent).toEqual(['light_hue=0.3']);
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

  it('turns a light without dim on and off with the brightness', async () => {
    const { service, devices: [, , p] } = setup();
    await service.set('plug', { dim: 0.5 });
    await service.set('plug', { dim: 0 });
    await service.set('plug', { onoff: true });
    expect(p.sent).toEqual(['onoff=true', 'onoff=false', 'onoff=true']);
  });

  it('refuses bad values and devices without dim or onoff', async () => {
    const { service } = setup();
    await expect(service.set('bulb', { dim: 2 })).rejects.toThrow(/Invalid brightness/);
    await expect(service.set('bulb', { onoff: 'on' })).rejects.toThrow(/Invalid on\/off/);
    await expect(service.set('dimmer', { temperature: 0.5 })).rejects.toThrow(/colour temperature/);
    await expect(service.set('dimmer', { hue: 0.5, saturation: 1 })).rejects.toThrow(/no colour/);
    await expect(service.set('bulb', { hue: 0.5, saturation: 3 })).rejects.toThrow(/Invalid saturation/);
    await expect(service.set('plug', { temperature: 0.5 })).rejects.toThrow(/colour temperature/);
    await expect(service.set('bulb', {})).rejects.toThrow(/Nothing to set/);
  });
});

describe('moods', () => {
  const moods = {
    m1: {
      id: 'm1', name: 'Relax', zone: 'z1', preset: null, devices: {
        bulb: { state: { onoff: true, dim: 0.4, light_mode: 'color', light_hue: 0.6, light_saturation: 0.5 } },
        dimmer: { state: { onoff: true, dim: 0.2 } },
        spot: { state: { onoff: true, light_temperature: 0.8 } },
        off: { state: { onoff: false, light_hue: 0.1 } },
      },
    },
    m2: { id: 'm2', name: 'Bright', zone: 'z1', devices: { bulb: { state: { onoff: true, light_mode: 'temperature', light_hue: 0.3, light_temperature: 0.1 } } } },
    m3: { id: 'm3', name: 'Cinema', zone: 'z2', devices: {} },
  };

  function withMoods() {
    const { homey, service } = setup();
    const getMoods = vi.fn(async () => moods);
    const setMood = vi.fn(async () => {});
    (homey.fakeApi as any).moods = { getMoods };
    keyApis.set('key', { moods: { setMood } });
    return { homey, service, getMoods, setMood };
  }

  afterEach(() => { keyApis.clear(); });

  it("lists the zones' Moods by name, with the colours they give their lights, and shares the read", async () => {
    const { service, getMoods } = withMoods();
    expect(await service.getMoods(['z1'])).toEqual([
      { id: 'm2', name: 'Bright', zone: 'z1', colors: [{ temperature: 0.1 }] },
      { id: 'm1', name: 'Relax', zone: 'z1', colors: [{ hue: 0.6, saturation: 0.5 }, { temperature: 0.8 }] },
    ]);
    expect(await service.getMoods(['z2', 'z9'])).toEqual([{ id: 'm3', name: 'Cinema', zone: 'z2', colors: [] }]);
    expect(await service.getMoods([])).toEqual([]);
    expect(getMoods).toHaveBeenCalledTimes(1);
  });

  it('starts a Mood through the personal API key', async () => {
    const { homey, service, setMood } = withMoods();
    await expect(service.setMood('m1')).rejects.toMatchObject({ reason: 'noKey' });
    homey.settings.set(API_KEY_SETTING, 'key');
    await service.setMood('m1');
    expect(setMood).toHaveBeenCalledWith({ id: 'm1' });
    setMood.mockRejectedValueOnce(new Error('Missing Scopes: homey.mood.set'));
    await expect(service.setMood('m1')).rejects.toMatchObject({ reason: 'keyScope' });
    await expect(service.setMood('')).rejects.toThrow(/Invalid mood id/);
    expect(await service.describeMoods()).toMatchObject({ perZone: { z1: 2, z2: 1 }, started: 1 });
  });

  it('starting a Mood uses the moods permission on the web dashboards', () => {
    expect(routeKeyUse('lights', 'POST', '/mood', { id: 'm1' })).toBe('moods');
    expect(routeKeyUse('stack', 'POST', '/call', { type: 'lights', method: 'POST', path: '/mood' })).toBe('moods');
    expect(routeKeyUse('lights', 'POST', '/set', {})).toBe(null);
  });
});

describe('Homey group devices', () => {
  const spot = (id: string, hue: number, on = true) => fakeDevice({
    id, name: id, caps: { onoff: { type: 'boolean', value: on }, dim: { type: 'number', value: 0.7 }, light_hue: { type: 'number', value: hue } },
  });
  function groupSetup() {
    const group: any = fakeDevice({ id: 'group', name: 'Ceiling spots', caps: { onoff: { type: 'boolean', value: true }, dim: { type: 'number', value: 0.7 }, light_hue: { type: 'number', value: 0.7 } } });
    group.driverId = GROUP_DRIVER;
    group.settings = { deviceIds: ['s1', 's2', 'gone', 'sensor'] };
    const sensor = fakeDevice({ id: 'sensor', caps: { measure_temperature: { type: 'number', value: 20 } } });
    const devices = [group, spot('s1', 0.1), spot('s2', 0.5, false), sensor];
    return { ...setup(devices), group };
  }

  it("sends a group's lights with it, leaving out missing ones and ones that aren't lights", async () => {
    const { service } = groupSetup();
    const [entry] = await service.getState(['group']);
    expect(entry).toMatchObject({ id: 'group', caps: { light_hue: { value: 0.7 } } });
    expect((entry as any).groupLights).toEqual([
      { id: 's1', caps: { onoff: { value: true, setable: true }, dim: { value: 0.7, setable: true }, light_hue: { value: 0.1, setable: true } } },
      { id: 's2', caps: { onoff: { value: false, setable: true }, dim: { value: 0.7, setable: true }, light_hue: { value: 0.5, setable: true } } },
    ]);
  });

  it("sends a group's lights' changes as realtime events", async () => {
    const { service, homey, devices } = groupSetup();
    await service.getState(['group']);
    (devices[1] as any).report('light_hue', 0.3);
    expect(homey.api.realtime).toHaveBeenCalledWith(LIGHTS_STATE_EVENT, { deviceId: 's1', capabilityId: 'light_hue', value: 0.3 });
  });

  const reads = (homey: any, id: string) => homey.fakeApi.devices.getDevice.mock.calls.filter(([a]: any[]) => a.id === id).length;

  it('reads a light once per /state when it is both a tile and in the group', async () => {
    const { service, homey } = groupSetup();
    await service.getState(['group', 's1']);
    expect(reads(homey, 's1')).toBe(1);
    const [, s1] = await service.getState(['group', 's1']);
    expect(reads(homey, 's1')).toBe(2);
    expect(s1).toMatchObject({ id: 's1', caps: { light_hue: { value: 0.1 } } });
  });

  it("doesn't read or log a member that isn't a light on every /state, and logs a missing one once", async () => {
    const homey = fakeHomey(fakeApi({ devices: groupSetup().devices }));
    const log = vi.fn();
    const service = new LightService(homey, log);
    for (let i = 0; i < 3; i++) await service.getState(['group']);
    expect(reads(homey, 'sensor')).toBe(1);
    expect(log.mock.calls.map(c => c[0])).toEqual(['Light group member gone unavailable:']);
    vi.advanceTimersByTime(11 * 60e3); // read again after a while, in case it became a light
    await service.getState(['group']);
    expect(reads(homey, 'sensor')).toBe(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('leaves out a group in the group without tracking it on every /state', async () => {
    const { service, homey, devices } = groupSetup();
    const inner: any = fakeDevice({ id: 'inner', caps: { onoff: { type: 'boolean', value: true } } });
    inner.driverId = GROUP_DRIVER;
    inner.settings = { deviceIds: ['s2'] };
    devices.push(inner);
    (devices[0] as any).settings.deviceIds.push('inner');
    await service.getState(['group']);
    const [entry] = await service.getState(['group']);
    expect((entry as any).groupLights.map((m: any) => m.id)).toEqual(['s1', 's2']);
    expect(reads(homey, 'inner')).toBe(1);
  });

  it('sends no groupLights for other devices', async () => {
    const { service } = setup();
    expect(await service.getState(['bulb'])).not.toHaveProperty('0.groupLights');
  });
});
