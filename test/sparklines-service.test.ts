import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import SparklineService, { downsample, MAX_POINTS, sparkCaps, spanOf } from '../lib/SparklineService.js';
import ValueService, { VALUES_STATE_EVENT } from '../lib/ValueService.js';

vi.mock('homey-api', () => homeyApiMock);

const NOW = Date.parse('2026-10-06T12:00:00Z');
const HOUR = 3600e3;

const sensor = () => fakeDevice({
  id: 'sensor', name: 'Stue', zone: 'z1',
  caps: {
    measure_temperature: { type: 'number', value: 21.5, title: 'Temperature', units: '°C', decimals: 1, insights: true },
    measure_humidity: { type: 'number', value: 48, title: 'Humidity', units: '%', insights: true },
    target_temperature: { type: 'number', value: 20, title: 'Target', units: '°C' },
    alarm_motion: { type: 'boolean', value: false, title: 'Motion', insights: true },
  },
});

/** One log entry a minute over the last 24 hours, rising 0.01 a minute from 20. */
function entries({ resolution }: { resolution: string }) {
  const values = [];
  for (let i = 24 * 60; i > 0; i--) values.push({ t: new Date(NOW - i * 60e3).toISOString(), v: 20 + (24 * 60 - i) / 100 });
  return { values, resolution };
}

function setup(logEntries: (args: any) => unknown = entries) {
  const devices = [sensor()];
  const api = fakeApi({ devices, zones: { z1: { name: 'Living room' } }, logEntries });
  const homey = fakeHomey(api);
  const values = new ValueService(homey, () => {});
  const service = new SparklineService(homey, values, () => {});
  return { homey, api, service, devices };
}

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.useRealTimers(); });

describe('sparkCaps', () => {
  it('keeps the numbers Homey logs in Insights', () => {
    expect(sparkCaps(sensor())).toEqual(['measure_temperature', 'measure_humidity']);
  });
});

describe('spanOf', () => {
  it('falls back to 24 hours', () => {
    expect(spanOf('7d')).toBe('7d');
    expect(spanOf(undefined)).toBe('24h');
    expect(spanOf('2y')).toBe('24h');
  });
});

describe('downsample', () => {
  it('averages into at most 120 points at the bucket middles, carrying the last value over gaps', () => {
    const res = { values: [{ t: NOW - 50 * 60e3, v: 1 }, { t: NOW - 49 * 60e3, v: 3 }, { t: NOW - 10 * 60e3, v: 5 }] };
    const points = downsample(res, NOW, HOUR);
    // Buckets are 30 s; the first 20 minutes (40 buckets) have no value yet.
    expect(points).toHaveLength(MAX_POINTS - 20);
    expect(points[0]).toEqual([NOW - 50 * 60e3 + 15e3, 1]);
    expect(points[2]).toEqual([NOW - 49 * 60e3 + 15e3, 3]);
    expect(points[3][1]).toBe(3);
    expect(points[points.length - 1]).toEqual([NOW - 15e3, 5]);
  });

  it('drops null entries', () => {
    expect(downsample({ values: [{ t: NOW - 60e3, v: null }] }, NOW, HOUR)).toEqual([]);
  });
});

describe('listSlots', () => {
  it('lists every logged number as Device · Capability, with zone and units', async () => {
    const { service } = setup();
    expect(await service.listSlots('')).toEqual([
      { name: 'None', id: 'none' },
      { name: 'Stue · Humidity', description: 'Living room · %', id: 'sensor:measure_humidity' },
      { name: 'Stue · Temperature', description: 'Living room · °C', id: 'sensor:measure_temperature' },
    ]);
    expect((await service.listSlots('temp')).map(i => i.id)).toEqual(['sensor:measure_temperature']);
  });
});

describe('getState', () => {
  it("returns Device Values' state with the history, in order, missing slots marked", async () => {
    const { service } = setup();
    const state = await service.getState(['sensor:measure_temperature', 'nope:measure_power', 'bad'], '24h');
    expect(state).toHaveLength(2);
    expect(state[0]).toMatchObject({ deviceId: 'sensor', capabilityId: 'measure_temperature', name: 'Stue', value: 21.5 });
    expect(state[1]).toEqual({ deviceId: 'nope', capabilityId: 'measure_power', missing: true });
    const points = (state[0] as any).points as [number, number][];
    expect(points).toHaveLength(MAX_POINTS);
    expect(points[0][1]).toBeCloseTo(20.055, 2);
    expect(points[points.length - 1][1]).toBeCloseTo(34.335, 2);
  });

  it('asks Insights for the resolution of the span', async () => {
    const { service, api } = setup();
    for (const span of ['1h', '6h', '24h', '7d', undefined]) await service.getState(['sensor:measure_humidity'], span);
    expect(api.insights.getLogEntries.mock.calls.map((c: any[]) => c[0].resolution))
      .toEqual(['lastHour', 'last6Hours', 'last24Hours', 'last7Days']);
    expect(api.insights.getLogEntries.mock.calls[0][0]).toMatchObject({
      uri: 'homey:device:sensor', id: 'homey:device:sensor:measure_humidity',
    });
  });

  it('reuses a history for 5 minutes and shares one fetch between concurrent requests', async () => {
    const { service, api } = setup();
    await Promise.all([
      service.getState(['sensor:measure_temperature'], '24h'),
      service.getState(['sensor:measure_temperature'], '24h'),
    ]);
    await service.getState(['sensor:measure_temperature'], '24h');
    expect(api.insights.getLogEntries).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60e3 + 1);
    await service.getState(['sensor:measure_temperature'], '24h');
    expect(api.insights.getLogEntries).toHaveBeenCalledTimes(2);
  });

  it('shows the value without a history when the log is unavailable', async () => {
    const { service } = setup(() => { throw new Error('Log not found'); });
    const [s] = await service.getState(['sensor:measure_temperature'], '24h');
    expect(s).toMatchObject({ value: 21.5, points: [] });
  });

  it("sends live values as Device Values' realtime events", async () => {
    const { service, homey, devices } = setup();
    await service.getState(['sensor:measure_temperature'], '24h');
    devices[0].report('measure_temperature', 22);
    expect(homey.api.realtime).toHaveBeenCalledWith(VALUES_STATE_EVENT, { deviceId: 'sensor', capabilityId: 'measure_temperature', value: 22 });
  });

  it('drops a cached history after 10 minutes without a request', async () => {
    const { service } = setup();
    service.start();
    await service.getState(['sensor:measure_temperature'], '24h');
    expect(service.describe()).toHaveLength(1);
    vi.advanceTimersByTime(12 * 60e3);
    expect(service.describe()).toHaveLength(0);
    await service.stop();
  });
});
