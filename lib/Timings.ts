/**
 * Per-request timings for the diagnostics log: `total 812 ms (getDevice 140, history 610, …)`.
 * Steps may run in parallel; each is timed on its own.
 */
export default class Timings {

  private start = Date.now();
  private parts: string[] = [];

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      this.parts.push(`${label} ${Date.now() - t0}`);
    }
  }

  summary(): string {
    return `${Date.now() - this.start} ms${this.parts.length ? ` (${this.parts.join(', ')})` : ''}`;
  }

}

/**
 * A widget's own load marks, sent with its first request as `perf=<frame start epoch ms>,<html>,<sdk>,<request>`
 * (the last three in ms since the frame started). Logged as e.g.
 * `frame started 12:14:53.120 (2.8 s ago), html 140 ms, SDK ready 1900 ms, request 1950 ms`.
 */
export function describeWidgetPerf(perf: string | undefined): string | null {
  const [origin, html, sdk, request] = (perf || '').split(',').map(Number);
  if (![origin, html, sdk, request].every(Number.isFinite)) return null;
  return `frame started ${new Date(origin).toISOString().slice(11, 23)} (${((Date.now() - origin) / 1000).toFixed(1)} s ago), `
    + `html ${Math.round(html)} ms, SDK ready ${Math.round(sdk)} ms, request ${Math.round(request)} ms`;
}
