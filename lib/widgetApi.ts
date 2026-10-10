import { KeyError, type KeyProblem } from './PersonalApiKey.js';
import { describeWidgetPerf } from './Timings.js';

/** What the widget API handlers need of the app: its two logs. */
type AppLog = { log: (...args: any[]) => void, debug: (...args: any[]) => void };

/** A widget's own load marks (`perf=` on its first request), logged with debug as `<name> widget: …`. */
export function logPerf(app: AppLog, name: string, query: Record<string, string>) {
  const perf = describeWidgetPerf(query.perf);
  if (perf) app.debug(`${name} widget: ${perf}`);
}

/** A comma-separated list of ids from a query (`deviceIds=a,b`), without empty ones. */
export function idList(s: string | undefined): string[] {
  return (s || '').split(',').filter(Boolean);
}

/** `fn`'s answer; a failure is logged as `<label> <error>` and thrown on. */
export async function logged<T>(app: AppLog, label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    app.log(label, err);
    throw err;
  }
}

/**
 * `{ok: true, …fn's answer}`. Without a usable personal API key it answers `{ok: false, reason}` (`noKey`, `keyScope`,
 * `keyInvalid`), so the widget can say what to do; anything else is logged as `<label>: <error>` and thrown on.
 */
export async function keyResult<T extends object | void>(app: AppLog, label: string, fn: () => Promise<T>): Promise<({ ok: true } & T) | { ok: false, reason: KeyProblem }> {
  try {
    return { ok: true, ...await fn() } as { ok: true } & T;
  } catch (err) {
    if (err instanceof KeyError) {
      if (err.reason !== 'noKey') app.log(`${label} (${err.reason}):`, err.message);
      return { ok: false, reason: err.reason };
    }
    app.log(`${label}:`, err);
    throw err;
  }
}
