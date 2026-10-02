import { describe, expect, it } from 'vitest';
import {
  HOUR, MINUTE, bucketAverage, floorTo, hourlyPrices, parseInsightsEntries, parsePriceResponse,
} from '../lib/series.js';

const T0 = Date.UTC(2026, 0, 15, 10); // a whole hour

describe('floorTo', () => {
  it('rounds down to the step', () => {
    expect(floorTo(T0 + 59 * MINUTE, HOUR)).toBe(T0);
    expect(floorTo(T0, HOUR)).toBe(T0);
    expect(floorTo(T0 + 7 * MINUTE, 5 * MINUTE)).toBe(T0 + 5 * MINUTE);
  });
});

describe('bucketAverage', () => {
  const step = 5 * MINUTE;

  it('averages the samples in each bucket', () => {
    const pts = [{ t: T0, w: 100 }, { t: T0 + MINUTE, w: 200 }, { t: T0 + step, w: 50 }];
    expect(bucketAverage(pts, T0, step, 2)).toEqual([150, 50]);
  });

  it('carries the last value into empty buckets', () => {
    const pts = [{ t: T0, w: 100 }, { t: T0 + 3 * step, w: 300 }];
    expect(bucketAverage(pts, T0, step, 5)).toEqual([100, 100, 100, 300, 300]);
  });

  it('leaves leading buckets null when nothing came before', () => {
    expect(bucketAverage([{ t: T0 + 2 * step, w: 10 }], T0, step, 3)).toEqual([null, null, 10]);
  });

  it('seeds empty leading buckets from the last sample before the start', () => {
    const pts = [{ t: T0 - 2 * step, w: 1 }, { t: T0 - step, w: 7 }, { t: T0 + step, w: 9 }];
    expect(bucketAverage(pts, T0, step, 3)).toEqual([7, 9, 9]);
  });

  it('ignores samples past the last bucket', () => {
    const pts = [{ t: T0, w: 1 }, { t: T0 + 2 * step, w: 999 }];
    expect(bucketAverage(pts, T0, step, 2)).toEqual([1, 1]);
  });

  it('returns all nulls without samples', () => {
    expect(bucketAverage([], T0, step, 2)).toEqual([null, null]);
  });
});

describe('parseInsightsEntries', () => {
  const iso = (t: number) => new Date(t).toISOString();

  it('reads the { values: [{ t, v }] } shape, sorted', () => {
    const res = { values: [{ t: iso(T0 + 5000), v: 2 }, { t: iso(T0), v: 1 }] };
    expect(parseInsightsEntries(res)).toEqual([{ t: T0, w: 1 }, { t: T0 + 5000, w: 2 }]);
  });

  it('accepts a bare array, { entries } and the date/value key variants', () => {
    expect(parseInsightsEntries([{ date: iso(T0), value: 3 }])).toEqual([{ t: T0, w: 3 }]);
    expect(parseInsightsEntries({ entries: [{ time: iso(T0), v: '4' }] })).toEqual([{ t: T0, w: 4 }]);
  });

  it('drops entries without a valid time or number', () => {
    const res = { values: [{ t: 'nope', v: 1 }, { t: iso(T0), v: null }, { t: iso(T0), v: 'x' }, { t: iso(T0), v: 5 }] };
    expect(parseInsightsEntries(res)).toEqual([{ t: T0, w: 5 }]);
  });

  it('returns [] for an empty or unexpected response', () => {
    expect(parseInsightsEntries(null)).toEqual([]);
    expect(parseInsightsEntries({})).toEqual([]);
  });
});

describe('parsePriceResponse', () => {
  it('reads the shape Homey returns (verified on a real Homey)', () => {
    const res = {
      priceUnit: 'DKK',
      interval: 60,
      pricesPerInterval: [
        { periodStart: new Date(T0 + HOUR).toISOString(), periodEnd: new Date(T0 + 2 * HOUR).toISOString(), value: 1.5 },
        { periodStart: new Date(T0).toISOString(), periodEnd: new Date(T0 + HOUR).toISOString(), value: 1.25 },
      ],
    };
    expect(parsePriceResponse(res)).toEqual([{ t: T0, w: 1.25 }, { t: T0 + HOUR, w: 1.5 }]);
  });

  it('finds a nested array and other key names, and numeric strings', () => {
    const res = { data: { today: [{ startsAt: new Date(T0).toISOString(), total: '0.75' }] } };
    expect(parsePriceResponse(res)).toEqual([{ t: T0, w: 0.75 }]);
  });

  it('skips entries without a price', () => {
    const res = [{ start: T0, price: '' }, { start: T0 + HOUR, price: 2 }];
    expect(parsePriceResponse(res)).toEqual([{ t: T0 + HOUR, w: 2 }]);
  });

  it('returns [] when there is no price array', () => {
    expect(parsePriceResponse(null)).toEqual([]);
    expect(parsePriceResponse({ priceUnit: 'DKK', pricesPerInterval: [] })).toEqual([]);
    expect(parsePriceResponse({ a: { b: { c: { d: [{ t: T0, v: 1 }] } } } })).toEqual([]); // too deep
  });
});

describe('hourlyPrices', () => {
  it('averages 15-minute prices into hours', () => {
    const q = (i: number, w: number) => ({ t: T0 + i * 15 * MINUTE, w });
    const hours = hourlyPrices([q(0, 1), q(1, 2), q(2, 3), q(3, 4), q(4, 10)]);
    expect([...hours]).toEqual([[T0, 2.5], [T0 + HOUR, 10]]);
  });
});
