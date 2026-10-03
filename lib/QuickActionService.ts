import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchDeviceIcon, fetchSvgIcon } from './deviceIcon.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;

export const QA_STATE_EVENT = 'quickactions:state';

export type QuickAction = {
  capabilityId: string,
  value: unknown,
  /** A settable boolean: the widget can trigger it. */
  actionable: boolean,
  /** `button` capabilities have no lasting state; triggering always sends `true`. */
  momentary: boolean,
  /** The capability's own icon as an SVG data URL. Homey's standard capabilities have none. */
  icon: string | null,
};

export type QuickActionDevice =
  | { id: string, name: string, icon: string | null, quickAction: QuickAction | null }
  | { id: string, missing: true };

type Tracked = {
  deviceId: string,
  name: string,
  icon: string | null,
  quickAction: QuickAction | null,
  instance: any,
  lastRequested: number,
};

/**
 * The device's quick action as the Homey app shows it: the user's override (`.none` turns it off),
 * else the driver's default.
 */
export function quickActionId(device: any): string | null {
  const override = device?.ui?.quickActionOverride;
  const id = override === '.none' ? null : (override || device?.ui?.quickAction || null);
  return id && device.capabilitiesObj?.[id] ? id : null;
}

function isMomentary(capabilityId: string) {
  return capabilityId.split('.')[0] === 'button';
}

function isActionable(cap: any) {
  return cap?.type === 'boolean' && cap?.setable !== false;
}

export default class QuickActionService {

  private tracked = new Map<string, Tracked>();
  private trackPromises = new Map<string, Promise<Tracked>>();
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(private homey: Homey.App['homey'], private log: (...args: any[]) => void) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    for (const t of this.tracked.values()) this.dispose(t);
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<QuickActionDevice[]> {
    return Promise.all(deviceIds.map(async (id): Promise<QuickActionDevice> => {
      try {
        const t = await this.ensureTracked(id);
        t.lastRequested = Date.now();
        return { id, name: t.name, icon: t.icon, quickAction: t.quickAction && { ...t.quickAction } };
      } catch (err) {
        this.log(`Quick action device ${id} unavailable:`, err);
        return { id, missing: true };
      }
    }));
  }

  /** Sets the device's quick-action capability, and nothing else. */
  async trigger(deviceId: string, value: unknown) {
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId, $cache: false });
    const id = quickActionId(device);
    if (!id) throw new Error(`${device.name} has no quick action`);
    if (!isActionable(device.capabilitiesObj[id])) throw new Error(`${device.name}'s quick action ${id} can't be set`);
    const v = isMomentary(id) ? true : value;
    if (typeof v !== 'boolean') throw new Error(`Invalid value ${JSON.stringify(value)}`);
    await device.setCapabilityValue({ capabilityId: id, value: v });
    this.log(`Quick action ${device.name}: ${id}=${v}`);
  }

  // ---------------------------------------------------------------- live state

  private ensureTracked(deviceId: string): Promise<Tracked> {
    const existing = this.tracked.get(deviceId);
    if (existing) return Promise.resolve(existing);
    let p = this.trackPromises.get(deviceId);
    if (!p) {
      p = this.track(deviceId).finally(() => this.trackPromises.delete(deviceId));
      this.trackPromises.set(deviceId, p);
    }
    return p;
  }

  private async track(deviceId: string): Promise<Tracked> {
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId });
    const id = quickActionId(device);
    const cap = id ? device.capabilitiesObj[id] : null;
    const [icon, capIcon] = await Promise.all([
      fetchDeviceIcon(api, device, this.log),
      id ? fetchSvgIcon(api, cap.iconObj, `${device.name} ${id}`, this.log) : null,
    ]);
    const t: Tracked = {
      deviceId,
      name: device.name,
      icon,
      quickAction: id ? {
        capabilityId: id,
        value: cap.value ?? null,
        actionable: isActionable(cap),
        momentary: isMomentary(id),
        icon: capIcon,
      } : null,
      instance: null,
      lastRequested: Date.now(),
    };
    if (id) {
      t.instance = device.makeCapabilityInstance(id, (value: unknown) => {
        if (t.quickAction) t.quickAction.value = value;
        this.homey.api.realtime(QA_STATE_EVENT, { deviceId, capabilityId: id, value });
      });
    }
    this.tracked.set(deviceId, t);
    this.log(`Tracking quick action of ${device.name} (${deviceId}): ${id ?? 'none'}=${JSON.stringify(t.quickAction?.value)}`);
    return t;
  }

  private tick() {
    const now = Date.now();
    for (const t of this.tracked.values()) {
      if (now - t.lastRequested > IDLE_TIMEOUT) this.dispose(t);
    }
  }

  private dispose(t: Tracked) {
    try { t.instance?.destroy(); } catch (err) { /* ignore */ }
    this.tracked.delete(t.deviceId);
    this.log(`Stopped tracking ${t.name}`);
  }

}
