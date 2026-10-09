/**
 * Insights log ids differ from capability ids in one known case: Homey logs `measure_power` as
 * `energy_power` (on every device with it on the test Homey, 2026-10-09: the meter, plugs, a heat pump,
 * a car and a charger; reading `…:measure_power` is `Not Found: LogLocal`). The capability's own id is
 * kept as a second try, in case a device or firmware logs it under that name.
 */
const LOG_ALIASES: Record<string, string[]> = {
  measure_power: ['energy_power', 'measure_power'],
};

/** The Insights log ids that may hold a capability's history, in the order to try them. */
export function logIdsFor(deviceId: string, capabilityId: string): string[] {
  return (LOG_ALIASES[capabilityId] ?? [capabilityId]).map(c => `homey:device:${deviceId}:${c}`);
}

/**
 * A capability's Insights log entries at `resolution`. A missing log throws, so the candidate ids are
 * tried in turn; the one that worked is remembered in `known` (per `deviceId:capabilityId`), so later
 * reads make one call. Throws the last error when none works.
 */
export async function readCapabilityLog(
  api: any, deviceId: string, capabilityId: string, resolution: string, known: Map<string, string>,
): Promise<any> {
  const k = `${deviceId}:${capabilityId}`;
  const remembered = known.get(k);
  const candidates = remembered ? [remembered] : logIdsFor(deviceId, capabilityId);
  let error: unknown;
  for (const id of candidates) {
    try {
      const res = await api.insights.getLogEntries({ uri: `homey:device:${deviceId}`, id, resolution });
      known.set(k, id);
      return res;
    } catch (err) {
      error = err;
    }
  }
  // A remembered id that failed is forgotten, so the next read tries every candidate again.
  if (remembered) known.delete(k);
  throw error;
}
