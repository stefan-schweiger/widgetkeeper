import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import type { CapValue } from '../../lib/ThermostatService.js';
import { parseSlot } from '../../lib/ValueService.js';
import { logged, logPerf, requireId } from '../../lib/widgetApi.js';

type Homey = App['homey'];

/**
 * The thermostat's state, with the value beside its name (`sensor`, a Device Values slot `<deviceId>:<capabilityId>`,
 * tracked by `app.values`) as `sensor: {deviceId, capabilityId, capability, value}`. A sensor that can't be read is
 * left out: it never fails the thermostat.
 */
export async function thermostatState(app: Pick<WidgetkeeperApp, 'thermostat' | 'values'>, deviceId: string, sensor?: string) {
  const slot = sensor && parseSlot(sensor) ? sensor : null;
  const [state, values] = await Promise.all([
    app.thermostat.getState(deviceId),
    slot ? app.values.getState([slot]) : [],
  ]);
  const s = values[0];
  if ('missing' in state || !s || 'missing' in s) return state;
  return { ...state, sensor: { deviceId: s.deviceId, capabilityId: s.capabilityId, capability: s.capability, value: s.value } };
}

export default {
  /** `deviceId`, and `sensor` (optional): the value beside the name. */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    const deviceId = requireId(query.deviceId, 'deviceId');
    logPerf(app, 'Thermostat', query);
    return logged(app, 'Thermostat state failed:', () => thermostatState(app, deviceId, query.sensor));
  },

  async apply({ homey, body }: {
    homey: Homey,
    body: { deviceId?: string, values?: CapValue[] },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return logged(app, () => `Thermostat apply failed, body: ${JSON.stringify(body)}`, async () => {
      const deviceId = requireId(body?.deviceId, 'deviceId');
      if (!Array.isArray(body.values)) throw new Error('Missing values');
      await app.thermostat.apply(deviceId, body.values);
      return { ok: true };
    });
  },
};
