import { HOUR, MINUTE, type Sample } from './series.js';

const SLICE = 15 * MINUTE;

/**
 * Days the service returns, ending today: 7 cover both the current Mon–Sun week and the last 3 or 7 days;
 * 14 cover the last 10 or 14. They match Insights' `last7Days` and `last14Days` resolutions.
 */
export const SPANS = [7, 14] as const;
export type Span = typeof SPANS[number];

/** The span to fetch for a widget showing `days` days. */
export function spanFor(days: number): Span {
  return days > 7 ? 14 : 7;
}

export type HeatmapDay = {
  /** YYYY-MM-DD in Homey's timezone. */
  date: string,
  /** 0 = Sunday … 6 = Saturday, like `Date.getDay()`. */
  weekday: number,
  /** One value per local hour 00–23; `null` = nothing reported. */
  hours: (number | null)[],
};

type LocalHour = { date: string, hour: number };

/** A cached formatter per timezone: `en-CA` gives YYYY-MM-DD, h23 gives 00–23. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The local date and hour of `t` in `timeZone`. */
export function localHour(t: number, timeZone: string): LocalHour {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(t)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** The `count` local dates ending with the one `now` falls on, oldest first. */
export function heatmapDates(now: number, timeZone: string, count: number = 7): { date: string, weekday: number }[] {
  const [y, m, d] = localHour(now, timeZone).date.split('-').map(Number);
  const out: { date: string, weekday: number }[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const day = new Date(Date.UTC(y, m - 1, d - k));
    out.push({ date: day.toISOString().slice(0, 10), weekday: day.getUTCDay() });
  }
  return out;
}

function emptyDays(now: number, timeZone: string, count: number): HeatmapDay[] {
  return heatmapDates(now, timeZone, count).map(d => ({ ...d, hours: new Array<number | null>(24).fill(null) }));
}

/**
 * Numeric logs: Insights' `last7Days`/`last14Days` give one average per UTC hour (`t` = the hour's start). Each lands
 * on its local hour; on the autumn DST day two UTC hours share a local hour and are averaged.
 */
export function hourlyAverages(samples: Sample[], now: number, timeZone: string, count: number = 7): HeatmapDay[] {
  const days = emptyDays(now, timeZone, count);
  const byDate = new Map(days.map(d => [d.date, d]));
  const acc = new Map<string, { s: number, n: number }>();
  for (const p of samples) {
    if (p.t > now) continue;
    const { date, hour } = localHour(p.t, timeZone);
    if (!byDate.has(date)) continue;
    const key = `${date} ${hour}`;
    const a = acc.get(key) ?? { s: 0, n: 0 };
    a.s += p.w;
    a.n++;
    acc.set(key, a);
  }
  for (const [key, a] of acc) {
    const [date, hour] = key.split(' ');
    byDate.get(date)!.hours[Number(hour)] = a.s / a.n;
  }
  return days;
}

/**
 * Boolean logs: the share of each local hour (0–1) the value was `true`, from its changes. The state
 * carries across hours until the next change; hours before the first known state, and after `now`,
 * stay `null`. The current hour counts only the time up to `now`.
 */
export function hourlyShareTrue(changes: { t: number, v: boolean }[], now: number, timeZone: string, count: number = 7): HeatmapDay[] {
  const days = emptyDays(now, timeZone, count);
  const byDate = new Map(days.map(d => [d.date, d]));
  const sorted = changes.filter(c => c.t <= now).sort((a, b) => a.t - b.t);
  if (!sorted.length) return days;
  const trueMs = new Map<string, number>();
  const spanMs = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, ms: number) => map.set(key, (map.get(key) ?? 0) + ms);
  // Walk 15-min slices: every UTC offset is a multiple of 15 min, so a slice never spans two local hours.
  const start = now - (count + 1) * 24 * HOUR;
  for (let i = 0; i < sorted.length; i++) {
    const from = Math.max(sorted[i].t, start);
    const to = i + 1 < sorted.length ? sorted[i + 1].t : now;
    for (let a = from; a < to;) {
      const b = Math.min(to, Math.floor(a / SLICE) * SLICE + SLICE);
      const { date, hour } = localHour(a, timeZone);
      if (byDate.has(date)) {
        const key = `${date} ${hour}`;
        add(spanMs, key, b - a);
        if (sorted[i].v) add(trueMs, key, b - a);
      }
      a = b;
    }
  }
  for (const [key, span] of spanMs) {
    if (span <= 0) continue;
    const [date, hour] = key.split(' ');
    byDate.get(date)!.hours[Number(hour)] = (trueMs.get(key) ?? 0) / span;
  }
  return days;
}
