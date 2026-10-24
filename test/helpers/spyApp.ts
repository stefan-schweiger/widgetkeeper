import { vi } from 'vitest';

/** A service call the app received: `service.method` and its arguments. */
export type ServiceCall = [string, unknown[]];

/**
 * What the handlers need back from the services to go on (an array to map, a state to read …); every other method
 * answers `{}`.
 */
const RETURNS: Record<string, (...args: any[]) => unknown> = {
  'lights.getState': async () => [{ id: 'l1', zone: { id: 'z1' } }],
  'sensorAlarms.getState': async () => [],
  'sparklines.getState': async () => [],
  'values.getState': async () => [],
  'variables.getState': async () => [],
  'thermostat.getState': async () => ({ id: 't1' }),
  'weather.getForecast': async () => ({ hours: [] }),
  'electricity.getSnapshot': async () => ({
    prices: Array.from({ length: 49 }, () => ({ price: 1 })), quarters: null, priceError: null, fixedPrice: null, currency: 'DKK', language: 'en',
  }),
  'tileNames.get': () => ({ names: {} }),
};

/**
 * A stand-in for the app (`homey.app`) whose services are spies: every `app.<service>.<method>(…)` is recorded in
 * `calls` and answered from `RETURNS` (or `{}`), so a route handler can be run without the services behind it.
 */
export function spyApp() {
  const calls: ServiceCall[] = [];
  const log = vi.fn();
  const debug = vi.fn();
  const services = new Map<string, unknown>();
  const app = new Proxy({} as Record<string, any>, {
    get(_, service) {
      if (service === 'log') return log;
      if (service === 'debug') return debug;
      if (typeof service !== 'string' || service === 'then') return undefined;
      if (!services.has(service)) {
        services.set(service, new Proxy({}, {
          get(__, method) {
            if (typeof method !== 'string' || method === 'then') return undefined;
            const key = `${service}.${method}`;
            return (...args: unknown[]) => {
              calls.push([key, args]);
              return (RETURNS[key] ?? (async () => ({})))(...args);
            };
          },
        }));
      }
      return services.get(service);
    },
  });
  return { app, calls, log, debug };
}
