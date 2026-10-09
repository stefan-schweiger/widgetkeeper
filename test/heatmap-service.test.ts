import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import HeatmapService, { HISTORY_SETTING, heatmapCaps, mergeChanges } from '../lib/HeatmapService.js';
import { heatmapDates, hourlyAverages, hourlyShareTrue, spanFor } from '../lib/heatmap.js';

vi.mock('homey-api', () => homeyApiMock);

const TZ = 'Europe/Copenhagen';
// Sunday 4 October 2026, 09:30 in Copenhagen (CEST, UTC+2).
const NOW = Date.parse('2026-10-04T07:30:00Z');
const at = (iso: string) => Date.parse(iso);

const sensor = () => fakeDevice({
  id: 'hue', name: 'Hue motion sensor',
  caps: {
    measure_luminance: { type: 'number', value: 5.2, title: 'Luminance', units: 'lx', insights: true },
    alarm_motion: { type: 'boolean', value: false, title: 'Motion alarm', insights: true },
    measure_battery: { type: 'number', value: 80, title: 'Battery', units: '%', insights: false },
    alarm_tamper: { type: 'boolean', value: false, title: 'Tamper alarm' },
    button: { type: 'boolean', value: false, title: 'Button', insights: true, setable: true },
  },
});

function setup(opts: { logEntries?: (args: any) => unknown } = {}) {
  const device = sensor();
  const api = fakeApi({ devices: [device], logEntries: opts.logEntries });
  const homey = fakeHomey(api);
  const service = new HeatmapService(homey, () => {});
  return { homey, api, device, service };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('heatmapDates', () => {
  it('is today and the 6 days before it, in local time, with weekdays', () => {
    expect(heatmapDates(NOW, TZ)).toEqual([
      { date: '2026-09-28', weekday: 1 },
      { date: '2026-09-29', weekday: 2 },
      { date: '2026-09-30', weekday: 3 },
      { date: '2026-10-01', weekday: 4 },
      { date: '2026-10-02', weekday: 5 },
      { date: '2026-10-03', weekday: 6 },
      { date: '2026-10-04', weekday: 0 },
    ]);
  });

  it('can cover 14 days', () => {
    const dates = heatmapDates(NOW, TZ, 14);
    expect(dates).toHaveLength(14);
    expect(dates[0]).toEqual({ date: '2026-09-21', weekday: 1 });
  });

  it('fetches 7 days for up to 7 shown, else 14', () => {
    expect([3, 7, 10, 14].map(spanFor)).toEqual([7, 7, 14, 14]);
  });

  it('switches day at local midnight, not UTC midnight', () => {
    expect(heatmapDates(at('2026-10-04T22:30:00Z'), TZ).at(-1)!.date).toBe('2026-10-05');
  });
});

describe('hourlyAverages', () => {
  it('puts each hourly average on its local hour and drops what is outside the 7 days', () => {
    const days = hourlyAverages([
      { t: at('2026-09-27T21:00:00Z'), w: 9 }, // Sunday 23:00 local: the day before the window
      { t: at('2026-09-27T22:00:00Z'), w: 1 }, // Monday 00:00 local
      { t: at('2026-10-04T05:00:00Z'), w: 7.5 }, // today 07:00
    ], NOW, TZ);
    expect(days[0].hours[0]).toBe(1);
    expect(days[6].hours[7]).toBe(7.5);
    expect(days.flatMap(d => d.hours).filter(v => v != null)).toHaveLength(2);
  });

  it('averages the two UTC hours that share a local hour when DST ends', () => {
    // 25 October 2026: 02:00–03:00 local happens twice.
    const now = at('2026-10-25T12:00:00Z');
    const days = hourlyAverages([
      { t: at('2026-10-25T00:00:00Z'), w: 10 }, // 02:00 CEST
      { t: at('2026-10-25T01:00:00Z'), w: 20 }, // 02:00 CET
      { t: at('2026-10-25T02:00:00Z'), w: 5 }, // 03:00 CET
    ], now, TZ);
    expect(days[6].hours.slice(2, 4)).toEqual([15, 5]);
  });
});

describe('hourlyShareTrue', () => {
  it('is the share of each hour the value was true, carried across hours, up to now', () => {
    const days = hourlyShareTrue([
      { t: at('2026-10-04T06:15:00Z'), v: true }, // 08:15 local
      { t: at('2026-10-04T06:45:00Z'), v: false }, // 08:45
    ], NOW, TZ);
    const today = days[6].hours;
    expect(today.slice(0, 8)).toEqual(new Array(8).fill(null)); // before the first known state
    expect(today[8]).toBeCloseTo(2 / 3); // 08:15–08:45 true, out of the known 08:15–09:00
    expect(today[9]).toBe(0); // 09:00–09:30, false
    expect(today.slice(10)).toEqual(new Array(14).fill(null)); // still to come
  });

  it('starts from a state known from before the window', () => {
    const days = hourlyShareTrue([{ t: at('2026-09-20T10:00:00Z'), v: true }], NOW, TZ);
    expect(days[0].hours[0]).toBe(1);
    expect(days[5].hours.every(v => v === 1)).toBe(true);
    expect(days[6].hours[9]).toBe(1);
  });
});

describe('mergeChanges', () => {
  it('sorts and keeps a change both sources have once', () => {
    expect(mergeChanges([[1000, 1], [5000, 0]], [[1030, 1], [3000, 0], [3000, 0]])).toEqual([[1000, 1], [3000, 0], [5000, 0]]);
  });
});

describe('heatmapCaps', () => {
  it('lists the numbers and booleans Homey logs in Insights', () => {
    expect(heatmapCaps(sensor()).map(c => c.id)).toEqual(['measure_luminance', 'alarm_motion', 'button']);
    expect(heatmapCaps(sensor())[0]).toEqual({ id: 'measure_luminance', title: 'Luminance', type: 'number', units: 'lx', decimals: null });
  });
});

describe('HeatmapService', () => {
  it('lists devices with a logged capability, and their capabilities', async () => {
    const plain = fakeDevice({ id: 'plain', name: 'Plug', caps: { onoff: { type: 'boolean', insights: false } } });
    const homey = fakeHomey(fakeApi({ devices: [sensor(), plain] }));
    const service = new HeatmapService(homey, () => {});
    expect((await service.listDevices('')).map(d => d.id)).toEqual(['hue']);
    expect(await service.listCapabilities('hue', 'lum')).toEqual([{ name: 'Luminance', description: 'lx', id: 'measure_luminance' }]);
    await expect(service.listCapabilities(undefined, '')).rejects.toThrow();
  });

  it('reads a number from Insights (last7Days, full log id) and caches it for 5 min', async () => {
    const { api, service } = setup({
      logEntries: () => ({ step: 3600000, values: [{ t: '2026-10-04T05:00:00.000Z', v: 2.5 }] }),
    });
    const h = await service.getHistory('hue', 'measure_luminance');
    expect(api.insights.getLogEntries).toHaveBeenCalledWith({
      uri: 'homey:device:hue', id: 'homey:device:hue:measure_luminance', resolution: 'last7Days',
    });
    expect(h).toMatchObject({ name: 'Hue motion sensor', value: 5.2, language: 'en', capability: { type: 'number', units: 'lx' } });
    expect(h.days[6].hours[7]).toBe(2.5);

    await service.getHistory('hue', 'measure_luminance');
    expect(api.insights.getLogEntries).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 6 * 60e3);
    await service.getHistory('hue', 'measure_luminance');
    expect(api.insights.getLogEntries).toHaveBeenCalledTimes(2);
  });

  it('reads power from its energy_power log', async () => {
    const plug = fakeDevice({ id: 'plug', name: 'Plug', caps: { measure_power: { type: 'number', value: 26, title: 'Power', units: 'W', insights: true } } });
    const api = fakeApi({
      devices: [plug],
      logs: [{ id: 'homey:device:plug:energy_power', ownerUri: 'homey:device:plug', ownerId: 'energy_power' }],
      logEntries: () => ({ step: 3600000, values: [{ t: '2026-10-04T05:00:00.000Z', v: 40 }] }),
    });
    const service = new HeatmapService(fakeHomey(api), () => {});
    const h = await service.getHistory('plug', 'measure_power');
    expect(h.days[6].hours[7]).toBe(40);
    expect(api.insights.getLogEntries).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'homey:device:plug:energy_power' }));
  });

  it('reads 14 days with last14Days, cached apart from the 7-day read', async () => {
    const { api, service } = setup({
      logEntries: (args: any) => ({ values: [{ t: '2026-09-22T05:00:00.000Z', v: args.resolution === 'last14Days' ? 3 : 99 }] }),
    });
    const h = await service.getHistory('hue', 'measure_luminance', 10);
    expect(api.insights.getLogEntries).toHaveBeenLastCalledWith(expect.objectContaining({ resolution: 'last14Days' }));
    expect(h.days).toHaveLength(14);
    expect(h.days[1].hours[7]).toBe(3); // Tuesday 22 September, 07:00
    expect((await service.getHistory('hue', 'measure_luminance', 7)).days).toHaveLength(7);
    expect(api.insights.getLogEntries).toHaveBeenCalledTimes(2);
  });

  it('returns 14 days of a recorded boolean', async () => {
    const { device, service } = setup({ logEntries: () => ({ values: [{ t: '2026-09-20T10:00:00.000Z', v: true }] }) });
    device.capabilitiesObj.alarm_motion.value = true;
    const h = await service.getHistory('hue', 'alarm_motion', 14);
    expect(h.days).toHaveLength(14);
    expect(h.days[0].hours.every(v => v === 1)).toBe(true);
  });

  it('fails for a capability that is not logged', async () => {
    const { service } = setup();
    await expect(service.getHistory('hue', 'measure_battery')).rejects.toThrow();
  });

  it('records a boolean itself, backfilled from Insights, and saves it', async () => {
    const { homey, device, service } = setup({
      logEntries: () => ({ values: [
        { t: '2026-10-04T06:15:00.000Z', v: true },
        { t: '2026-10-04T06:45:00.000Z', v: false },
      ] }),
    });
    let h = await service.getHistory('hue', 'alarm_motion');
    expect(h.capability.type).toBe('boolean');
    expect(h.days[6].hours[8]).toBeCloseTo(2 / 3);
    expect(device.listenerCount('alarm_motion')).toBe(1);

    vi.setSystemTime(at('2026-10-04T07:40:00Z')); // 09:40
    device.report('alarm_motion', true);
    vi.setSystemTime(at('2026-10-04T07:50:00Z')); // 09:50
    h = await service.getHistory('hue', 'alarm_motion');
    expect(h.days[6].hours[9]).toBeCloseTo(10 / 50); // true 09:40–09:50 out of 09:00–09:50

    vi.advanceTimersByTime(61e3);
    const saved = homey.settings.get(HISTORY_SETTING);
    expect(saved['hue:alarm_motion'].changes.map((c: any) => c[1])).toEqual([1, 0, 1]);
  });

  it('resumes recording saved booleans when the app starts', async () => {
    const first = setup();
    await first.service.getHistory('hue', 'alarm_motion');
    vi.advanceTimersByTime(61e3);
    await first.service.stop();

    const device = sensor();
    const homey = fakeHomey(fakeApi({ devices: [device] }));
    homey.settings.set(HISTORY_SETTING, first.homey.settings.get(HISTORY_SETTING));
    const service = new HeatmapService(homey, () => {});
    service.start();
    await vi.waitFor(() => expect(device.listenerCount('alarm_motion')).toBe(1));
    await service.stop();
  });

  it('forgets a recorded boolean 8 days after the last request', async () => {
    const { device, service } = setup();
    service.start();
    await service.getHistory('hue', 'alarm_motion');
    vi.advanceTimersByTime(7 * 24 * 3600e3);
    expect(device.listenerCount('alarm_motion')).toBe(1);
    vi.advanceTimersByTime(24 * 3600e3 + 120e3);
    expect(device.listenerCount('alarm_motion')).toBe(0);
    expect(service.describe().recorded).toEqual([]);
    await service.stop();
  });
});
