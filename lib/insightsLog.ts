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
 * `read` with the first of the candidate log ids that works (a missing log throws, so they're tried in turn). The one
 * that worked is remembered in `known` under `key`, so later reads make one call. A remembered id that fails is
 * forgotten, so the next read tries every candidate again, unless `keep` (then it stays the only one tried). Throws
 * the last error when none works.
 */
export async function readFirstLog<T>(
  key: string, candidates: string[], known: Map<string, string>, read: (logId: string) => Promise<T>, { keep = false } = {},
): Promise<{ logId: string, result: T }> {
  const remembered = known.get(key);
  let error: unknown;
  for (const logId of remembered ? [remembered] : candidates) {
    try {
      const result = await read(logId);
      known.set(key, logId);
      return { logId, result };
    } catch (err) {
      error = err;
    }
  }
  if (remembered && !keep) known.delete(key);
  throw error;
}

/**
 * A capability's Insights log entries at `resolution`, from the first of `logIdsFor()` that works; the one that worked
 * is remembered in `known` (per `deviceId:capabilityId`).
 */
export async function readCapabilityLog(
  api: any, deviceId: string, capabilityId: string, resolution: string, known: Map<string, string>,
): Promise<any> {
  const { result } = await readFirstLog(`${deviceId}:${capabilityId}`, logIdsFor(deviceId, capabilityId), known,
    id => api.insights.getLogEntries({ uri: `homey:device:${deviceId}`, id, resolution }));
  return result;
}
