/**
 * The SDK's `Homey.App`, which the real Homey provides: test files that boot the app mock `homey` with it
 * (`vi.mock('homey', () => import('./helpers/homeySdk.js').then(m => m.homeyMock))`; a factory can't use an import that
 * itself loads the app).
 */
export class FakeHomeyApp {
  homey: any;
  /** What reached the SDK's own `log()`/`error()`. */
  sdkLog: unknown[][] = [];
  log(...args: unknown[]) { this.sdkLog.push(args); }
  error(...args: unknown[]) { this.sdkLog.push(args); }
}

export const homeyMock = { default: { App: FakeHomeyApp } };
