import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { listDevicesWhere, matches, type AutocompleteItem } from './autocomplete.js';
import { describeCapability } from './capabilities.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import { hourlyAverages, hourlyShareTrue, spanFor, type HeatmapDay, type Span } from './heatmap.js';
import { readCapabilityLog } from './insightsLog.js';
import { HOUR, MINUTE, parseInsightsEntries } from './series.js';
import Timings from './Timings.js';

const TICK = MINUTE;
/** Numeric history is re-read from Insights at most this often (widgets refresh every 5 min). */
const NUMERIC_TTL = 5 * MINUTE;
/** A cached numeric history is dropped this long after the last request. */
const IDLE_TIMEOUT = 10 * MINUTE;
/** A recorded boolean is forgotten this long after the last request (the widget was removed). */
const RECORD_TIMEOUT = 8 * 24 * HOUR;
/** Recorded changes older than this are pruned: enough for the longest span (14 days). */
const KEEP = 15 * 24 * HOUR;
/** Recorded changes are written to the app settings at most this often. */
const SAVE_DELAY = MINUTE;
/** Insights backfill for a recorded boolean: at most this often. */
const BACKFILL_TTL = 5 * MINUTE;

export const HISTORY_SETTING = 'heatmapHistory';

export type HeatmapCapability = {
  id: string,
  title: string,
  type: 'number' | 'boolean',
  units: string | null,
  decimals: number | null,
};

export type HeatmapHistory = {
  name: string,
  icon: string | null,
  capability: HeatmapCapability,
  value: number | boolean | null,
  days: HeatmapDay[],
  language: string,
};

/** A boolean's changes as `[epoch ms, 0 | 1]`, kept in the app settings so they survive restarts. */
type Recorded = {
  deviceId: string,
  capabilityId: string,
  lastRequested: number,
  changes: [number, 0 | 1][],
};

type NumericCache = { at: number, lastRequested: number, days: HeatmapDay[] };

const key = (deviceId: string, capabilityId: string) => `${deviceId}:${capabilityId}`;

/** The device's capabilities a heatmap can show: numbers and booleans that Homey logs in Insights. */
export function heatmapCaps(device: any): HeatmapCapability[] {
  const caps = device?.capabilitiesObj || {};
  return (device?.capabilities as string[] || Object.keys(caps))
    .filter(id => caps[id]?.insights === true && (caps[id].type === 'number' || caps[id].type === 'boolean'))
    .map(id => {
      const { title, type, units, decimals } = describeCapability(caps[id], id);
      return { id, title, type: type as HeatmapCapability['type'], units, decimals };
    });
}

/**
 * Both lists merged in time order. A change both have (recorded by the app and read back from Insights,
 * a few ms apart) is kept once; other repeats of a state are harmless to `hourlyShareTrue`.
 */
export function mergeChanges(list: [number, 0 | 1][], incoming: [number, 0 | 1][]): [number, 0 | 1][] {
  const all = [...list, ...incoming].sort((a, b) => a[0] - b[0]);
  const out: [number, 0 | 1][] = [];
  for (const c of all) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - c[0]) < 1000 && prev[1] === c[1]) continue; // the same change from both sources
    out.push(c);
  }
  return out;
}

/**
 * The Insights Heatmap widget's data: one capability's last 7 or 14 local days, hour by hour.
 *
 * Numbers come from Insights' `last7Days` or `last14Days` (hourly averages). Booleans can't: their log only ever returns
 * the last 50 changes, whatever the resolution (a motion sensor's are under a day). So a boolean is
 * recorded by the app from the first time a widget asks for it, backfilled from those 50 changes, and
 * kept in the app settings until no widget has asked for it for 8 days.
 */
export default class HeatmapService {

  private numeric = new Map<string, NumericCache>();
  private numericPromises = new Map<string, Promise<HeatmapDay[]>>();
  private logIds = new Map<string, string>(); // the Insights log that worked, per device and capability
  private recorded = new Map<string, Recorded>();
  private instances = new Map<string, any>();
  private backfilledAt = new Map<string, number>();
  private saveTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  /** Resumes recording the booleans that widgets asked for before the app restarted. */
  start() {
    const saved = this.homey.settings.get(HISTORY_SETTING);
    if (saved && typeof saved === 'object') {
      for (const r of Object.values(saved) as Recorded[]) {
        if (r && typeof r.deviceId === 'string' && typeof r.capabilityId === 'string' && Array.isArray(r.changes)) {
          this.recorded.set(key(r.deviceId, r.capabilityId), r);
        }
      }
    }
    for (const r of this.recorded.values()) {
      this.subscribe(r).catch(err => this.log(`Could not record ${r.capabilityId} of ${r.deviceId}:`, err));
    }
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    for (const k of [...this.instances.keys()]) this.unsubscribe(k);
    if (this.saveTimer) {
      this.homey.clearTimeout(this.saveTimer);
      this.save();
    }
  }

  // ---------------------------------------------------------------- settings autocomplete

  listDevices(query: string): Promise<AutocompleteItem[]> {
    return listDevicesWhere(this.homey, query, d => heatmapCaps(d).length > 0);
  }

  async listCapabilities(deviceId: string | undefined, query: string): Promise<AutocompleteItem[]> {
    if (!deviceId) throw new Error(this.homey.__('heatmap.selectDeviceFirst') || 'Select a device first');
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId });
    return heatmapCaps(device)
      .map(c => ({ name: c.title, description: c.units ?? (c.type === 'boolean' ? this.homey.__('heatmap.onOff') || 'On/off' : undefined), id: c.id }))
      .filter(c => matches(query, c.name, c.id));
  }

  // ---------------------------------------------------------------- history

  /** `days`: how many the widget shows (3, 7, 10 or 14). The result has 7 or 14 (`spanFor`), ending today. */
  async getHistory(deviceId: string, capabilityId: string, days: number = 7): Promise<HeatmapHistory> {
    const span = spanFor(days);
    const tm = new Timings();
    const api = await tm.time('api', () => getAppApi(this.homey));
    const device: any = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId }));
    const capability = heatmapCaps(device).find(c => c.id === capabilityId);
    if (!capability) throw new Error(`${device.name} has no logged capability ${capabilityId}`);
    const [icon, history] = await Promise.all([
      tm.time('icon', () => fetchDeviceIcon(api, device, this.log)),
      capability.type === 'boolean'
        ? tm.time('booleanHistory', () => this.booleanHistory(api, deviceId, capabilityId, device, span))
        : tm.time('insights', () => this.numericHistory(api, deviceId, capabilityId, span)),
    ]);
    const raw = device.capabilitiesObj?.[capabilityId]?.value;
    this.debug(`Heatmap ${device.name} ${capabilityId}: ${tm.summary()}`);
    return {
      name: device.name,
      icon,
      capability,
      value: typeof raw === 'number' || typeof raw === 'boolean' ? raw : null,
      days: history,
      language: this.homey.i18n.getLanguage(),
    };
  }

  private numericHistory(api: any, deviceId: string, capabilityId: string, span: Span): Promise<HeatmapDay[]> {
    const k = `${key(deviceId, capabilityId)}:${span}`;
    const now = Date.now();
    const cached = this.numeric.get(k);
    if (cached) cached.lastRequested = now;
    if (cached && now - cached.at < NUMERIC_TTL) return Promise.resolve(cached.days);
    let p = this.numericPromises.get(k);
    if (!p) {
      p = (async () => {
        const res = await readCapabilityLog(api, deviceId, capabilityId, `last${span}Days`, this.logIds);
        const days = hourlyAverages(parseInsightsEntries(res), Date.now(), this.homey.clock.getTimezone(), span);
        this.numeric.set(k, { at: Date.now(), lastRequested: Date.now(), days });
        return days;
      })().finally(() => this.numericPromises.delete(k));
      this.numericPromises.set(k, p);
    }
    return p;
  }

  private async booleanHistory(api: any, deviceId: string, capabilityId: string, device: any, span: Span): Promise<HeatmapDay[]> {
    const k = key(deviceId, capabilityId);
    let r = this.recorded.get(k);
    if (!r) {
      r = { deviceId, capabilityId, lastRequested: Date.now(), changes: [] };
      this.recorded.set(k, r);
      this.debug(`Recording ${capabilityId} of ${device.name} (${deviceId})`);
    }
    r.lastRequested = Date.now();
    if (Date.now() - (this.backfilledAt.get(k) ?? 0) > BACKFILL_TTL) {
      try {
        const res = await api.insights.getLogEntries({
          uri: `homey:device:${deviceId}`, id: `homey:device:${deviceId}:${capabilityId}`, resolution: 'last7Days',
        });
        const values: any[] = Array.isArray(res) ? res : (res?.values ?? []);
        const incoming = values
          .map((e): [number, 0 | 1] => [new Date(e.t).getTime(), e.v ? 1 : 0])
          .filter(([t]) => Number.isFinite(t));
        r.changes = mergeChanges(r.changes, incoming);
        this.backfilledAt.set(k, Date.now());
      } catch (err) {
        this.log(`Insights backfill of ${capabilityId} of ${device.name} failed:`, err);
      }
    }
    // After the backfill, so the state now only counts as a change if it differs from Insights' last.
    if (!this.instances.has(k)) await this.subscribe(r, device);
    this.prune(r);
    this.scheduleSave();
    return hourlyShareTrue(r.changes.map(([t, v]) => ({ t, v: v === 1 })), Date.now(), this.homey.clock.getTimezone(), span);
  }

  // ---------------------------------------------------------------- boolean recording

  private async subscribe(r: Recorded, device?: any) {
    const k = key(r.deviceId, r.capabilityId);
    if (this.instances.has(k)) return;
    const api = await getAppApi(this.homey);
    const d = device ?? await api.devices.getDevice({ id: r.deviceId });
    if (this.instances.has(k)) return;
    // The state now: covers changes missed while the app wasn't running.
    const value = d.capabilitiesObj?.[r.capabilityId]?.value;
    if (typeof value === 'boolean') this.record(r, value);
    this.instances.set(k, d.makeCapabilityInstance(r.capabilityId, (v: unknown) => {
      if (typeof v === 'boolean') this.record(r, v);
    }));
  }

  private unsubscribe(k: string) {
    try { this.instances.get(k)?.destroy(); } catch (err) { /* ignore */ }
    this.instances.delete(k);
  }

  private record(r: Recorded, value: boolean) {
    const last = r.changes[r.changes.length - 1];
    if (last && last[1] === (value ? 1 : 0)) return;
    r.changes.push([Date.now(), value ? 1 : 0]);
    this.scheduleSave();
  }

  /** Drops changes older than `KEEP`, keeping the last of them as the state the window starts in. */
  private prune(r: Recorded) {
    const cutoff = Date.now() - KEEP;
    let i = 0;
    while (i + 1 < r.changes.length && r.changes[i + 1][0] < cutoff) i++;
    if (i) r.changes.splice(0, i);
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = this.homey.setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DELAY);
  }

  private save() {
    const out: Record<string, Recorded> = {};
    for (const [k, r] of this.recorded) {
      this.prune(r);
      out[k] = r;
    }
    try {
      this.homey.settings.set(HISTORY_SETTING, out);
    } catch (err) {
      this.log('Could not save the heatmap history:', err);
    }
  }

  private tick() {
    const now = Date.now();
    for (const [k, c] of this.numeric) {
      if (now - c.lastRequested > IDLE_TIMEOUT) this.numeric.delete(k);
    }
    for (const [k, r] of this.recorded) {
      if (now - r.lastRequested > RECORD_TIMEOUT) {
        this.unsubscribe(k);
        this.recorded.delete(k);
        this.backfilledAt.delete(k);
        this.debug(`Stopped recording ${r.capabilityId} of ${r.deviceId}`);
        this.scheduleSave();
      }
    }
  }

  /** For the diagnostics report. */
  describe() {
    return {
      numeric: [...this.numeric.entries()].map(([k, c]) => ({ key: k, fetchedAt: new Date(c.at).toISOString() })),
      recorded: [...this.recorded.entries()].map(([k, r]) => ({
        key: k,
        subscribed: this.instances.has(k),
        changes: r.changes.length,
        since: r.changes.length ? new Date(r.changes[0][0]).toISOString() : null,
        lastRequested: new Date(r.lastRequested).toISOString(),
      })),
    };
  }

}
