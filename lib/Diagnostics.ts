import { inspect } from 'node:util';
import type Homey from 'homey';
import { getAppApi } from './appApi.js';

const MAX_LINES = 500;

/** App setting that turns on routine (debug) logging. */
export const DEBUG_LOG_SETTING = 'debugLog';

type AppHomey = Homey.App['homey'];

/**
 * In-memory log plus device introspection, so the app can be debugged without `homey app run`.
 * Shown on the app settings page (Homey app → Apps → Widgetkeeper → Configure).
 */
export default class Diagnostics {

  private lines: string[] = [];
  private startedAt = Date.now();

  constructor(private homey: AppHomey) {}

  add(level: 'info' | 'error', args: unknown[]) {
    const text = args.map(a => (typeof a === 'string' ? a
      : a instanceof Error ? (a.stack || a.message)
        : inspect(a, { depth: 4, breakLength: 160 }))).join(' ');
    this.lines.push(`${new Date().toISOString()} ${level === 'error' ? 'ERROR ' : ''}${text}`);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  /** App status and log; with `device` (id or part of a name), that device's full capability details. */
  async report(device: string | undefined) {
    const out: Record<string, unknown> = {
      app: this.homey.manifest.id,
      version: this.homey.manifest.version,
      homeyVersion: this.homey.version,
      uptimeMinutes: Math.round((Date.now() - this.startedAt) / 60e3),
      debugLog: this.homey.settings.get(DEBUG_LOG_SETTING) === true,
    };
    try {
      const api = await getAppApi(this.homey);
      const devices = Object.values(await api.devices.getDevices()) as any[];
      out.thermostats = devices
        .filter(d => d.capabilities?.includes('target_temperature') || d.capabilities?.includes('thermostat_mode'))
        .map(d => ({ id: d.id, name: d.name, capabilities: d.capabilities }));
      out.devices = devices
        .map(d => {
          const qa = d.ui?.quickAction ?? null;
          const cap = qa ? d.capabilitiesObj?.[qa] : null;
          return {
            id: d.id, name: d.name as string, class: d.class, virtualClass: d.virtualClass ?? null,
            quickAction: qa, quickActionOverride: d.ui?.quickActionOverride ?? null,
            qaType: cap?.type ?? null, qaSetable: cap?.setable ?? null, qaIconObj: cap?.iconObj ?? null,
            booleanCaps: (d.capabilities as string[] || []).filter(id => d.capabilitiesObj?.[id]?.type === 'boolean'),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      if (device) {
        const q = device.toLowerCase();
        const d = devices.find(x => x.id === device) || devices.find(x => String(x.name).toLowerCase().includes(q));
        out.device = d ? this.describeDevice(d) : `No device matching "${device}"`;
      }
    } catch (err) {
      out.apiError = err instanceof Error ? (err.stack || err.message) : String(err);
    }
    out.log = this.lines.slice();
    return out;
  }

  private describeDevice(d: any) {
    return {
      id: d.id,
      name: d.name,
      class: d.class,
      driverId: d.driverId,
      available: d.available,
      unavailableMessage: d.unavailableMessage,
      iconObj: d.iconObj,
      iconOverride: d.iconOverride,
      ui: d.ui,
      capabilities: Object.fromEntries((d.capabilities as string[] || []).map(id => {
        const c = d.capabilitiesObj?.[id] || {};
        return [id, {
          type: c.type, title: c.title, value: c.value, setable: c.setable, getable: c.getable,
          units: c.units, min: c.min, max: c.max, step: c.step, values: c.values, lastUpdated: c.lastUpdated,
          iconObj: c.iconObj,
        }];
      })),
    };
  }

}
