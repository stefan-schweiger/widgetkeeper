import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import DeviceTracker, { type TrackedEntry } from './DeviceTracker.js';
import { fetchDeviceIcon, fetchSvgIcon } from './deviceIcon.js';
import Timings from './Timings.js';

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

type Tracked = TrackedEntry & {
  name: string,
  icon: string | null,
  quickAction: QuickAction | null,
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

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    // An open widget keeps its entries alive indefinitely, so each request re-reads the device: a rename, a new
    // quick action or a deleted device would otherwise never show.
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Quick action',
      signature: device => quickActionId(device) ?? '',
      create: async (device, api, tm) => {
        const id = quickActionId(device);
        const cap = id ? device.capabilitiesObj[id] : null;
        const [icon, capIcon] = await tm.time('icons', () => Promise.all([
          fetchDeviceIcon(api, device, this.log),
          id ? fetchSvgIcon(api, cap.iconObj, `${device.name} ${id}`, this.log) : null,
        ]));
        return {
          name: device.name,
          icon,
          quickAction: id ? {
            capabilityId: id,
            value: cap.value ?? null,
            actionable: isActionable(cap),
            momentary: isMomentary(id),
            icon: capIcon,
          } : null,
        };
      },
      listen: (t, device) => {
        const id = t.quickAction?.capabilityId;
        this.debug(`Tracking quick action of ${device.name} (${t.key}): ${id ?? 'none'}=${JSON.stringify(t.quickAction?.value)}`);
        return id ? [device.makeCapabilityInstance(id, (value: unknown) => {
          if (t.quickAction) t.quickAction.value = value;
          this.homey.api.realtime(QA_STATE_EVENT, { deviceId: t.key, capabilityId: id, value });
        })] : [];
      },
      refresh: async (t, device, api, tm) => {
        t.name = device.name;
        t.icon = await tm.time('icons', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
        if (t.quickAction) {
          const cap = device.capabilitiesObj[t.quickAction.capabilityId];
          t.quickAction.value = cap.value ?? null;
          t.quickAction.actionable = isActionable(cap);
        }
      },
      label: t => t.name,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /** One entry per device, in the order asked for. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<QuickActionDevice[]> {
    const tm = new Timings();
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Quick action device', (t, id): QuickActionDevice => (
      { id, name: t.name, icon: t.icon, quickAction: t.quickAction && { ...t.quickAction } }
    ));
    this.debug(`Quick actions state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
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
    this.debug(`Quick action ${device.name}: ${id}=${v}`);
  }

}
