import type Homey from 'homey';

/** Names that would reach (or read) `Object.prototype` as keys of a plain object: never a key in a stored setting. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export function isReservedKey(key: string): boolean {
  return RESERVED.has(key);
}

export type DebouncedSettingOptions = {
  homey: Homey.App['homey'],
  /** How long after the first change it's written, so a burst of changes is one write. */
  delay: number,
  /** What to write, read when it's written. */
  value: () => unknown,
  log: (...args: any[]) => void,
  /** For the log line of a failed write: `Could not save <what>:`. */
  what: string,
} & (
  /** The app setting it's written to. */
  | { setting: string, store?: never }
  /** Or where else it's written (a file in `/userdata`); a throw is a failed write. */
  | { store: (value: unknown) => void, setting?: never }
);

/**
 * An app setting (or `store`) written a while after a change (`schedule()`). `flush()` writes a pending change at once:
 * call it in the service's `stop()`, or an app restart loses what changed since the last write.
 */
export class DebouncedSetting {

  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: DebouncedSettingOptions) {}

  schedule() {
    if (this.timer) return;
    this.timer = this.opts.homey.setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.opts.delay);
  }

  flush() {
    if (!this.timer) return;
    this.opts.homey.clearTimeout(this.timer);
    this.timer = null;
    this.write();
  }

  private write() {
    try {
      const value = this.opts.value();
      if (this.opts.store) this.opts.store(value);
      else this.opts.homey.settings.set(this.opts.setting, value);
    } catch (err) {
      this.opts.log(`Could not save ${this.opts.what}:`, err);
    }
  }

}
