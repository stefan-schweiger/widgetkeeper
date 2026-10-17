import type Homey from 'homey';
import DeviceTracker, { readZones, zoneRef, type TrackedEntry } from './DeviceTracker.js';
import Timings from './Timings.js';

export const RH_STATE_EVENT = 'roomhealth:state';

/** What Room Health scores. The widget has the comfortable ranges; each comes in one unit (see `RULES`). */
export type Measure = 'temperature' | 'humidity' | 'co2' | 'radon' | 'pm25' | 'pm10' | 'voc';

/** One capability a device gives for a measure; `scale` turns its value into the measure's unit (radon in pCi/L × 37). */
export type HealthCap = { measure: Measure, capabilityId: string, scale: number };

export type RoomHealthDevice =
  | { id: string, name: string, zone: { id: string, name: string } | null, measures: Partial<Record<Measure, { capabilityId: string, value: number | null }>> }
  | { id: string, missing: true };

type Tracked = TrackedEntry & {
  name: string,
  zone: string | null,
  caps: HealthCap[],
  values: Partial<Record<Measure, number | null>>,
};

/** Sub-capabilities that are the room's own reading (a heat pump's `measure_temperature.room`); `.outdoor`, `.freezer` … aren't. */
const INDOOR = ['room', 'indoor', 'inside'];

/**
 * Per measure, the capability ids that give it (matched without case: an Aqara's VOC is `measure_VOC`), in the
 * measure's unit: °C, %, ppm, Bq/m³, μg/m³ (PM2.5, PM10) and ppb (VOC). `indoor` also takes an indoor sub-capability
 * when the device has no plain one; `units` must match when set (VOC in μg/m³ or as an index is another scale).
 */
const RULES: { measure: Measure, ids: string[], indoor?: boolean, units?: RegExp }[] = [
  { measure: 'temperature', ids: ['measure_temperature'], indoor: true },
  { measure: 'humidity', ids: ['measure_humidity'], indoor: true },
  { measure: 'co2', ids: ['measure_co2'] },
  { measure: 'radon', ids: ['measure_radon'] },
  { measure: 'pm25', ids: ['measure_pm25'] },
  { measure: 'pm10', ids: ['measure_pm10'] },
  { measure: 'voc', ids: ['measure_voc', 'measure_tvoc'], units: /^ppb$/i },
];

/** The capabilities Room Health reads from a device: at most one per measure, number capabilities only. */
export function healthCaps(device: any): HealthCap[] {
  const caps = device?.capabilitiesObj || {};
  const ids = Object.keys(caps).filter(id => caps[id]?.type === 'number');
  const out: HealthCap[] = [];
  for (const rule of RULES) {
    const fits = (id: string) => !rule.units || rule.units.test(String(caps[id]?.units ?? '').trim());
    const plain = ids.find(id => rule.ids.includes(id.toLowerCase()) && fits(id));
    const indoor = !plain && rule.indoor
      ? ids.find((id) => {
        const [base, sub] = id.toLowerCase().split('.');
        return rule.ids.includes(base) && INDOOR.includes(sub) && fits(id);
      })
      : undefined;
    const id = plain || indoor;
    if (!id) continue;
    const scale = rule.measure === 'radon' && /pci/i.test(String(caps[id]?.units ?? '')) ? 37 : 1;
    out.push({ measure: rule.measure, capabilityId: id, scale });
  }
  return out;
}

const toValue = (value: unknown, scale: number) => (typeof value === 'number' && Number.isFinite(value) ? value * scale : null);

function readValues(device: any, caps: HealthCap[]): Partial<Record<Measure, number | null>> {
  return Object.fromEntries(caps.map(c => [c.measure, toValue(device.capabilitiesObj?.[c.capabilityId]?.value, c.scale)]));
}

/**
 * Room Health: the temperature, humidity, CO₂, radon, PM and VOC sensors a widget picked, each with its zone (its
 * room). The widget groups them into rooms and scores them.
 */
export default class RoomHealthService {

  private tracker: DeviceTracker<Tracked>;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Room health capabilities',
      signature: device => healthCaps(device).map(c => `${c.capabilityId}*${c.scale}`).join(),
      // A device with nothing usable (VOC only in μg/m³) isn't missing: it gives no readings, and is tracked
      // again by itself once it has some (its signature changes).
      create: async (device) => {
        const caps = healthCaps(device);
        return { name: device.name, zone: device.zone ?? null, caps, values: readValues(device, caps) };
      },
      listen: (t, device) => {
        const instances = t.caps.map(({ measure, capabilityId, scale }) => device.makeCapabilityInstance(capabilityId, (raw: unknown) => {
          const value = toValue(raw, scale);
          t.values[measure] = value;
          this.homey.api.realtime(RH_STATE_EVENT, { deviceId: t.key, capabilityId, measure, value });
        }));
        this.debug(`Tracking room health of ${device.name} (${t.key}): ${t.caps.map(c => `${c.capabilityId}=${t.values[c.measure]}`).join(', ') || 'nothing'}`);
        return instances;
      },
      refresh: (t, device) => {
        t.name = device.name;
        t.zone = device.zone ?? null;
        t.caps = healthCaps(device);
        t.values = readValues(device, t.caps);
      },
      label: t => `room health sensor ${t.name}`,
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }

  /** One entry per device, in the order asked for, with its zone. A deleted device doesn't fail the others. */
  async getState(deviceIds: string[]): Promise<RoomHealthDevice[]> {
    const tm = new Timings();
    const zonesP = readZones(this.homey, tm, this.log, 'Room health');
    const out = await this.tracker.each(deviceIds, tm, this.log, 'Room health sensor', async (t, id): Promise<RoomHealthDevice> => {
      return {
        id,
        name: t.name,
        zone: zoneRef(await zonesP, t.zone),
        measures: Object.fromEntries(t.caps.map(c => [c.measure, { capabilityId: c.capabilityId, value: t.values[c.measure] ?? null }])),
      };
    });
    this.debug(`Room health state for ${deviceIds.length} devices: ${tm.summary()}`);
    return out;
  }

}
