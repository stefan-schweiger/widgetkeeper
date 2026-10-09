import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { heatmapCaps, type AutocompleteItem } from './HeatmapService.js';
import { readCapabilityLog } from './insightsLog.js';
import { bucketAverage, HOUR, MINUTE, parseInsightsEntries } from './series.js';
import Timings from './Timings.js';
import type ValueService from './ValueService.js';
import { describeCapability, parseSlot, type ValueSlot } from './ValueService.js';

const TICK = MINUTE;
/** A history is re-read from Insights at most this often (widgets refresh every 5 min). */
const HISTORY_TTL = 5 * MINUTE;
/** A cached history is dropped this long after the last request. */
const IDLE_TIMEOUT = 10 * MINUTE;
/** The most points a sparkline gets: about one per 3 px of a phone's 2-column tile. */
export const MAX_POINTS = 120;

/**
 * The spans the widget offers, with the Insights resolution behind each and its step (all verified on the
 * Homey, 2026-10-06 and 2026-10-09). Insights has no `last2Days` or `last5Days`, so those read the next
 * longer hourly log; `downsample()` cuts it to the span.
 */
export const SPANS = {
  '1h': { resolution: 'lastHour', ms: HOUR, step: 5 * 1000 },
  '6h': { resolution: 'last6Hours', ms: 6 * HOUR, step: MINUTE },
  '24h': { resolution: 'last24Hours', ms: 24 * HOUR, step: 5 * MINUTE },
  '2d': { resolution: 'last3Days', ms: 2 * 24 * HOUR, step: HOUR },
  '3d': { resolution: 'last3Days', ms: 3 * 24 * HOUR, step: HOUR },
  '5d': { resolution: 'last7Days', ms: 5 * 24 * HOUR, step: HOUR },
  '7d': { resolution: 'last7Days', ms: 7 * 24 * HOUR, step: HOUR },
} as const;
export type SpanId = keyof typeof SPANS;

export function spanOf(id: string | undefined): SpanId {
  return id && id in SPANS ? id as SpanId : '24h';
}

/** A Device Values slot plus its history as `[epoch ms, value]`, oldest first. */
export type SparklineSlot =
  | (Extract<ValueSlot, { name: string }> & { points: [number, number][] })
  | Extract<ValueSlot, { missing: true }>;

type HistoryCache = { at: number, lastRequested: number, points: [number, number][] };

/** The device's capabilities a sparkline can show: numbers that Homey logs in Insights. */
export function sparkCaps(device: any): string[] {
  return heatmapCaps(device).filter(c => c.type === 'number').map(c => c.id);
}

/**
 * Insights entries averaged into at most `MAX_POINTS` buckets over the span ending `now`, each at its
 * bucket's middle. Empty buckets carry the last value (Homey doesn't log unchanged values); buckets
 * before the first value are left out. With the log's `logStep`, no bucket is shorter than it, so an
 * hourly log over 2 days is 48 points, not 120 drawn as steps.
 */
export function downsample(res: any, now: number, spanMs: number, logStep = 0): [number, number][] {
  const count = Math.max(1, Math.min(MAX_POINTS, logStep ? Math.floor(spanMs / logStep) : MAX_POINTS));
  const step = spanMs / count;
  const start = now - spanMs;
  const out: [number, number][] = [];
  bucketAverage(parseInsightsEntries(res), start, step, count).forEach((v, i) => {
    if (v != null) out.push([Math.round(start + (i + 0.5) * step), Math.round(v * 1000) / 1000]);
  });
  return out;
}

function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

/**
 * The Sparklines widget: Device Values' tiles with each value's recent history from Insights.
 * The name, icon and live value come from `ValueService` (and its `values:state` realtime events).
 */
export default class SparklineService {

  private cache = new Map<string, HistoryCache>();
  private promises = new Map<string, Promise<[number, number][]>>();
  private logIds = new Map<string, string>(); // the Insights log that worked, per device and capability
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private values: ValueService,
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
  }

  // ---------------------------------------------------------------- settings autocomplete

  /** Every logged number of every device, as `Device · Capability`. */
  async listSlots(query: string): Promise<AutocompleteItem[]> {
    const api = await getAppApi(this.homey);
    const [devices, zones] = await Promise.all([
      api.devices.getDevices(),
      api.zones.getZones().catch(() => ({})),
    ]);
    const items: AutocompleteItem[] = [];
    for (const d of Object.values(devices) as any[]) {
      const zone = (zones as any)[d.zone]?.name as string | undefined;
      for (const id of sparkCaps(d)) {
        const c = describeCapability(d.capabilitiesObj[id], id);
        const name = `${d.name} · ${c.title}`;
        if (!matches(query, name, zone, id)) continue;
        items.push({ name, description: [zone, c.units].filter(Boolean).join(' · ') || undefined, id: `${d.id}:${id}` });
      }
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    // "None" first, so a tile can be emptied again. Its id has no colon, so the widget skips the slot.
    const none = this.homey.__('values.none') || 'None';
    return matches(query, none) ? [{ name: none, id: 'none' }, ...items] : items;
  }

  // ---------------------------------------------------------------- state

  /** Device Values' state for the slots, each with its history over the span. A failed history is empty. */
  async getState(slots: string[], spanId: string | undefined): Promise<SparklineSlot[]> {
    const span = spanOf(spanId);
    const tm = new Timings();
    const valid = slots.filter(s => parseSlot(s));
    const [states, histories] = await Promise.all([
      tm.time('values', () => this.values.getState(valid)),
      tm.time('insights', () => Promise.all(valid.map(s => this.history(s, span)))),
    ]);
    this.debug(`Sparklines state for ${valid.length} slots (${span}): ${tm.summary()}`);
    return states.map((s, i) => ('missing' in s ? s : { ...s, points: histories[i] }));
  }

  private history(slot: string, span: SpanId): Promise<[number, number][]> {
    const k = `${slot}:${span}`;
    const now = Date.now();
    const cached = this.cache.get(k);
    if (cached) cached.lastRequested = now;
    if (cached && now - cached.at < HISTORY_TTL) return Promise.resolve(cached.points);
    let p = this.promises.get(k);
    if (!p) {
      p = (async () => {
        const { deviceId, capabilityId } = parseSlot(slot)!;
        let points: [number, number][] = [];
        try {
          const api = await getAppApi(this.homey);
          const res = await readCapabilityLog(api, deviceId, capabilityId, SPANS[span].resolution, this.logIds);
          points = downsample(res, Date.now(), SPANS[span].ms, SPANS[span].step);
        } catch (err) {
          // Cached all the same, so a capability without a log isn't asked for again on every request.
          this.log(`Sparkline history of ${slot} unavailable:`, err);
        }
        this.cache.set(k, { at: Date.now(), lastRequested: Date.now(), points });
        return points;
      })().finally(() => this.promises.delete(k));
      this.promises.set(k, p);
    }
    return p;
  }

  private tick() {
    const now = Date.now();
    for (const [k, c] of this.cache) {
      if (now - c.lastRequested > IDLE_TIMEOUT) this.cache.delete(k);
    }
  }

  /** For the diagnostics report. */
  describe() {
    return [...this.cache.entries()].map(([k, c]) => ({ key: k, points: c.points.length, fetchedAt: new Date(c.at).toISOString() }));
  }

}
