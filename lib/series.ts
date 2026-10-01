export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export type Sample = { t: number, w: number };

/** Round `t` down to a multiple of `step` ms. */
export function floorTo(t: number, step: number): number {
  return Math.floor(t / step) * step;
}

/**
 * Average a time series into fixed buckets [start + i*step, start + (i+1)*step).
 * Buckets without samples fall back to the last known value (so a sparse insights log
 * still yields a continuous trace); leading empty buckets are `null`.
 */
export function bucketAverage(points: Sample[], start: number, step: number, count: number): (number | null)[] {
  const sums = new Array<number>(count).fill(0);
  const counts = new Array<number>(count).fill(0);
  let before: number | null = null;
  for (const p of points) {
    const i = Math.floor((p.t - start) / step);
    if (i < 0) { before = p.w; continue; }
    if (i >= count) break;
    sums[i] += p.w;
    counts[i]++;
  }
  const out: (number | null)[] = [];
  let last = before;
  for (let i = 0; i < count; i++) {
    if (counts[i]) last = sums[i] / counts[i];
    out.push(last);
  }
  return out;
}

/** Normalise an insights `getLogEntries` response to sorted samples. */
export function parseInsightsEntries(res: any): Sample[] {
  const values: any[] = Array.isArray(res) ? res : (res?.values ?? res?.entries ?? []);
  return values
    .map((e: any) => ({ t: new Date(e.t ?? e.date ?? e.time).getTime(), w: Number(e.v ?? e.value) }))
    .filter(s => Number.isFinite(s.t) && Number.isFinite(s.w))
    .sort((a, b) => a.t - b.t);
}

const TIME_KEYS = ['periodStart', 'start', 'startsAt', 'startAt', 'from', 'time', 'date', 't'];
const VALUE_KEYS = ['value', 'price', 'total', 'amount', 'v'];

/**
 * Normalise a Homey Energy dynamic price response to `{ t, w: price }` samples, one per
 * published interval (may be 15 min or 60 min). The response shape is not documented, so we
 * look for the first array of objects that carry a timestamp and a numeric value.
 */
export function parsePriceResponse(res: any): Sample[] {
  const arr = findPriceArray(res);
  if (!arr) return [];
  return arr
    .map((e: any) => {
      const tk = TIME_KEYS.find(k => e?.[k] != null);
      const vk = VALUE_KEYS.find(k => typeof e?.[k] === 'number' || (typeof e?.[k] === 'string' && e[k] !== '' && !Number.isNaN(Number(e[k]))));
      return { t: tk ? new Date(e[tk]).getTime() : NaN, w: vk ? Number(e[vk]) : NaN };
    })
    .filter(s => Number.isFinite(s.t) && Number.isFinite(s.w))
    .sort((a, b) => a.t - b.t);
}

function findPriceArray(res: any, depth = 0): any[] | null {
  if (res == null || depth > 3) return null;
  if (Array.isArray(res)) {
    if (res.length && typeof res[0] === 'object' && TIME_KEYS.some(k => res[0]?.[k] != null)) return res;
    return null;
  }
  if (typeof res === 'object') {
    for (const v of Object.values(res)) {
      const found = findPriceArray(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Average interval prices into hourly prices keyed by hour start (ms). */
export function hourlyPrices(samples: Sample[]): Map<number, number> {
  const acc = new Map<number, { s: number, n: number }>();
  for (const p of samples) {
    const h = floorTo(p.t, HOUR);
    const a = acc.get(h) ?? { s: 0, n: 0 };
    a.s += p.w;
    a.n++;
    acc.set(h, a);
  }
  const out = new Map<number, number>();
  for (const [h, a] of acc) out.set(h, a.s / a.n);
  return out;
}
