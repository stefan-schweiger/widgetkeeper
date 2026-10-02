import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, FakeApiOptions, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import ElectricityService, { LIVE_EVENT } from '../lib/ElectricityService.js';
import { HOUR, MINUTE } from '../lib/series.js';

vi.mock('homey-api', () => homeyApiMock);

// Runs in Europe/Copenhagen (vitest.config.ts), like the Homey these were verified on.
const NOW = new Date('2026-01-15T10:20:00').getTime();
const HOUR_START = new Date('2026-01-15T10:00:00').getTime();

/** Homey's response for a local day: one hourly price per hour of that day (23–25 of them). */
function dayPrices(date: string, price: (start: number) => number = start => new Date(start).getHours() / 10) {
  const start = new Date(`${date}T00:00:00`).getTime();
  const end = new Date(new Date(start + 26 * HOUR).toDateString()).getTime(); // next local midnight
  const pricesPerInterval = [];
  for (let t = start; t < end; t += HOUR) {
    pricesPerInterval.push({ periodStart: new Date(t).toISOString(), periodEnd: new Date(t + HOUR).toISOString(), value: price(t) });
  }
  return { priceUnit: 'DKK', interval: 60, pricesPerInterval };
}

function meter(caps: Record<string, any> = { measure_power: { value: 512.4 } }) {
  return fakeDevice({ id: 'm1', name: 'Electricity Meter', caps });
}

function setup(opts: FakeApiOptions = {}) {
  const api = fakeApi({
    devices: [meter()],
    logs: [{ id: 'homey:device:m1:measure_power', ownerUri: 'homey:device:m1', ownerId: 'measure_power' }],
    prices: ({ date }) => dayPrices(date),
    ...opts,
  });
  const homey = fakeHomey(api);
  const service = new ElectricityService(homey, () => {});
  return { api, homey, service };
}

function fetchesFor(api: ReturnType<typeof fakeApi>, date: string) {
  return api.energy.fetchDynamicElectricityPrices.mock.calls.filter(([a]) => a.date === date).length;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('price slots', () => {
  it('returns 49 hourly slots with the current hour at index 24', async () => {
    const { service } = setup();
    const { prices, currency, language } = await service.getSnapshot(null);
    expect(prices).toHaveLength(49);
    expect(prices[24].start).toBe(HOUR_START);
    expect(prices[0].start).toBe(HOUR_START - 24 * HOUR);
    expect(prices[24].price).toBe(1); // 10:00
    expect(prices[0].price).toBe(1); // yesterday 10:00
    expect(prices.every(p => p.price != null)).toBe(true);
    expect(currency).toBe('DKK');
    expect(language).toBe('en');
  });

  it('leaves only the slots of a day that failed empty', async () => {
    const { service } = setup({
      prices: ({ date }) => {
        if (date === '2026-01-16') throw new Error('Not published yet');
        return dayPrices(date);
      },
    });
    const { prices } = await service.getSnapshot(null);
    const tomorrow = 24 + 14; // 00:00 on the 16th
    expect(prices.slice(0, tomorrow).every(p => p.price != null)).toBe(true);
    expect(prices.slice(tomorrow).every(p => p.price == null)).toBe(true);
  });

  it('keeps complete days cached and retries partial ones after 15 minutes', async () => {
    const { service, api } = setup({ prices: ({ date }) => (date === '2026-01-16' ? {} : dayPrices(date)) });
    await service.getSnapshot(null);
    vi.setSystemTime(NOW + 10 * MINUTE);
    await service.getSnapshot(null);
    expect(fetchesFor(api, '2026-01-15')).toBe(1);
    expect(fetchesFor(api, '2026-01-16')).toBe(1);
    vi.setSystemTime(NOW + 16 * MINUTE);
    await service.getSnapshot(null);
    expect(fetchesFor(api, '2026-01-14')).toBe(1);
    expect(fetchesFor(api, '2026-01-15')).toBe(1);
    expect(fetchesFor(api, '2026-01-16')).toBe(2);
  });

  it.each([
    ['spring forward (23 h)', '2026-03-29T12:20:00', '2026-03-29'],
    ['fall back (25 h)', '2026-10-25T12:20:00', '2026-10-25'],
  ])('fills every slot across a DST change: %s', async (_, now, day) => {
    vi.setSystemTime(new Date(now).getTime());
    const { service, api } = setup({ prices: ({ date }) => dayPrices(date, t => t / HOUR % 1000) });
    const { prices } = await service.getSnapshot(null);
    expect(prices.every(p => p.price === p.start / HOUR % 1000)).toBe(true);
    vi.setSystemTime(new Date(now).getTime() + 16 * MINUTE); // past the partial-day retry
    await service.getSnapshot(null);
    expect(fetchesFor(api, day)).toBe(1); // a 23-hour day counts as complete
  });

  it('reads the currency once, from a string or an object', async () => {
    const { service, api } = setup({ currency: { currency: 'EUR' } });
    expect((await service.getSnapshot(null)).currency).toBe('EUR');
    await service.getSnapshot(null);
    expect(api.energy.getCurrency).toHaveBeenCalledTimes(1);
  });
});

describe('meter', () => {
  it('seeds the live readings from insights plus the current value', async () => {
    const { service, api } = setup({
      logEntries: ({ resolution }) => (resolution === 'lastHour'
        ? { values: [{ t: new Date(NOW - 10e3).toISOString(), v: 300.6 }, { t: new Date(NOW - 5e3).toISOString(), v: 400.2 }] }
        : { values: [] }),
    });
    const snap = await service.getSnapshot('m1');
    expect(snap.deviceName).toBe('Electricity Meter');
    expect(snap.meterError).toBeNull();
    expect(snap.live).toEqual([{ t: NOW - 10e3, w: 301 }, { t: NOW - 5e3, w: 400 }, { t: NOW, w: 512 }]);
    expect(api.insights.getLogEntries).toHaveBeenCalledWith({ uri: 'homey:device:m1', id: 'homey:device:m1:measure_power', resolution: 'lastHour' });
  });

  it('falls back to the energy_power log', async () => {
    const { service, api } = setup({
      logs: [
        { id: 'homey:device:other:measure_power', ownerUri: 'homey:device:other', ownerId: 'measure_power' },
        { id: 'homey:device:m1:energy_power', ownerUri: 'homey:device:m1', ownerId: 'energy_power' },
      ],
    });
    await service.getSnapshot('m1');
    expect(api.insights.getLogEntries.mock.calls.every(([a]) => a.id === 'homey:device:m1:energy_power')).toBe(true);
  });

  it('reports a device without measure_power as a meter error, and still returns prices', async () => {
    const { service } = setup({ devices: [meter({ onoff: { value: true } })] });
    const snap = await service.getSnapshot('m1');
    expect(snap.meterError).toBe('Device Electricity Meter has no measure_power capability');
    expect(snap.deviceName).toBeNull();
    expect(snap.live).toEqual([]);
    expect(snap.prices).toHaveLength(49);
  });

  it('pushes readings at most once a second, latest first', async () => {
    const device = meter();
    const { service, homey } = setup({ devices: [device] });
    await service.getSnapshot('m1');
    device.report('measure_power', 100);
    device.report('measure_power', 200);
    await vi.advanceTimersByTimeAsync(0);
    expect(homey.api.realtime.mock.calls).toEqual([[LIVE_EVENT, { deviceId: 'm1', t: NOW, w: 200 }]]);

    await vi.advanceTimersByTimeAsync(200);
    device.report('measure_power', 300);
    await vi.advanceTimersByTimeAsync(300);
    device.report('measure_power', 400.4);
    await vi.advanceTimersByTimeAsync(400);
    expect(homey.api.realtime).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); // 1 s after the first push
    expect(homey.api.realtime).toHaveBeenCalledTimes(2);
    expect(homey.api.realtime.mock.calls[1]).toEqual([LIVE_EVENT, { deviceId: 'm1', t: NOW + 500, w: 400 }]);
    expect((await service.getSnapshot('m1')).live.map(p => p.w)).toEqual([512, 100, 200, 300, 400]);
  });

  it('trims readings past the hour but keeps one older than the window', async () => {
    const at = (min: number) => ({ t: new Date(NOW - min * MINUTE).toISOString(), v: min });
    const { service } = setup({
      logEntries: ({ resolution }) => ({ values: resolution === 'lastHour' ? [at(70), at(65), at(63), at(10)] : [] }),
    });
    service.start();
    await service.getSnapshot('m1');
    await vi.advanceTimersByTimeAsync(MINUTE); // one tick: cutoff = now - 62 min
    const { live } = await service.getSnapshot('m1');
    expect(live.map(p => p.w)).toEqual([63, 10, 512]);
    await service.stop();
  });

  it('stops tracking a meter after 10 minutes without a snapshot', async () => {
    const device = meter();
    const { service } = setup({ devices: [device] });
    service.start();
    await service.getSnapshot('m1');
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(device.listenerCount('measure_power')).toBe(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(device.listenerCount('measure_power')).toBe(0);
    await service.getSnapshot('m1');
    expect(device.listenerCount('measure_power')).toBe(1); // tracked again on request
    await service.stop();
  });
});

describe('usage', () => {
  it('averages the 24 h log into 5-minute buckets from the first price slot', async () => {
    const first = HOUR_START - 24 * HOUR;
    const { service, api } = setup({
      logEntries: ({ resolution }) => (resolution === 'last24Hours'
        ? { values: [{ t: new Date(first + 6 * MINUTE).toISOString(), v: 100.4 }, { t: new Date(first + 8 * MINUTE).toISOString(), v: 200 }] }
        : { values: [] }),
    });
    const { usage } = await service.getSnapshot('m1');
    // No data for the first bucket; the second is the average; the rest carry it to now (10:20).
    expect(usage[0]).toEqual({ t: first + 5 * MINUTE, w: 150 });
    expect(usage.at(-1)).toEqual({ t: HOUR_START + 20 * MINUTE, w: 150 });
    expect(usage).toHaveLength(24 * 12 + 4);

    vi.setSystemTime(NOW + 4 * MINUTE);
    await service.getSnapshot('m1');
    vi.setSystemTime(NOW + 6 * MINUTE);
    await service.getSnapshot('m1');
    const reads = api.insights.getLogEntries.mock.calls.filter(([a]) => a.resolution === 'last24Hours').length;
    expect(reads).toBe(2); // cached for 5 minutes
  });
});
